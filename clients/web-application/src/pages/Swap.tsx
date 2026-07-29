import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { formatBalance } from '@/utils/format'
import { parseUnits, solidityPackedKeccak256, randomBytes } from 'ethers'
import toast from 'react-hot-toast'
import { useWalletStore } from '@/store/walletStore'
import { getErc20Contract, getPublicLiquidityPoolContract, getPrivateAmmContract } from '@/utils/contracts'
import { CONTRACT_ADDRESSES } from '@/config/contracts'
import { usePublicLiquidityPools } from '@/hooks/usePublicLiquidityPools'
import { pickSwapPools, useLiveLiquidityPools } from '@/hooks/useLiveLiquidityPools'
import { proveSwap } from '@/utils/prover'
import { waitAndParseTransaction } from '@/utils/transactionHelper'
import PoolOracleGuardrailStrip from '@/components/PoolOracleGuardrailStrip'
import SwapCard from '@/components/swap/SwapCard'
import { consumeBridgeSwapIntentIfNew, resolvePoolIdFromBridgeContext } from '@/utils/bridgeSwapIntent'
import { executeOdosSwap } from '@/utils/odosSor'
import { isContractConfigured, isZkProvingConfigured } from '@/utils/productReadiness'
import { isCanonicalV3Active } from '@/utils/canonicalSwap'
import {
  AGS_DECIMALS,
  applySlippage,
  executeAegisPoolSwap,
  extractErrorMessage,
  fetchSwapQuote,
  isOdosEligible,
  poolLabel,
  slippageBpsFromPercent,
  type SwapDirection,
  type SwapRoute,
} from '@/utils/swapQuote'

export default function Swap() {
  const { provider, signer, address, isConnected } = useWalletStore()
  const [searchParams] = useSearchParams()
  const [selectedPoolId, setSelectedPoolId] = useState('')
  const [direction, setDirection] = useState<SwapDirection>('AGS_TO_QUOTE')
  const [amountIn, setAmountIn] = useState('')
  const [isExecuting, setIsExecuting] = useState(false)
  const [mode, setMode] = useState<'public' | 'private'>('public')
  const [route, setRoute] = useState<SwapRoute>('auto')
  const [slippagePercent, setSlippagePercent] = useState(0.5)

  const { pools: allPools } = usePublicLiquidityPools()
  const { data: liveRows = [] } = useLiveLiquidityPools(provider)
  const liveAddresses = new Set(liveRows.filter((r) => r.live).map((r) => r.pool.poolAddress.toLowerCase()))
  const { data: v3CanonicalActive = false } = useQuery({
    queryKey: ['canonical-v3-active'],
    queryFn: () => (provider ? isCanonicalV3Active(provider) : false),
    enabled: !!provider,
    staleTime: 30_000,
  })
  const pools = pickSwapPools({
    allPools,
    livePoolAddresses: liveAddresses,
    route,
    hideNativeWsDuplicates: v3CanonicalActive,
  })

  const privateAmmConfigured = isContractConfigured(CONTRACT_ADDRESSES.PRIVATE_AMM)
  const privateAmmProvingReady = isZkProvingConfigured()
  const privateAmmUsable = privateAmmConfigured && privateAmmProvingReady

  useEffect(() => {
    if (!pools.length) return
    if (!selectedPoolId) setSelectedPoolId(pools[0].id)

    const urlPool = searchParams.get('pool')
    const urlDir = searchParams.get('direction')
    const urlAmount = searchParams.get('amount')
    const intent = consumeBridgeSwapIntentIfNew()

    const poolFromUrl = urlPool && pools.some((p) => p.id === urlPool) ? urlPool : undefined
    const poolFromIntent =
      intent &&
      resolvePoolIdFromBridgeContext(pools, {
        poolId: intent.poolId,
        tokenSymbol: intent.tokenSymbol,
        tokenAddress: intent.tokenAddress ?? undefined,
      })
    const chosenPool = poolFromUrl ?? poolFromIntent
    if (chosenPool) setSelectedPoolId(chosenPool)

    const dirFromUrl = urlDir === 'AGS_TO_QUOTE' || urlDir === 'QUOTE_TO_AGS' ? urlDir : undefined
    const dirFromIntent =
      intent?.direction === 'AGS_TO_QUOTE' || intent?.direction === 'QUOTE_TO_AGS' ? intent.direction : undefined
    if (dirFromUrl ?? dirFromIntent) setDirection(dirFromUrl ?? dirFromIntent!)

    const amountFromUrl =
      urlAmount && !Number.isNaN(Number(urlAmount)) && Number(urlAmount) > 0 ? urlAmount : undefined
    const amountFromIntent =
      intent?.amount && !Number.isNaN(Number(intent.amount)) && Number(intent.amount) > 0 ? intent.amount : undefined
    if (amountFromUrl ?? amountFromIntent) setAmountIn(amountFromUrl ?? amountFromIntent!)
  }, [searchParams, pools])

  const selectedPool = pools.find((pool) => pool.id === selectedPoolId)
  const odosAvailable = isOdosEligible(selectedPool) && isConnected

  const { data: poolMeta } = useQuery({
    queryKey: ['pool-meta', selectedPool?.poolAddress, selectedPool?.tokenAddress],
    queryFn: async () => {
      if (!provider || !selectedPool) return null
      if (selectedPool.useNative) {
        return {
          quoteSymbol: selectedPool.tokenSymbol || 'S',
          quoteDecimals: 18,
          lpSymbol: selectedPool.lpSymbol,
        }
      }
      if (!selectedPool.tokenAddress) return null
      const token = getErc20Contract(selectedPool.tokenAddress, provider)
      const [symbol, decimals] = await Promise.all([
        token.symbol().catch(() => selectedPool.tokenSymbol ?? 'TOKEN'),
        token.decimals().catch(() => 18),
      ])
      return {
        quoteSymbol: symbol as string,
        quoteDecimals: Number(decimals),
        lpSymbol: selectedPool.lpSymbol,
      }
    },
    enabled: !!provider && !!selectedPool,
    staleTime: 60_000,
  })

  const { data: poolBalances } = useQuery({
    queryKey: ['pool-balances', selectedPool?.poolAddress],
    queryFn: async () => {
      if (!provider || !selectedPool) return null
      const contract = getPublicLiquidityPoolContract(selectedPool.poolAddress, provider)
      const [reserves, feeBps] = await Promise.all([contract.getReserves(), contract.feeBps()])
      return {
        reserveAgs: reserves[0] as bigint,
        reserveQuote: reserves[1] as bigint,
        feeBps: feeBps as bigint,
      }
    },
    enabled: !!provider && !!selectedPool,
    refetchInterval: 15_000,
  })

  const slippageBps = slippageBpsFromPercent(slippagePercent)

  const { data: quotePreview, isFetching: quoteLoading } = useQuery({
    queryKey: [
      'swap-quote',
      selectedPool?.poolAddress,
      direction,
      amountIn,
      route,
      address,
      slippagePercent,
    ],
    queryFn: async () => {
      if (!provider || !selectedPool || !poolMeta) return null
      return fetchSwapQuote({
        provider,
        selectedPool,
        poolMeta,
        direction,
        amountIn,
        route,
        userAddr: address ?? undefined,
        slippagePercent,
      })
    },
    enabled: !!provider && !!selectedPool && !!poolMeta && !!amountIn && Number(amountIn) > 0,
    refetchInterval: route === 'odos' || route === 'auto' ? 8_000 : 12_000,
    staleTime: 4_000,
  })

  const quoteTokenLabel = poolMeta?.quoteSymbol ?? (selectedPool ? poolLabel(selectedPool) : 'Token')
  const paySymbol = direction === 'AGS_TO_QUOTE' ? 'AGS' : quoteTokenLabel
  const receiveSymbol = direction === 'AGS_TO_QUOTE' ? quoteTokenLabel : 'AGS'

  async function handleSwap() {
    if (!signer || !address || !provider) {
      toast.error('Connect your wallet to swap.')
      return
    }
    if (!selectedPool || !poolMeta) {
      toast.error('Select a trading pair.')
      return
    }
    if (!amountIn || Number(amountIn) <= 0) {
      toast.error('Enter an amount.')
      return
    }
    if (!quotePreview?.amountOutRaw || quotePreview.amountOutRaw <= 0n) {
      toast.error('No quote available — check liquidity or try another route.')
      return
    }

    const inputDecimals = direction === 'AGS_TO_QUOTE' ? AGS_DECIMALS : poolMeta.quoteDecimals
    const parsedAmountIn = parseUnits(amountIn, inputDecimals)
    const minOut = applySlippage(quotePreview.amountOutRaw, slippageBps)

    try {
      setIsExecuting(true)

      if (quotePreview.routeUsed === 'odos') {
        const net = await provider.getNetwork()
        const inputTokenAddress =
          direction === 'AGS_TO_QUOTE' ? CONTRACT_ADDRESSES.TOKEN : selectedPool.tokenAddress!
        const outputTokenAddress =
          direction === 'AGS_TO_QUOTE' ? selectedPool.tokenAddress! : CONTRACT_ADDRESSES.TOKEN

        const stageLabels = {
          quote: 'Getting Odos quote…',
          assemble: 'Building route…',
          approve: 'Approve in wallet…',
          send: 'Confirm swap in wallet…',
        } as const

        toast.loading(stageLabels.quote, { id: 'odos-swap' })
        const result = await executeOdosSwap({
          signer,
          provider,
          userAddr: address,
          chainId: Number(net.chainId),
          inputTokenAddress,
          inputAmount: parsedAmountIn,
          outputTokenAddress,
          slippageLimitPercent: slippagePercent,
          onStage: (stage) => toast.loading(stageLabels[stage], { id: 'odos-swap' }),
        })

        if (result.ok) {
          toast.success('Swap confirmed on Sonic.', { id: 'odos-swap' })
          setAmountIn('')
        } else {
          toast.error('Swap reverted.', { id: 'odos-swap' })
        }
        return
      }

      const aegisVia =
        quotePreview.routeUsed === 'canonical-v3'
          ? 'canonical-v3'
          : quotePreview.routeUsed === 'router'
            ? 'router'
            : ('pool' as const)
      toast.loading('Confirm swap in wallet…', { id: 'aegis-swap' })
      const ok = await executeAegisPoolSwap(
        signer,
        address,
        provider,
        selectedPool,
        poolMeta,
        direction,
        parsedAmountIn,
        minOut,
        aegisVia
      )
      if (ok) {
        toast.success('Swap confirmed on Sonic.', { id: 'aegis-swap' })
        setAmountIn('')
      } else {
        toast.error('Swap reverted.', { id: 'aegis-swap' })
      }
    } catch (error) {
      if (route === 'odos' || (route === 'auto' && quotePreview.routeUsed === 'odos')) {
        toast.error(extractErrorMessage(error), { id: 'odos-swap' })
      } else {
        toast.error(extractErrorMessage(error), { id: 'aegis-swap' })
      }
    } finally {
      setIsExecuting(false)
    }
  }

  async function handlePrivateSwap() {
    if (!signer || !selectedPool || !poolMeta || !address || !provider) return
    try {
      const amm = getPrivateAmmContract(signer)
      const tokenA = CONTRACT_ADDRESSES.TOKEN
      const tokenB = selectedPool.tokenAddress ?? '0x0000000000000000000000000000000000000000'
      const poolId = solidityPackedKeccak256(['address', 'address'], [tokenA, tokenB])

      const inputDecimals = direction === 'AGS_TO_QUOTE' ? AGS_DECIMALS : poolMeta.quoteDecimals
      const parsedAmountIn = parseUnits(amountIn, inputDecimals)
      if (parsedAmountIn <= 0n) throw new Error('Invalid amount')

      const minOut = applySlippage(quotePreview?.amountOutRaw ?? 0n, slippageBps)
      const deadline = Math.floor(Date.now() / 1000) + 600
      const isAToB = direction === 'AGS_TO_QUOTE'

      const witness = {
        poolId,
        inputNullifier: '0x' + Buffer.from(randomBytes(32)).toString('hex'),
        outputCommitment: '0x' + Buffer.from(randomBytes(32)).toString('hex'),
        amountIn: parsedAmountIn.toString(),
        minAmountOut: minOut.toString(),
        isAToB: isAToB ? 1 : 0,
        deadline,
      }

      toast.loading('Generating proof…', { id: 'private-swap' })
      const { proof, publicInputs } = await proveSwap(witness)
      const tx = await amm.swap(poolId, proof, publicInputs)
      toast.loading('Confirm in wallet…', { id: 'private-swap' })
      const rc = await waitAndParseTransaction(tx, address, provider)
      if (rc?.status === 1) {
        toast.success('Private swap confirmed.', { id: 'private-swap' })
        setAmountIn('')
      } else {
        toast.error('Private swap reverted.', { id: 'private-swap' })
      }
    } catch (e) {
      toast.error(extractErrorMessage(e), { id: 'private-swap' })
    }
  }

  return (
    <div className="mx-auto max-w-lg space-y-5">
      <header className="space-y-2 text-center sm:text-left">
        <h1 className="text-2xl font-semibold text-terminal-text md:text-3xl">Swap</h1>
        <p className="text-sm text-terminal-text-dim">Trade AGS and bridged tokens on Sonic.</p>
        {mode === 'public' && selectedPool ? (
          <PoolOracleGuardrailStrip poolAddress={selectedPool.poolAddress} />
        ) : null}
      </header>

      <div className="flex rounded-lg border border-terminal-border/40 p-1 bg-terminal-bg/40">
        <button
          type="button"
          onClick={() => setMode('public')}
          className={`flex-1 rounded-md py-2 text-sm font-medium ${
            mode === 'public' ? 'bg-terminal-surface text-terminal-text shadow-sm' : 'text-terminal-text-dim'
          }`}
        >
          Public swap
        </button>
        <button
          type="button"
          onClick={() => setMode('private')}
          className={`flex-1 rounded-md py-2 text-sm font-medium ${
            mode === 'private' ? 'bg-terminal-accent/15 text-terminal-accent shadow-sm' : 'text-terminal-text-dim'
          }`}
        >
          Private (ZK)
        </button>
      </div>

      {mode === 'public' && (
        <>
          {pools.length === 0 ? (
            <div className="card border border-amber-500/30 bg-amber-500/10 text-sm text-terminal-text-dim">
              {route === 'aegis' ? (
                <>
                  No seeded Aegis pools yet. Switch to <strong>Auto</strong> or <strong>Odos</strong> for Sonic DEX
                  routing, or seed pools via treasury (see operator log).
                </>
              ) : allPools.length === 0 ? (
                <>
                  No pool addresses configured. Run <code>gen:frontend-env</code> and rebuild.
                </>
              ) : (
                <>
                  Aegis pools are empty; <strong>Auto/Odos</strong> may still quote via Sonic DEX liquidity.
                </>
              )}
            </div>
          ) : selectedPoolId ? (
            <SwapCard
              pools={pools}
              direction={direction}
              selectedPoolId={selectedPoolId}
              amountIn={amountIn}
              quote={quotePreview}
              quoteLoading={quoteLoading}
              route={route}
              slippagePercent={slippagePercent}
              paySymbol={paySymbol}
              receiveSymbol={receiveSymbol}
              isConnected={isConnected}
              isExecuting={isExecuting}
              odosAvailable={odosAvailable}
              onDirectionChange={setDirection}
              onPoolChange={setSelectedPoolId}
              onAmountChange={setAmountIn}
              onRouteChange={setRoute}
              onSlippageChange={setSlippagePercent}
              onSwap={handleSwap}
            />
          ) : (
            <div className="card text-sm text-terminal-text-dim">Loading pools…</div>
          )}

          {selectedPool && poolBalances && poolMeta ? (
            <details className="rounded-lg border border-terminal-border/30 bg-terminal-surface/40 px-4 py-3 text-xs text-terminal-text-dim">
              <summary className="cursor-pointer font-medium text-terminal-text">Pool details</summary>
              <div className="mt-3 space-y-1.5">
                <div className="flex justify-between">
                  <span>Reserves</span>
                  <span>
                    {formatBalance(poolBalances.reserveAgs)} AGS / {formatBalance(poolBalances.reserveQuote)}{' '}
                    {poolMeta.quoteSymbol}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Pool fee</span>
                  <span>{(Number(poolBalances.feeBps) / 100).toFixed(2)}%</span>
                </div>
                {poolMeta.lpSymbol ? (
                  <div className="flex justify-between">
                    <span>LP token</span>
                    <span>{poolMeta.lpSymbol}</span>
                  </div>
                ) : null}
              </div>
            </details>
          ) : null}
        </>
      )}

      {mode === 'private' && (
        <div className="card border border-terminal-accent/30 bg-terminal-accent/5 space-y-4">
          <div>
            <h2 className="text-lg font-semibold text-terminal-accent">Shielded swap</h2>
            <p className="text-sm text-terminal-text-dim mt-1">
              {privateAmmUsable
                ? 'Settle through PrivateAMM with a zero-knowledge proof — positions stay shielded.'
                : 'Private swaps are not available in this build yet.'}
            </p>
          </div>

          {pools.length > 0 && privateAmmUsable && selectedPoolId ? (
            <>
              <SwapCard
                pools={pools}
                direction={direction}
                selectedPoolId={selectedPoolId}
                amountIn={amountIn}
                quote={quotePreview}
                quoteLoading={quoteLoading}
                route="aegis"
                slippagePercent={slippagePercent}
                paySymbol={paySymbol}
                receiveSymbol={receiveSymbol}
                isConnected={isConnected}
                isExecuting={false}
                odosAvailable={false}
                showRouteSelector={false}
                onDirectionChange={setDirection}
                onPoolChange={setSelectedPoolId}
                onAmountChange={setAmountIn}
                onRouteChange={() => {}}
                onSlippageChange={setSlippagePercent}
                onSwap={handlePrivateSwap}
              />
            </>
          ) : null}
        </div>
      )}
    </div>
  )
}

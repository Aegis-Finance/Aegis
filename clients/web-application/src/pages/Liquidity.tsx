import { Link } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { formatBalance } from '@/utils/format'
import {
  formatUnits,
  parseUnits,
  MaxUint256,
} from 'ethers'
import toast from 'react-hot-toast'
import { useWalletStore } from '@/store/walletStore'
import { getErc20Contract, getPublicLiquidityPoolContract, getTokenContract } from '@/utils/contracts'
import { CONTRACT_ADDRESSES } from '@/config/contracts'
import { waitAndParseTransaction } from '@/utils/transactionHelper'
import { type PublicPoolConfig } from '@/config/liquidity'
import PoolSpotStrip from '@/components/PoolSpotStrip'
import PoolOracleGuardrailStrip from '@/components/PoolOracleGuardrailStrip'
import LiquidityEarnPanel from '@/components/LiquidityEarnPanel'
import { usePublicLiquidityPools } from '@/hooks/usePublicLiquidityPools'

type LiquidityMode = 'add' | 'remove'

const AGS_DECIMALS = 18

function extractErrorMessage(error: unknown): string {
  if (typeof error === 'string') return error
  if (error && typeof error === 'object') {
    const err = error as { shortMessage?: string; data?: { message?: string }; message?: string }
    return err.shortMessage ?? err.data?.message ?? err.message ?? 'Transaction failed'
  }
  return 'Transaction failed'
}

function lpAmountExceedsBalance(shares: string, balance: bigint | undefined): boolean {
  if (balance === undefined) return true
  try {
    return parseUnits(shares || '0', 18) > balance
  } catch {
    return true
  }
}

export default function Liquidity() {
  const { provider, signer, address, isConnected } = useWalletStore()
  const { pools } = usePublicLiquidityPools()
  const [selectedPoolId, setSelectedPoolId] = useState(pools[0]?.id ?? '')
  const [mode, setMode] = useState<LiquidityMode>('add')
  
  // Add liquidity state
  const [agsAmount, setAgsAmount] = useState('')
  const [quoteAmount, setQuoteAmount] = useState('')
  const [isAddingLiquidity, setIsAddingLiquidity] = useState(false)
  
  // Remove liquidity state
  const [lpShares, setLpShares] = useState('')
  const [isRemovingLiquidity, setIsRemovingLiquidity] = useState(false)

  const selectedPool: PublicPoolConfig | undefined = pools.find((pool) => pool.id === selectedPoolId)

  useEffect(() => {
    if (!selectedPoolId && pools[0]?.id) {
      setSelectedPoolId(pools[0].id)
    }
  }, [pools, selectedPoolId])

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
    staleTime: 60000,
  })

  const { data: poolBalances } = useQuery({
    queryKey: ['pool-balances', selectedPool?.poolAddress],
    queryFn: async () => {
      if (!provider || !selectedPool) return null
      const contract = getPublicLiquidityPoolContract(selectedPool.poolAddress, provider)
      const [reserves, feeBps, totalSupply] = await Promise.all([
        contract.getReserves(),
        contract.feeBps(),
        contract.totalSupply(),
      ])
      return {
        reserveAgs: reserves[0] as bigint,
        reserveQuote: reserves[1] as bigint,
        feeBps: feeBps as bigint,
        totalSupply: totalSupply as bigint,
      }
    },
    enabled: !!provider && !!selectedPool,
    refetchInterval: 12000,
  })

  // User balances
  const { data: agsBalance } = useQuery({
    queryKey: ['ags-balance', address],
    queryFn: async () => {
      if (!provider || !address) return 0n
      const token = getTokenContract(provider)
      return (await token.balanceOf(address)) as bigint
    },
    enabled: !!provider && !!address,
    refetchInterval: 12000,
  })

  const { data: quoteBalance } = useQuery({
    queryKey: ['quote-balance', selectedPool?.tokenAddress, selectedPool?.useNative, address],
    queryFn: async () => {
      if (!provider || !address || !selectedPool) return 0n
      if (selectedPool.useNative) {
        return await provider.getBalance(address)
      }
      if (!selectedPool.tokenAddress) return 0n
      const token = getErc20Contract(selectedPool.tokenAddress, provider)
      return (await token.balanceOf(address)) as bigint
    },
    enabled: !!provider && !!address && !!selectedPool,
    refetchInterval: 12000,
  })

  const { data: lpBalance } = useQuery({
    queryKey: ['lp-balance', selectedPool?.poolAddress, address],
    queryFn: async () => {
      if (!provider || !address || !selectedPool) return 0n
      const poolContract = getPublicLiquidityPoolContract(selectedPool.poolAddress, provider)
      return (await poolContract.balanceOf(address)) as bigint
    },
    enabled: !!provider && !!address && !!selectedPool && mode === 'remove',
    refetchInterval: 12000,
  })

  // Calculate LP shares for add liquidity
  const { data: lpSharesPreview } = useQuery({
    queryKey: ['lp-shares-preview', selectedPool?.poolAddress, agsAmount, quoteAmount],
    queryFn: async () => {
      if (!provider || !selectedPool || !poolBalances || !poolMeta) return null
      if (!agsAmount || !quoteAmount || Number(agsAmount) <= 0 || Number(quoteAmount) <= 0) return null

      const agsWei = parseUnits(agsAmount, AGS_DECIMALS)
      const quoteWei = parseUnits(quoteAmount, poolMeta.quoteDecimals)

      if (poolBalances.totalSupply === 0n) {
        // First liquidity provision
        const shares = agsWei * quoteWei
        const sqrt = (val: bigint) => {
          if (val === 0n) return 0n
          let z = (val + 1n) / 2n
          let y = val
          while (z < y) {
            y = z
            z = (val / z + z) / 2n
          }
          return y
        }
        const minLiquidity = 1000n // MINIMUM_LIQUIDITY
        return { shares: sqrt(shares) - minLiquidity, agsUsed: agsWei, quoteUsed: quoteWei }
      }

      // Calculate shares based on reserves
      const shares1 = (agsWei * poolBalances.totalSupply) / poolBalances.reserveAgs
      const shares2 = (quoteWei * poolBalances.totalSupply) / poolBalances.reserveQuote
      const shares = shares1 < shares2 ? shares1 : shares2
      return { shares, agsUsed: agsWei, quoteUsed: quoteWei }
    },
    enabled: !!provider && !!selectedPool && !!poolBalances && !!poolMeta && mode === 'add' && !!agsAmount && !!quoteAmount,
  })

  // Calculate output for remove liquidity
  const { data: removePreview } = useQuery({
    queryKey: ['remove-preview', selectedPool?.poolAddress, lpShares, poolBalances?.totalSupply?.toString() ?? '0'],
    queryFn: async () => {
      if (!poolBalances || !lpShares || Number(lpShares) <= 0 || poolBalances.totalSupply === 0n) return null
      
      const sharesWei = parseUnits(lpShares, 18) // LP tokens are 18 decimals
      const agsOut = (sharesWei * poolBalances.reserveAgs) / poolBalances.totalSupply
      const quoteOut = (sharesWei * poolBalances.reserveQuote) / poolBalances.totalSupply
      
      return { agsOut, quoteOut }
    },
    enabled: !!poolBalances && !!lpShares && mode === 'remove',
  })

  async function ensureAllowance(
    tokenAddress: string,
    owner: string,
    spender: string,
    amount: bigint
  ) {
    if (!signer) return
    const token = getErc20Contract(tokenAddress, signer)
    const allowance = (await token.allowance(owner, spender)) as bigint
    if (allowance >= amount) return

    const tx = await token.approve(spender, MaxUint256)
    toast.loading('Approving token spend...', { id: 'approval' })
    await tx.wait()
    toast.success('Allowance updated', { id: 'approval' })
  }

  async function handleAddLiquidity() {
    if (!signer || !address) {
      toast.error('Connect your wallet to add liquidity.')
      return
    }
    if (!selectedPool || !poolMeta || !lpSharesPreview) {
      toast.error('Invalid pool or amounts.')
      return
    }
    if (!agsAmount || !quoteAmount || Number(agsAmount) <= 0 || Number(quoteAmount) <= 0) {
      toast.error('Enter valid amounts.')
      return
    }

    try {
      setIsAddingLiquidity(true)

      const poolContract = getPublicLiquidityPoolContract(selectedPool.poolAddress, signer)
      const agsWei = parseUnits(agsAmount, AGS_DECIMALS)
      const quoteWei = parseUnits(quoteAmount, poolMeta.quoteDecimals)

      // Approve AGS
      await ensureAllowance(CONTRACT_ADDRESSES.TOKEN, address, selectedPool.poolAddress, agsWei)

      // Approve quote token (if not native)
      if (!selectedPool.useNative && selectedPool.tokenAddress) {
        await ensureAllowance(selectedPool.tokenAddress, address, selectedPool.poolAddress, quoteWei)
      }

      // Calculate minimum shares (0.5% slippage)
      const minShares = (lpSharesPreview.shares * 9950n) / 10000n

      let tx
      if (selectedPool.useNative) {
        tx = await poolContract.addLiquidity(
          agsWei,
          quoteWei,
          minShares,
          address,
          { value: quoteWei }
        )
      } else {
        tx = await poolContract.addLiquidity(
          agsWei,
          quoteWei,
          minShares,
          address
        )
      }

      toast.loading('Adding liquidity...', { id: 'add-liquidity' })
      const receipt = await waitAndParseTransaction(tx, address!, provider!)
      if (receipt && receipt.status === 1) {
        toast.success('Liquidity added successfully.', { id: 'add-liquidity' })
        setAgsAmount('')
        setQuoteAmount('')
      } else {
        toast.error('Transaction reverted.', { id: 'add-liquidity' })
      }
    } catch (error: unknown) {
      toast.error(extractErrorMessage(error), { id: 'add-liquidity' })
    } finally {
      setIsAddingLiquidity(false)
    }
  }

  async function handleRemoveLiquidity() {
    if (!signer || !address) {
      toast.error('Connect your wallet to remove liquidity.')
      return
    }
    if (!selectedPool || !poolMeta || !removePreview || !lpBalance) {
      toast.error('Invalid pool or amounts.')
      return
    }
    if (!lpShares || Number(lpShares) <= 0) {
      toast.error('Enter LP token amount.')
      return
    }

    try {
      setIsRemovingLiquidity(true)

      const poolContract = getPublicLiquidityPoolContract(selectedPool.poolAddress, signer)
      const sharesWei = parseUnits(lpShares, 18)

      if (sharesWei > lpBalance) {
        toast.error('Insufficient LP token balance.')
        return
      }

      // Approve LP tokens
      await ensureAllowance(selectedPool.poolAddress, address, selectedPool.poolAddress, sharesWei)

      // Calculate minimum outputs (0.5% slippage)
      const minAgs = (removePreview.agsOut * 9950n) / 10000n
      const minQuote = (removePreview.quoteOut * 9950n) / 10000n

      const tx = await poolContract.removeLiquidity(
        sharesWei,
        minAgs,
        minQuote,
        address
      )

      toast.loading('Removing liquidity...', { id: 'remove-liquidity' })
      const receipt = await waitAndParseTransaction(tx, address!, provider!)
      if (receipt && receipt.status === 1) {
        toast.success('Liquidity removed successfully.', { id: 'remove-liquidity' })
        setLpShares('')
      } else {
        toast.error('Transaction reverted.', { id: 'remove-liquidity' })
      }
    } catch (error: unknown) {
      toast.error(extractErrorMessage(error), { id: 'remove-liquidity' })
    } finally {
      setIsRemovingLiquidity(false)
    }
  }

  // Auto-calculate quote amount based on AGS amount and pool ratio
  useEffect(() => {
    if (mode === 'add' && selectedPool && poolBalances && poolMeta && agsAmount && Number(agsAmount) > 0 && !quoteAmount) {
      try {
        const agsWei = parseUnits(agsAmount, AGS_DECIMALS)
        if (poolBalances.reserveAgs > 0n) {
          const ratio = (poolBalances.reserveQuote * agsWei) / poolBalances.reserveAgs
          const quoteValue = formatUnits(ratio, poolMeta.quoteDecimals)
          setQuoteAmount(quoteValue)
        }
      } catch {
        // Ignore parse errors
      }
    }
  }, [agsAmount, selectedPool, poolBalances, poolMeta, mode, quoteAmount])

  return (
    <div className="mx-auto max-w-5xl space-y-7">
      <header className="space-y-3">
        <div>
          <h1 className="text-2xl font-semibold text-terminal-text md:text-3xl">Liquidity</h1>
          <p className="mt-1 text-sm text-terminal-text-dim">
            Add or remove AGS and quote in a pool. LP share tracks reserves and fees; impermanent loss is real.
          </p>
          <p className="mt-1 text-xs text-terminal-text-dim">
            <Link to="/treasury-incentives" className="text-terminal-accent underline-offset-2 hover:underline">
              Treasury &amp; LP incentives
            </Link>
          </p>
        </div>
        <PoolSpotStrip />
        {selectedPool ? <PoolOracleGuardrailStrip poolAddress={selectedPool.poolAddress} /> : null}
      </header>

      {selectedPool && poolMeta && (selectedPool.id.toUpperCase() === 'USDC' || selectedPool.id.toUpperCase() === 'SONIC') ? (
        <LiquidityEarnPanel pool={selectedPool} poolMeta={poolMeta} />
      ) : null}

      <section className="grid gap-6 xl:grid-cols-3">
        <div className="card xl:col-span-2 space-y-6 border border-terminal-border/60 bg-terminal-surface/60 backdrop-blur">
          {/* Mode Tabs */}
          <div className="flex gap-2 border-terminal-border border-b">
            {(['add', 'remove'] as LiquidityMode[]).map((m) => (
              <button
                key={m}
                onClick={() => {
                  setMode(m)
                  if (m === 'add') {
                    setLpShares('')
                  } else {
                    setAgsAmount('')
                    setQuoteAmount('')
                  }
                }}
                className={`px-4 py-2 font-medium capitalize transition-colors ${
                  mode === m
                    ? 'text-terminal-accent border-b-2 border-terminal-accent'
                    : 'text-terminal-text-dim hover:text-terminal-text'
                }`}
              >
                {m === 'add' ? 'Add Liquidity' : 'Remove Liquidity'}
              </button>
            ))}
          </div>

          {pools.length === 0 ? (
            <div className="rounded-lg border border-terminal-warning/30 bg-terminal-warning/10 p-4 text-terminal-warning text-sm">
              No liquidity pools are configured for this deployment.
            </div>
          ) : mode === 'add' ? (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-terminal-text mb-2">Select pool</label>
                <select
                  value={selectedPoolId}
                  onChange={(event) => setSelectedPoolId(event.target.value)}
                  className="input-field w-full"
                >
                  {pools.map((pool) => (
                    <option key={pool.id} value={pool.id}>
                      AGS / {pool.tokenSymbol}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-terminal-text mb-2">AGS Amount</label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={agsAmount}
                    onChange={(event) => setAgsAmount(event.target.value)}
                    className="input-field w-full"
                    placeholder="0.00"
                  />
                  <p className="text-xs text-terminal-text-dim mt-1">
                    Balance: {formatBalance(agsBalance || 0n)} AGS
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-terminal-text mb-2">
                    {poolMeta?.quoteSymbol ?? 'Quote Token'} Amount
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={quoteAmount}
                    onChange={(event) => setQuoteAmount(event.target.value)}
                    className="input-field w-full"
                    placeholder="0.00"
                  />
                  <p className="text-xs text-terminal-text-dim mt-1">
                    Balance: {formatBalance(quoteBalance || 0n, poolMeta?.quoteDecimals ?? 18)} {poolMeta?.quoteSymbol ?? 'TOKEN'}
                  </p>
                </div>

                {lpSharesPreview && (
                  <div className="rounded-lg border border-terminal-border/50 bg-terminal-bg p-4 space-y-2">
                    <div className="flex justify-between">
                      <span className="text-terminal-text-dim">You'll receive</span>
                      <span className="font-semibold text-terminal-accent">
                        {formatBalance(lpSharesPreview.shares, 18)} {poolMeta?.lpSymbol ?? 'LP'}
                      </span>
                    </div>
                    <div className="text-xs text-terminal-text-dim">
                      Shares calculated based on current pool ratio
                    </div>
                  </div>
                )}

                <button
                  onClick={handleAddLiquidity}
                  className="btn-primary w-full"
                  disabled={
                    !isConnected ||
                    !selectedPool ||
                    isAddingLiquidity ||
                    !agsAmount ||
                    !quoteAmount ||
                    Number(agsAmount) <= 0 ||
                    Number(quoteAmount) <= 0 ||
                    !lpSharesPreview
                  }
                >
                  {isAddingLiquidity ? 'Adding Liquidity...' : 'Add Liquidity'}
                </button>

                {!isConnected && (
                  <p className="text-xs text-terminal-warning">
                    Connect your wallet to add liquidity to pools.
                  </p>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-terminal-text mb-2">Select pool</label>
                <select
                  value={selectedPoolId}
                  onChange={(event) => setSelectedPoolId(event.target.value)}
                  className="input-field w-full"
                >
                  {pools.map((pool) => (
                    <option key={pool.id} value={pool.id}>
                      AGS / {pool.tokenSymbol}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-terminal-text mb-2">LP Token Amount</label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={lpShares}
                    onChange={(event) => setLpShares(event.target.value)}
                    className="input-field w-full"
                    placeholder="0.00"
                  />
                  <p className="text-xs text-terminal-text-dim mt-1">
                    Balance: {formatBalance(lpBalance || 0n, 18)} {poolMeta?.lpSymbol ?? 'LP'}
                  </p>
                </div>

                {removePreview && (
                  <div className="rounded-lg border border-terminal-border/50 bg-terminal-bg p-4 space-y-2">
                    <div className="flex justify-between">
                      <span className="text-terminal-text-dim">You'll receive</span>
                      <span className="font-semibold text-terminal-accent">
                        {formatBalance(removePreview.agsOut, 18)} AGS
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-terminal-text-dim">and</span>
                      <span className="font-semibold text-terminal-accent">
                        {formatBalance(removePreview.quoteOut, poolMeta?.quoteDecimals ?? 18)} {poolMeta?.quoteSymbol ?? 'TOKEN'}
                      </span>
                    </div>
                  </div>
                )}

                <button
                  onClick={handleRemoveLiquidity}
                  className="btn-primary w-full"
                  disabled={
                    !isConnected ||
                    !selectedPool ||
                    isRemovingLiquidity ||
                    !lpShares ||
                    Number(lpShares) <= 0 ||
                    !removePreview ||
                    lpAmountExceedsBalance(lpShares, lpBalance)
                  }
                >
                  {isRemovingLiquidity ? 'Removing Liquidity...' : 'Remove Liquidity'}
                </button>

                {!isConnected && (
                  <p className="text-xs text-terminal-warning">
                    Connect your wallet to remove liquidity from pools.
                  </p>
                )}
              </div>
            </div>
          )}
        </div>

        <aside className="space-y-5">
          {selectedPool && poolBalances && poolMeta && (
            <div className="card border border-terminal-border/40 bg-terminal-bg space-y-3 text-sm">
              <h3 className="text-terminal-text font-semibold text-base">Pool Info</h3>
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-terminal-text-dim">Pool</span>
                  <span className="text-terminal-text">AGS / {poolMeta.quoteSymbol}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-terminal-text-dim">Reserves</span>
                  <span className="text-terminal-text">
                    {formatBalance(poolBalances.reserveAgs)} AGS / {formatBalance(poolBalances.reserveQuote)} {poolMeta.quoteSymbol}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-terminal-text-dim">LP Token</span>
                  <span className="text-terminal-text">{poolMeta.lpSymbol}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-terminal-text-dim">Trading Fee</span>
                  <span className="text-terminal-text">
                    {(Number(poolBalances.feeBps) / 100).toFixed(2)}%
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-terminal-text-dim">Total LP Supply</span>
                  <span className="text-terminal-text">
                    {formatBalance(poolBalances.totalSupply, 18)}
                  </span>
                </div>
              </div>
            </div>
          )}
        </aside>
      </section>
    </div>
  )
}


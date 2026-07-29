import { Link } from 'react-router-dom'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { MaxUint256, parseUnits } from 'ethers'
import toast from 'react-hot-toast'
import { useWalletStore } from '@/store/walletStore'
import { formatBalance } from '@/utils/format'
import {
  getErc20Contract,
  getLiquidityMiningGaugeContract,
  getPublicLiquidityPoolContract,
  getTokenContract,
} from '@/utils/contracts'
import { CONTRACT_ADDRESSES } from '@/config/contracts'
import type { PublicPoolConfig } from '@/config/liquidity'
import { usePoolLiquidityGauge } from '@/hooks/usePoolLiquidityGauge'
import { formatApr } from '@/utils/liquidityMiningMetrics'
import { waitAndParseTransaction } from '@/utils/transactionHelper'
import { submitViaRelayer } from '@/utils/submitViaRelayer'

type Props = {
  pool: PublicPoolConfig
  poolMeta: { quoteSymbol: string; quoteDecimals: number }
}

export default function LiquidityEarnPanel({ pool, poolMeta }: Props) {
  const { provider, signer, address, isConnected } = useWalletStore()
  const { data: gaugeInfo, refetch: refetchGauge } = usePoolLiquidityGauge(provider, pool.id)
  const [agsAmount, setAgsAmount] = useState('')
  const [quoteAmount, setQuoteAmount] = useState('')
  const [busy, setBusy] = useState(false)

  const { data: balances } = useQuery({
    queryKey: ['earn-balances', address, pool.poolAddress],
    queryFn: async () => {
      if (!provider || !address) return null
      const ags = getTokenContract(provider)
      const agsBal = await ags.balanceOf(address)
      let quoteBal = 0n
      if (pool.useNative) {
        quoteBal = await provider.getBalance(address)
      } else if (pool.tokenAddress) {
        quoteBal = await getErc20Contract(pool.tokenAddress, provider).balanceOf(address)
      }
      return { agsBal: agsBal as bigint, quoteBal }
    },
    enabled: !!provider && !!address,
  })

  const status = gaugeInfo?.status ?? 'no_emissions'
  const isUsdc = pool.id.toUpperCase() === 'USDC'

  async function handleAddAndStake() {
    if (!signer || !address || !provider || !gaugeInfo?.gaugeAddress) {
      toast.error('Connect wallet and ensure gauge is deployed')
      return
    }
    if (!agsAmount || !quoteAmount || Number(agsAmount) <= 0 || Number(quoteAmount) <= 0) {
      toast.error('Enter AGS and quote amounts')
      return
    }
    setBusy(true)
    try {
      const poolContract = getPublicLiquidityPoolContract(pool.poolAddress, signer)
      const gauge = getLiquidityMiningGaugeContract(signer, gaugeInfo.gaugeAddress)
      if (!gauge) throw new Error('Gauge unavailable')

      const agsWei = parseUnits(agsAmount, 18)
      const quoteWei = parseUnits(quoteAmount, poolMeta.quoteDecimals)

      const agsToken = getErc20Contract(CONTRACT_ADDRESSES.TOKEN, signer)
      if ((await agsToken.allowance(address, pool.poolAddress)) < agsWei) {
        toast.loading('Approving AGS…', { id: 'earn-lp' })
        await (await agsToken.approve(pool.poolAddress, MaxUint256)).wait()
      }
      if (!pool.useNative && pool.tokenAddress) {
        const qt = getErc20Contract(pool.tokenAddress, signer)
        if ((await qt.allowance(address, pool.poolAddress)) < quoteWei) {
          toast.loading('Approving quote…', { id: 'earn-lp' })
          await (await qt.approve(pool.poolAddress, MaxUint256)).wait()
        }
      }

      toast.loading('Adding liquidity…', { id: 'earn-lp' })
      const lpBefore = (await getErc20Contract(pool.poolAddress, provider).balanceOf(address)) as bigint
      const addTx = pool.useNative
        ? await poolContract.addLiquidity(agsWei, quoteWei, 0n, address, { value: quoteWei })
        : await poolContract.addLiquidity(agsWei, quoteWei, 0n, address)
      await waitAndParseTransaction(addTx, address, provider)

      const lpAfter = (await getErc20Contract(pool.poolAddress, provider).balanceOf(address)) as bigint
      const minted = lpAfter - lpBefore
      if (minted <= 0n) throw new Error('No LP minted')

      const gaugeAddress = gaugeInfo.gaugeAddress
      if ((await getErc20Contract(pool.poolAddress, provider).allowance(address, gaugeAddress)) < minted) {
        toast.loading('Approving LP for gauge…', { id: 'earn-lp' })
        await (await getErc20Contract(pool.poolAddress, signer).approve(gaugeAddress, MaxUint256)).wait()
      }

      toast.loading('Staking LP in gauge…', { id: 'earn-lp' })
      const stakeTx = await submitViaRelayer({
        signer,
        provider,
        walletAddress: address,
        target: gauge,
        method: 'stake',
        methodArgs: [minted],
        fallbackTx: () => gauge.stake(minted),
      })
      await waitAndParseTransaction(stakeTx, address, provider)
      toast.success('Liquidity added and staked — earning AGS emissions', { id: 'earn-lp' })
      setAgsAmount('')
      setQuoteAmount('')
      void refetchGauge()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed', { id: 'earn-lp' })
    } finally {
      setBusy(false)
    }
  }

  if (!gaugeInfo) {
    return (
      <div className="card text-sm text-terminal-text-dim">
        Community LP mining gauge for {poolMeta.quoteSymbol} is not configured yet.
      </div>
    )
  }

  return (
    <div className="card space-y-4 border border-terminal-accent/20">
      <div>
        <h2 className="text-lg font-semibold text-terminal-accent">
          Earn AGS — provide {poolMeta.quoteSymbol} liquidity
        </h2>
        <p className="text-sm text-terminal-text-dim mt-1">
          You supply {poolMeta.quoteSymbol} and AGS; the DAO pays emissions in <strong>AGS only</strong>. Rates are
          on-chain — no treasury USDC required. First providers set the pool price and earn the highest share of
          rewards.
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
        <div className="rounded-lg bg-terminal-bg/60 p-3">
          <p className="text-terminal-text-dim text-xs">Status</p>
          <p className="font-medium capitalize">{status.replace(/_/g, ' ')}</p>
        </div>
        <div className="rounded-lg bg-terminal-bg/60 p-3">
          <p className="text-terminal-text-dim text-xs">AGS APR (per LP, on-chain)</p>
          <p className="font-medium">{formatApr(gaugeInfo.aprAgsPercent)}</p>
        </div>
        <div className="rounded-lg bg-terminal-bg/60 p-3">
          <p className="text-terminal-text-dim text-xs">Emission rate</p>
          <p className="font-medium">{formatBalance(gaugeInfo.activeRate)} AGS/s</p>
        </div>
        <div className="rounded-lg bg-terminal-bg/60 p-3">
          <p className="text-terminal-text-dim text-xs">Epoch ends in</p>
          <p className="font-medium">
            {gaugeInfo.secondsLeft > 0n
              ? `${Math.floor(Number(gaugeInfo.secondsLeft) / 86400)}d ${Math.floor((Number(gaugeInfo.secondsLeft) % 86400) / 3600)}h`
              : '—'}
          </p>
        </div>
      </div>

      {status === 'no_emissions' ? (
        <p className="text-sm text-amber-600">Governance has not funded this epoch yet — check back soon.</p>
      ) : null}

      {isUsdc && status === 'needs_liquidity' ? (
        <div className="text-sm text-terminal-text-dim space-y-2">
          <p>
            Bridge USDC to Sonic via{' '}
            <Link to="/bridge" className="text-terminal-accent underline">
              Gateway
            </Link>
            , then add matching AGS + USDC below.
          </p>
          <p>
            <strong className="text-terminal-text">Need AGS?</strong> Until the Dutch auction opens: swap via{' '}
            <Link to="/swap" className="text-terminal-accent underline">
              Swap → Auto/Odos
            </Link>{' '}
            (external Sonic liquidity), or swap <strong>S → AGS</strong> on the live AGS/S pool after bridging native S.
          </p>
        </div>
      ) : null}

      {isConnected ? (
        <div className="space-y-3">
          <p className="text-xs text-terminal-text-dim">
            Balances: {formatBalance(balances?.agsBal ?? 0n)} AGS · {formatBalance(balances?.quoteBal ?? 0n)}{' '}
            {poolMeta.quoteSymbol}
          </p>
          <div className="grid sm:grid-cols-2 gap-3">
            <input
              className="input-field"
              placeholder="AGS amount"
              value={agsAmount}
              onChange={(e) => setAgsAmount(e.target.value)}
              disabled={busy}
            />
            <input
              className="input-field"
              placeholder={`${poolMeta.quoteSymbol} amount`}
              value={quoteAmount}
              onChange={(e) => setQuoteAmount(e.target.value)}
              disabled={busy}
            />
          </div>
          <button type="button" className="btn-primary" disabled={busy || gaugeInfo.snapshot.paused} onClick={() => void handleAddAndStake()}>
            {busy ? 'Working…' : 'Add liquidity & stake for AGS'}
          </button>
        </div>
      ) : (
        <p className="text-sm text-terminal-text-dim">Connect wallet to provide liquidity.</p>
      )}

      <p className="text-xs text-terminal-text-dim">
        USD APR depends on AGS price and pool depth — we show AGS-denominated APR from `rewardRate` ÷ staked LP so
        emissions are never overstated.
      </p>
    </div>
  )
}

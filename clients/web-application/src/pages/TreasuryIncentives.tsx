import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { parseUnits, MaxUint256, isAddress } from 'ethers'
import toast from 'react-hot-toast'
import { useWalletStore } from '@/store/walletStore'
import {
  getErc20Contract,
  getLiquidityMiningGaugeContract,
  getTreasuryBondAuctionContract,
} from '@/utils/contracts'
import { CONTRACT_ADDRESSES, ZERO_ADDRESS } from '@/config/contracts'
import { waitAndParseTransaction } from '@/utils/transactionHelper'
import { formatBalance } from '@/utils/format'

function extractErrorMessage(error: unknown): string {
  if (typeof error === 'string') return error
  if (error && typeof error === 'object') {
    const err = error as { shortMessage?: string; message?: string }
    return err.shortMessage ?? err.message ?? 'Transaction failed'
  }
  return 'Transaction failed'
}

function formatUnixTime(ts: bigint): string {
  if (ts <= 0n) return '—'
  return new Date(Number(ts) * 1000).toLocaleString()
}

const NOTE_SCAN_WINDOW = 48n

export default function TreasuryIncentives() {
  const { provider, signer, address, isConnected } = useWalletStore()

  const gaugeAddr = CONTRACT_ADDRESSES.LIQUIDITY_MINING_GAUGE
  const auctionAddr = CONTRACT_ADDRESSES.TREASURY_BOND_AUCTION
  const gaugeConfigured = gaugeAddr !== ZERO_ADDRESS
  const auctionConfigured = auctionAddr !== ZERO_ADDRESS

  const [stakeAmt, setStakeAmt] = useState('')
  const [withdrawAmt, setWithdrawAmt] = useState('')
  const [rewardRecipient, setRewardRecipient] = useState('')
  const [withdrawRecipient, setWithdrawRecipient] = useState('')
  const [exitStakeTo, setExitStakeTo] = useState('')
  const [exitRewardTo, setExitRewardTo] = useState('')
  const [busy, setBusy] = useState<string | null>(null)

  const [quoteMax, setQuoteMax] = useState('')
  const [minAgsFace, setMinAgsFace] = useState('0')
  const [noteHolder, setNoteHolder] = useState('')
  const [redeemNoteId, setRedeemNoteId] = useState('')

  const { data: gaugeTokens } = useQuery({
    queryKey: ['gauge-tokens', gaugeAddr, provider],
    queryFn: async () => {
      if (!provider || !gaugeConfigured) return null
      const g = getLiquidityMiningGaugeContract(provider)
      if (!g) return null
      const [stake, reward] = await Promise.all([g.STAKE_TOKEN(), g.REWARD_TOKEN()])
      const stakeErc = getErc20Contract(stake, provider)
      const rewardErc = getErc20Contract(reward, provider)
      const [stakeSym, stakeDec, rewardSym, rewardDec] = await Promise.all([
        stakeErc.symbol().catch(() => 'LP'),
        stakeErc.decimals().catch(() => 18),
        rewardErc.symbol().catch(() => 'AGS'),
        rewardErc.decimals().catch(() => 18),
      ])
      return {
        stakeToken: stake as string,
        rewardToken: reward as string,
        stakeSymbol: String(stakeSym),
        rewardSymbol: String(rewardSym),
        stakeDecimals: Number(stakeDec),
        rewardDecimals: Number(rewardDec),
      }
    },
    enabled: !!provider && gaugeConfigured,
    staleTime: 60000,
  })

  const { data: gaugeState, refetch: refetchGauge } = useQuery({
    queryKey: ['gauge-state', gaugeAddr, address, provider],
    queryFn: async () => {
      if (!provider || !gaugeConfigured || !address) return null
      const g = getLiquidityMiningGaugeContract(provider)
      if (!g) return null
      const [staked, earned, paused, total, periodFinish, rewardRate] = await Promise.all([
        g.balanceOf(address),
        g.earned(address),
        g.paused(),
        g.totalSupply(),
        g.periodFinish(),
        g.rewardRate(),
      ])
      return {
        staked: staked as bigint,
        earned: earned as bigint,
        paused: Boolean(paused),
        totalSupply: total as bigint,
        periodFinish: periodFinish as bigint,
        rewardRate: rewardRate as bigint,
      }
    },
    enabled: !!provider && gaugeConfigured && !!address,
    refetchInterval: 12000,
  })

  const { data: auctionMeta, refetch: refetchAuction } = useQuery({
    queryKey: ['auction-meta', auctionAddr, provider],
    queryFn: async () => {
      if (!provider || !auctionConfigured) return null
      const a = getTreasuryBondAuctionContract(provider)
      if (!a) return null
      const [ags, quote, id, completed, cap, sold, start, end, mat, nextId] = await Promise.all([
        a.AGS(),
        a.QUOTE_TOKEN(),
        a.auctionId(),
        a.auctionCompleted(),
        a.agsCapacity(),
        a.agsSold(),
        a.auctionStart(),
        a.auctionEnd(),
        a.maturity(),
        a.nextNoteId(),
      ])
      const quoteErc = getErc20Contract(quote, provider)
      const [quoteSym, quoteDec] = await Promise.all([
        quoteErc.symbol().catch(() => 'QUOTE'),
        quoteErc.decimals().catch(() => 18),
      ])
      let priceWad = 0n
      try {
        priceWad = (await a.spotPriceQuotePerAgsWad()) as bigint
      } catch {
        priceWad = 0n
      }
      return {
        ags: ags as string,
        quote: quote as string,
        auctionId: id as bigint,
        completed: Boolean(completed),
        capacity: cap as bigint,
        sold: sold as bigint,
        auctionStart: start as bigint,
        auctionEnd: end as bigint,
        maturity: mat as bigint,
        nextNoteId: nextId as bigint,
        quoteSymbol: String(quoteSym),
        quoteDecimals: Number(quoteDec),
        spotPriceWad: priceWad,
      }
    },
    enabled: !!provider && auctionConfigured,
    refetchInterval: 10000,
  })

  const { data: myNotes, refetch: refetchNotes } = useQuery({
    queryKey: ['my-bond-notes', auctionAddr, address, auctionMeta?.nextNoteId?.toString(), provider],
    queryFn: async () => {
      if (!provider || !auctionConfigured || !address || !auctionMeta) return []
      const a = getTreasuryBondAuctionContract(provider)
      if (!a) return []
      const next = auctionMeta.nextNoteId
      if (next === 0n) return []
      const out: { id: bigint; agsFace: bigint; maturity: bigint; redeemed: boolean }[] = []
      const start = next - 1n
      const lo = start >= NOTE_SCAN_WINDOW ? start - (NOTE_SCAN_WINDOW - 1n) : 0n
      for (let i = start; i >= lo; i--) {
        const owner = (await a.noteOwner(i)) as string
        if (owner.toLowerCase() !== address.toLowerCase()) continue
        const n = await a.notes(i)
        const agsFace = n[0] as bigint
        const maturity = n[1] as bigint
        const redeemed = n[2] as boolean
        out.push({ id: i, agsFace, maturity, redeemed })
      }
      return out
    },
    enabled: !!provider && auctionConfigured && !!address && !!auctionMeta && auctionMeta.nextNoteId > 0n,
    refetchInterval: 15000,
  })

  const { data: chainNow } = useQuery({
    queryKey: ['block-now', provider],
    queryFn: async () => {
      if (!provider) return 0n
      const b = await provider.getBlock('latest')
      return BigInt(b?.timestamp ?? 0)
    },
    enabled: !!provider && auctionConfigured,
    refetchInterval: 15000,
  })

  async function ensureAllowance(token: string, owner: string, spender: string, amount: bigint) {
    if (!signer) return
    const t = getErc20Contract(token, signer)
    const allowance = (await t.allowance(owner, spender)) as bigint
    if (allowance >= amount) return
    const tx = await t.approve(spender, MaxUint256)
    toast.loading('Approving…', { id: 'ap' })
    await tx.wait()
    toast.success('Approved', { id: 'ap' })
  }

  async function handleStake() {
    if (!signer || !address || !gaugeConfigured || !gaugeTokens || !gaugeState) return
    if (gaugeState.paused) {
      toast.error('Rewards program is paused.')
      return
    }
    const w = parseUnits(stakeAmt || '0', gaugeTokens.stakeDecimals)
    if (w <= 0n) {
      toast.error('Enter an amount to stake.')
      return
    }
    const g = getLiquidityMiningGaugeContract(signer)
    if (!g) return
    try {
      setBusy('stake')
      await ensureAllowance(gaugeTokens.stakeToken, address, gaugeAddr, w)
      const tx = await g.stake(w)
      toast.loading('Staking…', { id: 'st' })
      await waitAndParseTransaction(tx, address, provider!)
      toast.success('LP staked', { id: 'st' })
      setStakeAmt('')
      refetchGauge()
    } catch (e: unknown) {
      toast.error(extractErrorMessage(e), { id: 'st' })
    } finally {
      setBusy(null)
    }
  }

  async function handleWithdraw() {
    if (!signer || !address || !gaugeConfigured || !gaugeTokens) return
    const w = parseUnits(withdrawAmt || '0', gaugeTokens.stakeDecimals)
    if (w <= 0n) {
      toast.error('Enter an amount to withdraw.')
      return
    }
    const g = getLiquidityMiningGaugeContract(signer)
    if (!g) return
    const rec = withdrawRecipient.trim()
    try {
      setBusy('wd')
      const tx =
        rec && isAddress(rec)
          ? await g.withdrawTo(rec, w)
          : await g.withdraw(w)
      toast.loading('Withdrawing…', { id: 'wd' })
      await waitAndParseTransaction(tx, address, provider!)
      toast.success('LP withdrawn', { id: 'wd' })
      setWithdrawAmt('')
      setWithdrawRecipient('')
      refetchGauge()
    } catch (e: unknown) {
      toast.error(extractErrorMessage(e), { id: 'wd' })
    } finally {
      setBusy(null)
    }
  }

  async function handleClaimReward() {
    if (!signer || !address || !gaugeConfigured) return
    const g = getLiquidityMiningGaugeContract(signer)
    if (!g) return
    const rec = rewardRecipient.trim()
    try {
      setBusy('rw')
      const tx =
        rec && isAddress(rec) ? await g.getRewardTo(rec) : await g.getReward()
      toast.loading('Claiming…', { id: 'rw' })
      await waitAndParseTransaction(tx, address, provider!)
      toast.success('Rewards claimed', { id: 'rw' })
      setRewardRecipient('')
      refetchGauge()
    } catch (e: unknown) {
      toast.error(extractErrorMessage(e), { id: 'rw' })
    } finally {
      setBusy(null)
    }
  }

  async function handleExit() {
    if (!signer || !address || !gaugeConfigured) return
    const g = getLiquidityMiningGaugeContract(signer)
    if (!g) return
    const rs = exitStakeTo.trim()
    const rr = exitRewardTo.trim()
    try {
      setBusy('ex')
      const tx =
        rs && rr && isAddress(rs) && isAddress(rr)
          ? await g.exitTo(rs, rr)
          : await g.exit()
      toast.loading('Exiting…', { id: 'ex' })
      await waitAndParseTransaction(tx, address, provider!)
      toast.success('Staked LP and rewards withdrawn', { id: 'ex' })
      setExitStakeTo('')
      setExitRewardTo('')
      refetchGauge()
    } catch (e: unknown) {
      toast.error(extractErrorMessage(e), { id: 'ex' })
    } finally {
      setBusy(null)
    }
  }

  async function handlePurchase() {
    if (!signer || !address || !auctionConfigured || !auctionMeta) return
    const qm = parseUnits(quoteMax || '0', auctionMeta.quoteDecimals)
    const minAgs = parseUnits(minAgsFace || '0', 18)
    if (qm <= 0n) {
      toast.error('Enter how much you want to spend.')
      return
    }
    const a = getTreasuryBondAuctionContract(signer)
    if (!a) return
    const holder = noteHolder.trim()
    try {
      setBusy('buy')
      await ensureAllowance(auctionMeta.quote, address, auctionAddr, qm)
      const tx =
        holder && isAddress(holder)
          ? await a.purchaseTo(holder, qm, minAgs)
          : await a.purchase(qm, minAgs)
      toast.loading('Purchasing…', { id: 'buy' })
      await waitAndParseTransaction(tx, address, provider!)
      toast.success('Treasury note purchased', { id: 'buy' })
      setQuoteMax('')
      setNoteHolder('')
      refetchAuction()
      refetchNotes()
    } catch (e: unknown) {
      toast.error(extractErrorMessage(e), { id: 'buy' })
    } finally {
      setBusy(null)
    }
  }

  async function handleRedeem(idStr: string) {
    if (!signer || !address || !auctionConfigured) return
    const id = BigInt(idStr)
    const a = getTreasuryBondAuctionContract(signer)
    if (!a) return
    try {
      setBusy(`redeem-${idStr}`)
      const tx = await a.redeem(id)
      toast.loading('Redeeming…', { id: 'rd' })
      await waitAndParseTransaction(tx, address, provider!)
      toast.success('Note redeemed for AGS', { id: 'rd' })
      refetchAuction()
      refetchNotes()
    } catch (e: unknown) {
      toast.error(extractErrorMessage(e), { id: 'rd' })
    } finally {
      setBusy(null)
    }
  }

  const auctionLive = useMemo(() => {
    if (!auctionMeta || auctionMeta.auctionId === 0n) return false
    const now = BigInt(Math.floor(Date.now() / 1000))
    return (
      !auctionMeta.completed &&
      now >= auctionMeta.auctionStart &&
      now <= auctionMeta.auctionEnd
    )
  }, [auctionMeta])

  const auctionStatusLabel = useMemo(() => {
    if (!auctionMeta || auctionMeta.auctionId === 0n) return 'No active auction'
    if (auctionMeta.completed) return 'Filled'
    if (auctionLive) return 'Open now'
    const now = BigInt(Math.floor(Date.now() / 1000))
    if (now < auctionMeta.auctionStart) return 'Not started'
    return 'Closed'
  }, [auctionMeta, auctionLive])

  const nothingConfigured = !gaugeConfigured && !auctionConfigured

  if (nothingConfigured) {
    return (
      <div className="mx-auto max-w-4xl space-y-6">
        <header className="space-y-2">
          <h1 className="text-2xl font-semibold text-terminal-text md:text-3xl">Treasury &amp; LP</h1>
          <p className="text-sm text-terminal-text-dim max-w-2xl leading-relaxed">
            Earn AGS by staking pool LP tokens, or buy treasury notes when the DAO runs a bond auction.
          </p>
        </header>
        <div className="card text-sm text-terminal-text-dim">
          Treasury rewards and bond auctions are not live on this network yet. You can still{' '}
          <Link to="/liquidity" className="text-terminal-accent underline">
            add liquidity
          </Link>{' '}
          to AGS pools in the meantime.
        </div>
      </div>
    )
  }

  return (
    <TreasuryIncentivesPage
      gaugeConfigured={gaugeConfigured}
      auctionConfigured={auctionConfigured}
      isConnected={isConnected}
      gaugeTokens={gaugeTokens}
      gaugeState={gaugeState}
      auctionMeta={auctionMeta}
      auctionLive={auctionLive}
      auctionStatusLabel={auctionStatusLabel}
      myNotes={myNotes}
      chainNow={chainNow}
      stakeAmt={stakeAmt}
      setStakeAmt={setStakeAmt}
      withdrawAmt={withdrawAmt}
      setWithdrawAmt={setWithdrawAmt}
      rewardRecipient={rewardRecipient}
      setRewardRecipient={setRewardRecipient}
      withdrawRecipient={withdrawRecipient}
      setWithdrawRecipient={setWithdrawRecipient}
      exitStakeTo={exitStakeTo}
      setExitStakeTo={setExitStakeTo}
      exitRewardTo={exitRewardTo}
      setExitRewardTo={setExitRewardTo}
      quoteMax={quoteMax}
      setQuoteMax={setQuoteMax}
      minAgsFace={minAgsFace}
      setMinAgsFace={setMinAgsFace}
      noteHolder={noteHolder}
      setNoteHolder={setNoteHolder}
      redeemNoteId={redeemNoteId}
      setRedeemNoteId={setRedeemNoteId}
      busy={busy}
      onStake={() => void handleStake()}
      onWithdraw={() => void handleWithdraw()}
      onClaimReward={() => void handleClaimReward()}
      onExit={() => void handleExit()}
      onPurchase={() => void handlePurchase()}
      onRedeem={(id) => void handleRedeem(id)}
    />
  )
}

type GaugeTokens = {
  stakeToken: string
  rewardToken: string
  stakeSymbol: string
  rewardSymbol: string
  stakeDecimals: number
  rewardDecimals: number
}

type GaugeState = {
  staked: bigint
  earned: bigint
  paused: boolean
  totalSupply: bigint
  periodFinish: bigint
  rewardRate: bigint
}

type AuctionMeta = {
  ags: string
  quote: string
  auctionId: bigint
  completed: boolean
  capacity: bigint
  sold: bigint
  auctionStart: bigint
  auctionEnd: bigint
  maturity: bigint
  nextNoteId: bigint
  quoteSymbol: string
  quoteDecimals: number
  spotPriceWad: bigint
}

type BondNote = {
  id: bigint
  agsFace: bigint
  maturity: bigint
  redeemed: boolean
}

type TreasuryIncentivesPageProps = {
  gaugeConfigured: boolean
  auctionConfigured: boolean
  isConnected: boolean
  gaugeTokens: GaugeTokens | null | undefined
  gaugeState: GaugeState | null | undefined
  auctionMeta: AuctionMeta | null | undefined
  auctionLive: boolean
  auctionStatusLabel: string
  myNotes: BondNote[] | undefined
  chainNow: bigint | undefined
  stakeAmt: string
  setStakeAmt: (v: string) => void
  withdrawAmt: string
  setWithdrawAmt: (v: string) => void
  rewardRecipient: string
  setRewardRecipient: (v: string) => void
  withdrawRecipient: string
  setWithdrawRecipient: (v: string) => void
  exitStakeTo: string
  setExitStakeTo: (v: string) => void
  exitRewardTo: string
  setExitRewardTo: (v: string) => void
  quoteMax: string
  setQuoteMax: (v: string) => void
  minAgsFace: string
  setMinAgsFace: (v: string) => void
  noteHolder: string
  setNoteHolder: (v: string) => void
  redeemNoteId: string
  setRedeemNoteId: (v: string) => void
  busy: string | null
  onStake: () => void
  onWithdraw: () => void
  onClaimReward: () => void
  onExit: () => void
  onPurchase: () => void
  onRedeem: (id: string) => void
}

function TreasuryIncentivesPage(props: TreasuryIncentivesPageProps) {
  const [tab, setTab] = useState<'lp' | 'bonds'>(() =>
    props.gaugeConfigured ? 'lp' : 'bonds'
  )
  const [showLpAdvanced, setShowLpAdvanced] = useState(false)
  const [showBondAdvanced, setShowBondAdvanced] = useState(false)

  const {
    gaugeConfigured,
    auctionConfigured,
    isConnected,
    gaugeTokens,
    gaugeState,
    auctionMeta,
    auctionLive,
    auctionStatusLabel,
    myNotes,
    chainNow,
    stakeAmt,
    setStakeAmt,
    withdrawAmt,
    setWithdrawAmt,
    rewardRecipient,
    setRewardRecipient,
    withdrawRecipient,
    setWithdrawRecipient,
    exitStakeTo,
    setExitStakeTo,
    exitRewardTo,
    setExitRewardTo,
    quoteMax,
    setQuoteMax,
    minAgsFace,
    setMinAgsFace,
    noteHolder,
    setNoteHolder,
    redeemNoteId,
    setRedeemNoteId,
    busy,
    onStake,
    onWithdraw,
    onClaimReward,
    onExit,
    onPurchase,
    onRedeem,
  } = props

  const rewardsActive =
    gaugeState &&
    !gaugeState.paused &&
    gaugeState.periodFinish > BigInt(Math.floor(Date.now() / 1000))

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold text-terminal-text md:text-3xl">Treasury &amp; LP</h1>
        <p className="text-sm text-terminal-text-dim max-w-2xl leading-relaxed">
          Stake AGS pool LP to earn protocol rewards, or buy treasury notes when the DAO runs a Dutch-style bond
          auction. Need LP first?{' '}
          <Link to="/liquidity" className="text-terminal-accent underline">
            Add liquidity
          </Link>
          .
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-3">
        <StepCard
          step="1"
          title="Provide liquidity"
          body="Deposit AGS and a quote token into a pool on the Liquidity page. You receive LP tokens representing your share."
        />
        <StepCard
          step="2"
          title="Stake for rewards"
          body="Stake those LP tokens here to earn AGS emissions while you stay in the pool."
        />
        <StepCard
          step="3"
          title="Bonds (optional)"
          body="When an auction is open, spend quote tokens for a treasury note redeemable for AGS at maturity."
        />
      </div>

      <div className="flex rounded-lg border border-terminal-border/40 p-1 bg-terminal-bg/40">
        {gaugeConfigured ? (
          <button
            type="button"
            onClick={() => setTab('lp')}
            className={`flex-1 rounded-md py-2.5 text-sm font-medium ${
              tab === 'lp' ? 'bg-terminal-surface text-terminal-text shadow-sm' : 'text-terminal-text-dim'
            }`}
          >
            LP rewards
          </button>
        ) : null}
        {auctionConfigured ? (
          <button
            type="button"
            onClick={() => setTab('bonds')}
            className={`flex-1 rounded-md py-2.5 text-sm font-medium ${
              tab === 'bonds' ? 'bg-terminal-accent/15 text-terminal-accent shadow-sm' : 'text-terminal-text-dim'
            }`}
          >
            Treasury bonds
          </button>
        ) : null}
      </div>

      {tab === 'lp' && gaugeConfigured && (
        <div className="space-y-4">
          {!isConnected ? (
            <div className="card text-center py-10 space-y-2">
              <p className="text-terminal-text font-medium">Connect your wallet</p>
              <p className="text-sm text-terminal-text-dim">Stake LP, claim rewards, or withdraw once connected.</p>
            </div>
          ) : (
            <>
              {gaugeTokens && (
                <p className="text-xs text-terminal-text-dim">
                  Stake <span className="text-terminal-text">{gaugeTokens.stakeSymbol}</span> → earn{' '}
                  <span className="text-terminal-text">{gaugeTokens.rewardSymbol}</span>
                </p>
              )}

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <StatCard
                  label="Your stake"
                  value={
                    gaugeTokens
                      ? `${formatBalance(gaugeState?.staked ?? 0n, gaugeTokens.stakeDecimals)} ${gaugeTokens.stakeSymbol}`
                      : '—'
                  }
                />
                <StatCard
                  label="Claimable"
                  value={
                    gaugeTokens
                      ? `${formatBalance(gaugeState?.earned ?? 0n, gaugeTokens.rewardDecimals)} ${gaugeTokens.rewardSymbol}`
                      : '—'
                  }
                  accent
                />
                <StatCard
                  label="Program"
                  value={gaugeState?.paused ? 'Paused' : rewardsActive ? 'Active' : 'Ended'}
                />
                <StatCard
                  label="Total staked"
                  value={
                    gaugeTokens
                      ? `${formatBalance(gaugeState?.totalSupply ?? 0n, gaugeTokens.stakeDecimals)} ${gaugeTokens.stakeSymbol}`
                      : '—'
                  }
                />
              </div>

              {gaugeState?.paused && (
                <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-terminal-text-dim">
                  New staking is paused. You can still withdraw or claim existing rewards.
                </div>
              )}

              <div className="card border border-terminal-border/60 bg-terminal-surface/80 space-y-4">
                <div>
                  <h2 className="text-lg font-semibold text-terminal-text">Stake LP</h2>
                  <p className="text-xs text-terminal-text-dim mt-1">
                    Lock pool tokens to start earning. Unstake anytime from the section below.
                  </p>
                </div>
                <Field
                  label={`Amount (${gaugeTokens?.stakeSymbol ?? 'LP'})`}
                  value={stakeAmt}
                  onChange={setStakeAmt}
                  placeholder="0.0"
                />
                <button
                  type="button"
                  className="btn-primary w-full py-3"
                  disabled={!stakeAmt || busy === 'stake' || gaugeState?.paused}
                  onClick={onStake}
                >
                  {busy === 'stake' ? 'Confirm in wallet…' : gaugeState?.paused ? 'Staking paused' : 'Stake LP'}
                </button>
              </div>

              <div className="card border border-terminal-border/60 bg-terminal-surface/80 space-y-4">
                <div>
                  <h2 className="text-lg font-semibold text-terminal-text">Claim rewards</h2>
                  <p className="text-xs text-terminal-text-dim mt-1">
                    Collect earned {gaugeTokens?.rewardSymbol ?? 'AGS'} without unstaking your LP.
                  </p>
                </div>
                <button
                  type="button"
                  className="btn-primary w-full py-3"
                  disabled={busy === 'rw' || !gaugeState?.earned}
                  onClick={onClaimReward}
                >
                  {busy === 'rw'
                    ? 'Confirm in wallet…'
                    : gaugeState?.earned
                      ? `Claim ${gaugeTokens ? formatBalance(gaugeState.earned, gaugeTokens.rewardDecimals) : ''} ${gaugeTokens?.rewardSymbol ?? 'AGS'}`
                      : 'Nothing to claim yet'}
                </button>
              </div>

              <div className="card border border-terminal-border/50 bg-terminal-bg/40 space-y-3">
                <button
                  type="button"
                  className="text-sm font-medium text-terminal-accent w-full text-left"
                  onClick={() => setShowLpAdvanced((v) => !v)}
                >
                  {showLpAdvanced ? 'Hide' : 'Show'} withdraw &amp; routing options
                </button>
                {showLpAdvanced ? (
                  <div className="space-y-4 pt-1 border-t border-terminal-border/30">
                    <p className="text-xs text-terminal-text-dim">
                      Send LP or rewards to a different wallet (e.g. cold storage). This does not hide activity on-chain.
                    </p>
                    <Field
                      label="Reward recipient (optional)"
                      value={rewardRecipient}
                      onChange={setRewardRecipient}
                      placeholder="Leave blank for your wallet"
                      mono
                    />
                    <Field
                      label="Withdraw LP amount"
                      value={withdrawAmt}
                      onChange={setWithdrawAmt}
                      placeholder="0.0"
                    />
                    <Field
                      label="LP recipient (optional)"
                      value={withdrawRecipient}
                      onChange={setWithdrawRecipient}
                      placeholder="Leave blank for your wallet"
                      mono
                    />
                    <button
                      type="button"
                      className="btn-secondary w-full"
                      disabled={!withdrawAmt || busy === 'wd'}
                      onClick={onWithdraw}
                    >
                      {busy === 'wd' ? 'Confirm in wallet…' : 'Withdraw LP'}
                    </button>
                    <div className="border-t border-terminal-border/30 pt-4 space-y-3">
                      <p className="text-xs font-medium text-terminal-text">Exit everything</p>
                      <Field
                        label="LP goes to"
                        value={exitStakeTo}
                        onChange={setExitStakeTo}
                        placeholder="Optional — your wallet if blank"
                        mono
                      />
                      <Field
                        label="Rewards go to"
                        value={exitRewardTo}
                        onChange={setExitRewardTo}
                        placeholder="Optional — your wallet if blank"
                        mono
                      />
                      <button
                        type="button"
                        className="btn-secondary w-full border-terminal-warning/40"
                        disabled={busy === 'ex'}
                        onClick={onExit}
                      >
                        {busy === 'ex' ? 'Confirm in wallet…' : 'Unstake all & claim rewards'}
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            </>
          )}
        </div>
      )}

      {tab === 'bonds' && auctionConfigured && (
        <div className="space-y-4">
          {!auctionMeta ? (
            <p className="text-sm text-terminal-text-dim card">Loading auction…</p>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <StatCard label="Status" value={auctionStatusLabel} accent={auctionLive} />
                <StatCard
                  label="Price"
                  value={
                    auctionMeta.spotPriceWad > 0n
                      ? `${formatBalance(auctionMeta.spotPriceWad, 18)} ${auctionMeta.quoteSymbol} / AGS`
                      : '—'
                  }
                />
                <StatCard
                  label="Sold"
                  value={`${formatBalance(auctionMeta.sold, 18)} / ${formatBalance(auctionMeta.capacity, 18)} AGS`}
                />
                <StatCard label="Maturity" value={formatUnixTime(auctionMeta.maturity)} />
              </div>

              {auctionMeta.auctionId > 0n && (
                <p className="text-xs text-terminal-text-dim">
                  Auction window: {formatUnixTime(auctionMeta.auctionStart)} → {formatUnixTime(auctionMeta.auctionEnd)}
                </p>
              )}

              {!isConnected ? (
                <div className="card text-center py-10 space-y-2">
                  <p className="text-terminal-text font-medium">Connect your wallet</p>
                  <p className="text-sm text-terminal-text-dim">Purchase treasury notes or redeem after maturity.</p>
                </div>
              ) : (
                <>
                  {!auctionLive && auctionMeta.auctionId > 0n && (
                    <div className="rounded-lg border border-terminal-border/40 bg-terminal-bg/50 px-4 py-3 text-sm text-terminal-text-dim">
                      {auctionMeta.completed
                        ? 'This auction is fully subscribed. Watch governance for the next round.'
                        : auctionStatusLabel === 'Not started'
                          ? 'The auction has not opened yet — check back after the start time above.'
                          : 'The purchase window is closed. You can still redeem notes you already hold.'}
                    </div>
                  )}

                  <div className="card border border-terminal-border/60 bg-terminal-surface/80 space-y-4">
                    <div>
                      <h2 className="text-lg font-semibold text-terminal-text">Buy a treasury note</h2>
                      <p className="text-xs text-terminal-text-dim mt-1">
                        Spend {auctionMeta.quoteSymbol} during the open window. You receive a note redeemable for AGS at
                        maturity.
                      </p>
                    </div>
                    <Field
                      label={`Max to spend (${auctionMeta.quoteSymbol})`}
                      value={quoteMax}
                      onChange={setQuoteMax}
                      placeholder="0.0"
                    />
                    <Field
                      label="Minimum AGS you'll accept (slippage)"
                      value={minAgsFace}
                      onChange={setMinAgsFace}
                      placeholder="0"
                    />
                    <button
                      type="button"
                      className="text-xs text-terminal-accent"
                      onClick={() => setShowBondAdvanced((v) => !v)}
                    >
                      {showBondAdvanced ? 'Hide' : 'Show'} holder wallet option
                    </button>
                    {showBondAdvanced ? (
                      <Field
                        label="Hold note in another wallet (optional)"
                        value={noteHolder}
                        onChange={setNoteHolder}
                        placeholder="Cold wallet address"
                        mono
                      />
                    ) : null}
                    <button
                      type="button"
                      className="btn-primary w-full py-3"
                      disabled={busy === 'buy' || !quoteMax}
                      onClick={onPurchase}
                    >
                      {busy === 'buy' ? 'Confirm in wallet…' : 'Purchase note'}
                    </button>
                  </div>

                  <div className="card border border-terminal-border/50 bg-terminal-bg/40 space-y-3">
                    <h2 className="text-base font-semibold text-terminal-text">Your notes</h2>
                    {myNotes && myNotes.length === 0 && (
                      <p className="text-sm text-terminal-text-dim">
                        No treasury notes found for this wallet in recent history.
                      </p>
                    )}
                    <ul className="space-y-2">
                      {myNotes?.map((n) => {
                        const locked = chainNow != null && chainNow < n.maturity
                        return (
                          <li
                            key={n.id.toString()}
                            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-terminal-border/40 px-3 py-2.5 bg-terminal-surface/60 text-sm"
                          >
                            <div>
                              <span className="font-medium text-terminal-text">
                                {formatBalance(n.agsFace, 18)} AGS
                              </span>
                              <span className="text-terminal-text-dim ml-2">· Note #{n.id.toString()}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-terminal-text-dim">
                                {n.redeemed
                                  ? 'Redeemed'
                                  : locked
                                    ? `Unlocks ${formatUnixTime(n.maturity)}`
                                    : 'Ready to redeem'}
                              </span>
                              {!n.redeemed && (
                                <button
                                  type="button"
                                  className="btn-secondary text-xs px-3 py-1.5"
                                  disabled={busy === `redeem-${n.id}` || locked}
                                  onClick={() => onRedeem(n.id.toString())}
                                >
                                  {locked ? 'Locked' : busy === `redeem-${n.id}` ? '…' : 'Redeem'}
                                </button>
                              )}
                            </div>
                          </li>
                        )
                      })}
                    </ul>

                    <details className="pt-2 border-t border-terminal-border/30">
                      <summary className="cursor-pointer text-xs text-terminal-text-dim">Redeem by note number</summary>
                      <div className="mt-3 flex gap-2">
                        <input
                          className="input-field flex-1 font-mono text-sm min-w-0"
                          value={redeemNoteId}
                          onChange={(e) => setRedeemNoteId(e.target.value)}
                          placeholder="Note #"
                        />
                        <button
                          type="button"
                          className="btn-secondary shrink-0 px-4"
                          disabled={!redeemNoteId || busy?.startsWith('redeem-')}
                          onClick={() => onRedeem(redeemNoteId)}
                        >
                          Redeem
                        </button>
                      </div>
                    </details>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

function StepCard({ step, title, body }: { step: string; title: string; body: string }) {
  return (
    <div className="rounded-xl border border-terminal-border/50 bg-terminal-surface/60 p-4 space-y-2">
      <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-terminal-accent/15 text-xs font-bold text-terminal-accent">
        {step}
      </span>
      <h3 className="text-sm font-semibold text-terminal-text">{title}</h3>
      <p className="text-xs text-terminal-text-dim leading-relaxed">{body}</p>
    </div>
  )
}

function StatCard({
  label,
  value,
  hint,
  accent,
}: {
  label: string
  value: string
  hint?: string
  accent?: boolean
}) {
  return (
    <div className="rounded-lg border border-terminal-border/40 bg-terminal-bg/50 px-4 py-3">
      <div className="text-[11px] text-terminal-text-dim uppercase tracking-wide">{label}</div>
      <div
        className={`text-base font-semibold mt-1 tabular-nums ${
          accent ? 'text-terminal-accent' : 'text-terminal-text'
        }`}
      >
        {value}
      </div>
      {hint ? <div className="text-[10px] text-terminal-text-dim mt-1">{hint}</div> : null}
    </div>
  )
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  mono,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  mono?: boolean
}) {
  return (
    <label className="block space-y-1.5 text-sm min-w-0">
      <span className="text-xs text-terminal-text-dim">{label}</span>
      <input
        className={`input-field w-full min-w-0 ${mono ? 'font-mono text-xs' : ''}`}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  )
}

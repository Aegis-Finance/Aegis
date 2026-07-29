import { useMemo, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { parseEther, formatUnits } from 'ethers'
import { useWalletStore } from '@/store/walletStore'
import { CONTRACT_ADDRESSES, ZERO_ADDRESS } from '@/config/contracts'
import {
  getPrivacySavingsVaultContract,
  getAnonymousPayrollContract,
  getPrivatePredictionMarketContract,
  getRelayerMarketplaceContract,
  getSelectiveDisclosureHubContract,
  getShieldedYieldVaultContract,
  getShieldedIncentiveClaimsContract,
  getPrivateStableVaultContract,
  getPrivateCreditProfileContract,
  getPrivateBondMarketContract,
  getTokenContract,
} from '@/utils/contracts'
import {
  proveSelectiveDisclosure,
  provePrivateStable,
  proveCreditProfile,
  provePrivateBond,
  provePredictionMarket,
  proveYieldFarming,
} from '@/utils/prover'
import { validateAmount, isValidHex, checkRateLimit } from '@/utils/security'
import { waitAndParseTransaction } from '@/utils/transactionHelper'
import ZkModeToggle, { type ZkPrivacyMode } from '@/components/ZkModeToggle'
import { Link } from 'react-router-dom'
import StealthReceivePanel from '@/components/StealthReceivePanel'
import ZkProverNotice from '@/components/ZkProverNotice'
import { isContractConfigured } from '@/utils/productReadiness'
import { isCircuitProvingReady } from '@/config/circuitReadiness'
import type { ContractKey } from '@/config/contracts'

type Tab =
  | 'stealth'
  | 'savings'
  | 'yield'
  | 'incentives'
  | 'payroll'
  | 'prediction'
  | 'stable'
  | 'credit'
  | 'bonds'
  | 'disclosure'
  | 'relayer'

type TabMeta = {
  id: Tab
  label: string
  contractKey?: ContractKey
  circuitSlug?: string
  zkOptional?: boolean
}

const ALL_TABS: TabMeta[] = [
  { id: 'stealth', label: 'Stealth receive', contractKey: 'STEALTH_ADDRESS_HUB', circuitSlug: 'stealth-address' },
  { id: 'disclosure', label: 'Disclosure', contractKey: 'SELECTIVE_DISCLOSURE_HUB', circuitSlug: 'selective-disclosure' },
  { id: 'relayer', label: 'Relayer market', contractKey: 'RELAYER_MARKETPLACE', zkOptional: true },
  { id: 'payroll', label: 'Payroll', contractKey: 'ANONYMOUS_PAYROLL', circuitSlug: 'payroll' },
  { id: 'savings', label: 'Savings', contractKey: 'PRIVACY_SAVINGS_VAULT', circuitSlug: 'savings' },
  { id: 'yield', label: 'Yield vault', contractKey: 'SHIELDED_YIELD_VAULT', circuitSlug: 'farming' },
  { id: 'incentives', label: 'Incentives', contractKey: 'SHIELDED_INCENTIVE_CLAIMS', circuitSlug: 'farming' },
  { id: 'prediction', label: 'Prediction', contractKey: 'PRIVATE_PREDICTION_MARKET', circuitSlug: 'prediction-market' },
  { id: 'stable', label: 'Stable vault', contractKey: 'PRIVATE_STABLE_VAULT', circuitSlug: 'private-stable' },
  { id: 'credit', label: 'Credit', contractKey: 'PRIVATE_CREDIT_PROFILE', circuitSlug: 'credit-profile' },
  { id: 'bonds', label: 'Bonds', contractKey: 'PRIVATE_BOND_MARKET', circuitSlug: 'private-bond' },
]

function tabReady(meta: TabMeta): boolean {
  if (meta.contractKey && !isContractConfigured(CONTRACT_ADDRESSES[meta.contractKey])) return false
  return true
}

function tabZkReady(meta: TabMeta): boolean {
  if (meta.zkOptional || !meta.circuitSlug) return true
  return isCircuitProvingReady(meta.circuitSlug)
}

function tabStatusLabel(meta: TabMeta): string {
  if (!tabZkReady(meta)) return 'ZK setup'
  if (meta.circuitSlug) return 'ZK action'
  return 'Live'
}

function parseBytes32(raw: string): `0x${string}` | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const body = trimmed.startsWith('0x') ? trimmed.slice(2) : trimmed
  if (!isValidHex(body, 32)) return null
  return (`0x${body.padStart(64, '0')}`) as `0x${string}`
}

function randomHex(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return '0x' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

function ShieldedModuleCard({
  title,
  children,
  className = 'space-y-4',
}: {
  title: string
  children: ReactNode
  className?: string
}) {
  return (
    <div className={`card ${className}`}>
      <h2 className="text-xl font-semibold text-terminal-accent">{title}</h2>
      {children}
    </div>
  )
}

export default function ShieldedEcosystem() {
  const visibleTabs = useMemo(() => ALL_TABS.filter(tabReady), [])
  const [tab, setTab] = useState<Tab>(() => visibleTabs[0]?.id ?? 'stealth')
  const [mode, setMode] = useState<ZkPrivacyMode>('zk')
  const activeMeta = visibleTabs.find((t) => t.id === tab)

  if (visibleTabs.length === 0) {
    return (
      <div className="space-y-4">
        <h1 className="text-3xl font-bold text-terminal-accent">Shielded ecosystem</h1>
        <p className="text-sm text-terminal-text-dim">
          No shielded modules are wired in this build. Run{' '}
          <code className="text-terminal-accent">npm run gen:frontend-env</code> from the repo root.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <h1 className="text-3xl font-bold text-terminal-accent">Shielded ecosystem</h1>
        <p className="text-sm text-terminal-text-dim max-w-3xl">
          Extra privacy tools on Sonic. Shield AGS in{' '}
          <Link to="/wallet" className="text-terminal-accent underline">Wallet</Link> first, then use a tab below.
          Tabs marked <strong className="text-amber-400">ZK setup</strong> need proving enabled before private actions work.
        </p>
      </div>

      <ZkProverNotice moduleLabel={activeMeta?.label ?? 'This tab'} circuitSlug={activeMeta?.circuitSlug} />
      <ZkModeToggle mode={mode} onChange={setMode} zkOnly />

      <div className="flex flex-wrap gap-2 border-b border-terminal-border pb-2">
        {visibleTabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`px-3 py-1.5 text-sm rounded-t transition-colors ${
              tab === t.id
                ? 'text-terminal-accent border-b-2 border-terminal-accent font-medium'
                : 'text-terminal-text-dim hover:text-terminal-text'
            }`}
          >
            {t.label}
            <span
              className={`ml-1.5 text-[10px] uppercase tracking-wide ${
                tabZkReady(t) ? 'opacity-70' : 'text-amber-400'
              }`}
            >
              {tabStatusLabel(t)}
            </span>
          </button>
        ))}
      </div>

      {tab === 'stealth' && <StealthReceivePanel />}
      {tab === 'savings' && <SavingsPanel mode={mode} />}
      {tab === 'yield' && <YieldVaultPanel mode={mode} />}
      {tab === 'incentives' && <IncentiveClaimsPanel mode={mode} />}
      {tab === 'payroll' && <PayrollPanel mode={mode} />}
      {tab === 'prediction' && <PredictionPanel />}
      {tab === 'stable' && <StablePanel mode={mode} />}
      {tab === 'credit' && <CreditPanel mode={mode} />}
      {tab === 'bonds' && <BondsPanel mode={mode} />}
      {tab === 'disclosure' && <DisclosurePanel mode={mode} />}
      {tab === 'relayer' && <RelayerPanel />}
    </div>
  )
}

function SavingsPanel({ mode }: { mode: 'legacy' | 'zk' }) {
  const { signer, address, provider } = useWalletStore()
  const [commitment, setCommitment] = useState('')
  const [lockDays, setLockDays] = useState('30')
  const [busy, setBusy] = useState(false)
  const vault = CONTRACT_ADDRESSES.PRIVACY_SAVINGS_VAULT
  const configured = Boolean(vault && vault !== ZERO_ADDRESS)

  const handleOpen = async () => {
    try {
      checkRateLimit('critical')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Rate limit')
      return
    }
    if (!signer || !address) return toast.error('Connect wallet')
    const c = parseBytes32(commitment)
    if (!c) return toast.error('Commitment must be 32-byte hex')
    const days = parseInt(lockDays, 10)
    if (!Number.isFinite(days) || days <= 0) return toast.error('Invalid lock duration')
    const contract = getPrivacySavingsVaultContract(signer)
    if (!contract) return toast.error('PrivacySavingsVault not configured')
    setBusy(true)
    try {
      const lockDuration = BigInt(days) * 86400n
      toast.loading('Opening savings…', { id: 'savings' })
      const tx = await contract.openSavings(c, lockDuration)
      await waitAndParseTransaction(tx, address, provider)
      toast.success('Savings deposit opened', { id: 'savings' })
      setCommitment('')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed', { id: 'savings' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <ShieldedModuleCard title="Savings">
      <p className="text-sm text-terminal-text-dim">
        Lock shielded AGS until a date you choose. Paste the commitment hash from Wallet; after maturity you withdraw
        with a private proof so the lock amount stays off your public history.
      </p>
      <div>
        <label className="block text-sm text-terminal-text-dim mb-1">Commitment hash</label>
        <input
          className="input-field w-full font-mono text-xs"
          value={commitment}
          onChange={(e) => setCommitment(e.target.value)}
          placeholder="0x…"
          disabled={busy}
        />
      </div>
      <div>
        <label className="block text-sm text-terminal-text-dim mb-1">Lock (days)</label>
        <input
          type="number"
          min={1}
          className="input-field w-full"
          value={lockDays}
          onChange={(e) => setLockDays(e.target.value)}
          disabled={busy}
        />
      </div>
      <button
        type="button"
        className="btn-primary"
        disabled={!configured || busy || mode === 'legacy'}
        onClick={() => void handleOpen()}
      >
        {busy ? 'Submitting…' : mode === 'zk' ? 'Open shielded savings' : 'ZK-only module'}
      </button>
    </ShieldedModuleCard>
  )
}

function YieldVaultPanel({ mode }: { mode: 'legacy' | 'zk' }) {
  const { signer, address, provider } = useWalletStore()
  const [commitment, setCommitment] = useState('')
  const [lockDays, setLockDays] = useState('30')
  const [busy, setBusy] = useState(false)
  const configured =
    CONTRACT_ADDRESSES.SHIELDED_YIELD_VAULT && CONTRACT_ADDRESSES.SHIELDED_YIELD_VAULT !== ZERO_ADDRESS

  const handleOpen = async () => {
    try {
      checkRateLimit('critical')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Rate limit')
      return
    }
    if (!signer || !address) return toast.error('Connect wallet')
    const c = parseBytes32(commitment)
    if (!c) return toast.error('Commitment must be 32-byte hex')
    const days = parseInt(lockDays, 10)
    if (!Number.isFinite(days) || days <= 0) return toast.error('Invalid lock duration')
    const vault = getShieldedYieldVaultContract(signer)
    if (!vault) return toast.error('ShieldedYieldVault not configured')
    setBusy(true)
    try {
      const lockDuration = BigInt(days) * 86400n
      toast.loading('Opening locked yield…', { id: 'yield' })
      const tx = await vault.openLockedYield(c, lockDuration)
      await waitAndParseTransaction(tx, address, provider)
      toast.success('Locked yield opened (savings + farming rail)', { id: 'yield' })
      setCommitment('')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed', { id: 'yield' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <ShieldedModuleCard title="Yield vault">
      <p className="text-sm text-terminal-text-dim">
        Same idea as Savings, plus yield while locked. You still need a commitment from Wallet and a lock period;
        rewards accrue without moving funds to a public address.
      </p>
      <div>
        <label className="block text-sm text-terminal-text-dim mb-1">Commitment hash</label>
        <input
          className="input-field w-full font-mono text-xs"
          value={commitment}
          onChange={(e) => setCommitment(e.target.value)}
          placeholder="0x…"
          disabled={busy}
        />
      </div>
      <div>
        <label className="block text-sm text-terminal-text-dim mb-1">Lock (days)</label>
        <input
          type="number"
          min={1}
          className="input-field w-full"
          value={lockDays}
          onChange={(e) => setLockDays(e.target.value)}
          disabled={busy}
        />
      </div>
      <button
        type="button"
        className="btn-primary"
        disabled={!configured || busy || mode === 'legacy'}
        onClick={() => void handleOpen()}
      >
        {busy ? 'Submitting…' : mode === 'zk' ? 'Open locked yield' : 'ZK-only module'}
      </button>
    </ShieldedModuleCard>
  )
}

function IncentiveClaimsPanel({ mode }: { mode: 'legacy' | 'zk' }) {
  const { signer, address, provider } = useWalletStore()
  const [busy, setBusy] = useState<'gauge' | 'bond' | null>(null)
  const configured =
    CONTRACT_ADDRESSES.SHIELDED_INCENTIVE_CLAIMS &&
    CONTRACT_ADDRESSES.SHIELDED_INCENTIVE_CLAIMS !== ZERO_ADDRESS

  const { data: gaugeAddr } = useQuery({
    queryKey: ['shielded-incentive-gauge'],
    queryFn: async () => {
      const c = getShieldedIncentiveClaimsContract(provider!)
      if (!c) return null
      const addr = (await c.liquidityMiningGauge()) as string
      return addr === ZERO_ADDRESS ? null : addr
    },
    enabled: Boolean(provider && configured),
  })

  const handleGaugeClaim = async () => {
    if (mode !== 'zk') return toast.error('Use Private (ZK) mode')
    if (!signer || !address) return toast.error('Connect wallet')
    const claims = getShieldedIncentiveClaimsContract(signer)
    if (!claims) return toast.error('ShieldedIncentiveClaims not configured')
    setBusy('gauge')
    try {
      toast.loading('Generating farming proof…', { id: 'incentive-gauge' })
      const { proof, publicInputs } = await proveYieldFarming({
        poolId: '0',
        nullifierHash: parseBytes32(randomHex())!,
        stakeCommitment: parseBytes32(randomHex())!,
        amount: '0',
      })
      toast.loading('Verifying gauge claim…', { id: 'incentive-gauge' })
      const tx = await claims.verifyGaugeClaim(proof, publicInputs)
      await waitAndParseTransaction(tx, address, provider)
      toast.success('Gauge claim verified', { id: 'incentive-gauge' })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed', { id: 'incentive-gauge' })
    } finally {
      setBusy(null)
    }
  }

  const handleBondRedemption = async () => {
    if (mode !== 'zk') return toast.error('Use Private (ZK) mode')
    if (!signer || !address) return toast.error('Connect wallet')
    const claims = getShieldedIncentiveClaimsContract(signer)
    if (!claims) return toast.error('ShieldedIncentiveClaims not configured')
    setBusy('bond')
    try {
      toast.loading('Generating bond proof…', { id: 'incentive-bond' })
      const { proof, publicInputs } = await provePrivateBond({
        nullifierHash: randomHex(),
        noteCommitment: randomHex(),
        faceValue: '0',
        merkleRoot: randomHex(),
      })
      toast.loading('Verifying bond redemption…', { id: 'incentive-bond' })
      const tx = await claims.verifyBondRedemption(proof, publicInputs)
      await waitAndParseTransaction(tx, address, provider)
      toast.success('Bond redemption verified', { id: 'incentive-bond' })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed', { id: 'incentive-bond' })
    } finally {
      setBusy(null)
    }
  }

  return (
    <ShieldedModuleCard title="Incentive claims">
      <p className="text-sm text-terminal-text-dim">
        Move liquidity-mining or bond payouts into your shielded balance so reward size and timing are not tied to your
        public wallet on Sonic.
      </p>
      {gaugeAddr ? (
        <p className="text-xs text-terminal-text-dim">Liquidity rewards rail is connected for this deployment.</p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-primary" disabled={!configured || busy !== null} onClick={() => void handleGaugeClaim()}>
          {busy === 'gauge' ? 'Submitting…' : 'Verify gauge claim (ZK)'}
        </button>
        <button type="button" className="btn-secondary" disabled={!configured || busy !== null} onClick={() => void handleBondRedemption()}>
          {busy === 'bond' ? 'Submitting…' : 'Verify bond redemption (ZK)'}
        </button>
      </div>
    </ShieldedModuleCard>
  )
}

function PayrollPanel({ mode }: { mode: 'legacy' | 'zk' }) {
  const { signer, address, provider } = useWalletStore()
  const [amount, setAmount] = useState('')
  const [busy, setBusy] = useState(false)
  const configured =
    CONTRACT_ADDRESSES.ANONYMOUS_PAYROLL && CONTRACT_ADDRESSES.ANONYMOUS_PAYROLL !== ZERO_ADDRESS

  const { data: balance } = useQuery({
    queryKey: ['payroll-balance', address],
    queryFn: async () => {
      if (!provider || !address) return 0n
      const c = getAnonymousPayrollContract(provider)
      if (!c) return 0n
      return (await c.employerBalances(address)) as bigint
    },
    enabled: Boolean(provider && address && configured),
  })

  const handleFund = async () => {
    try {
      checkRateLimit('critical')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Rate limit')
      return
    }
    if (!signer || !address) return toast.error('Connect wallet')
    const v = validateAmount(amount)
    if (!v.valid) return toast.error(v.error || 'Invalid amount')
    const payroll = getAnonymousPayrollContract(signer)
    const token = getTokenContract(signer)
    if (!payroll) return toast.error('AnonymousPayroll not configured')
    setBusy(true)
    try {
      const wei = parseEther(amount)
      toast.loading('Approving AGS…', { id: 'payroll' })
      const approveTx = await token.approve(await payroll.getAddress(), wei)
      await approveTx.wait()
      toast.loading('Funding payroll…', { id: 'payroll' })
      const tx = await payroll.fundPayroll(wei)
      await waitAndParseTransaction(tx, address, provider)
      toast.success('Payroll funded', { id: 'payroll' })
      setAmount('')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed', { id: 'payroll' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <ShieldedModuleCard title="Payroll">
      <p className="text-sm text-terminal-text-dim">
        Deposit AGS as an employer; workers claim pay with a private proof so payroll links stay off-chain visible.
        Fund the vault here — employees use the claim flow when your org shares their period details.
      </p>
      {balance != null ? (
        <p className="text-sm">
          Your payroll balance: <strong>{formatUnits(balance, 18)} AGS</strong>
        </p>
      ) : null}
      <div>
        <label className="block text-sm text-terminal-text-dim mb-1">Fund amount (AGS)</label>
        <input
          type="number"
          step="0.001"
          min={0}
          className="input-field w-full"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          disabled={busy}
        />
      </div>
      <button
        type="button"
        className="btn-primary"
        disabled={!configured || busy || mode === 'legacy'}
        onClick={() => void handleFund()}
      >
        {busy ? 'Funding…' : mode === 'zk' ? 'Fund payroll vault' : 'ZK payroll path'}
      </button>
    </ShieldedModuleCard>
  )
}

function PredictionPanel() {
  const { signer, address, provider } = useWalletStore()
  const [marketId, setMarketId] = useState('0')
  const [outcome, setOutcome] = useState('1')
  const [amount, setAmount] = useState('10')
  const [busy, setBusy] = useState(false)
  const configured =
    CONTRACT_ADDRESSES.PRIVATE_PREDICTION_MARKET &&
    CONTRACT_ADDRESSES.PRIVATE_PREDICTION_MARKET !== ZERO_ADDRESS

  const { data: marketCount } = useQuery({
    queryKey: ['prediction-market-count'],
    queryFn: async () => {
      const c = getPrivatePredictionMarketContract(provider!)
      if (!c) return 0
      return Number(await c.nextMarketId())
    },
    enabled: Boolean(provider && configured),
  })

  const handleOpen = async () => {
    if (!signer || !address) return toast.error('Connect wallet')
    const market = getPrivatePredictionMarketContract(signer)
    if (!market) return toast.error('Prediction market not configured')
    setBusy(true)
    try {
      toast.loading('Generating prediction proof…', { id: 'prediction' })
      const { proof, publicInputs } = await provePredictionMarket({
        marketId,
        outcome,
        nullifierHash: randomHex(),
        commitmentHash: randomHex(),
      })
      toast.loading('Opening position…', { id: 'prediction' })
      const tx = await market.openPosition(proof, publicInputs)
      await waitAndParseTransaction(tx, address, provider)
      toast.success('Position opened', { id: 'prediction' })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed', { id: 'prediction' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <ShieldedModuleCard title="Prediction">
      <p className="text-sm text-terminal-text-dim">
        Stake on a prediction market without broadcasting which wallet took which side. Pick an existing market id
        and outcome; your position size stays in the shielded ledger.
      </p>
      {marketCount != null ? (
        <p className="text-sm">
          Markets created: <strong>{marketCount}</strong>
        </p>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block text-sm">
          <span className="text-terminal-text-dim">Market id</span>
          <input className="input-field w-full mt-1" value={marketId} onChange={(e) => setMarketId(e.target.value)} disabled={busy} />
        </label>
        <label className="block text-sm">
          <span className="text-terminal-text-dim">Outcome (0/1)</span>
          <input className="input-field w-full mt-1" value={outcome} onChange={(e) => setOutcome(e.target.value)} disabled={busy} />
        </label>
        <label className="block text-sm">
          <span className="text-terminal-text-dim">Stake hint (AGS)</span>
          <input className="input-field w-full mt-1" value={amount} onChange={(e) => setAmount(e.target.value)} disabled={busy} />
        </label>
      </div>
      <button type="button" className="btn-primary" disabled={!configured || busy} onClick={() => void handleOpen()}>
        {busy ? 'Submitting…' : 'Open shielded position'}
      </button>
    </ShieldedModuleCard>
  )
}

function StablePanel({ mode }: { mode: 'legacy' | 'zk' }) {
  const { signer, address, provider } = useWalletStore()
  const [amount, setAmount] = useState('100')
  const [collateralCommitment, setCollateralCommitment] = useState('')
  const [stableCommitment, setStableCommitment] = useState('')
  const [busy, setBusy] = useState(false)
  const configured = Boolean(CONTRACT_ADDRESSES.PRIVATE_STABLE_VAULT && CONTRACT_ADDRESSES.PRIVATE_STABLE_VAULT !== ZERO_ADDRESS)

  const handleMint = async () => {
    if (mode !== 'zk') return toast.error('Use Private (ZK) mode')
    if (!signer || !address) return toast.error('Connect wallet')
    const vault = getPrivateStableVaultContract(signer)
    if (!vault) return toast.error('PrivateStableVault not configured')
    const collateral = parseBytes32(collateralCommitment) ?? randomHex() as `0x${string}`
    const stable = parseBytes32(stableCommitment) ?? randomHex() as `0x${string}`
    const v = validateAmount(amount)
    if (!v.valid) return toast.error(v.error || 'Invalid amount')
    setBusy(true)
    try {
      toast.loading('Generating stable mint proof…', { id: 'stable' })
      const { proof, publicInputs } = await provePrivateStable({
        nullifierHash: randomHex(),
        collateralCommitment: collateral,
        stableCommitment: stable,
        amount: parseEther(amount).toString(),
      })
      toast.loading('Minting shielded stable…', { id: 'stable' })
      const tx = await vault.mintStable(proof, publicInputs)
      await waitAndParseTransaction(tx, address, provider)
      toast.success('Stable mint submitted', { id: 'stable' })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed', { id: 'stable' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <ShieldedModuleCard title="Stable vault">
      <p className="text-sm text-terminal-text-dim">
        Mint private stable units against collateral you already hold in shielded form. Optional commitment fields
        default to fresh secrets if you leave them blank.
      </p>
      <div>
        <label className="block text-sm text-terminal-text-dim mb-1">Amount (AGS collateral)</label>
        <input type="number" min={0} step="0.001" className="input-field w-full" value={amount} onChange={(e) => setAmount(e.target.value)} disabled={busy} />
      </div>
      <div>
        <label className="block text-sm text-terminal-text-dim mb-1">Collateral commitment (optional)</label>
        <input className="input-field w-full font-mono text-xs" value={collateralCommitment} onChange={(e) => setCollateralCommitment(e.target.value)} disabled={busy} />
      </div>
      <div>
        <label className="block text-sm text-terminal-text-dim mb-1">Stable commitment (optional)</label>
        <input className="input-field w-full font-mono text-xs" value={stableCommitment} onChange={(e) => setStableCommitment(e.target.value)} disabled={busy} />
      </div>
      <button type="button" className="btn-primary" disabled={!configured || busy} onClick={() => void handleMint()}>
        {busy ? 'Submitting…' : 'Mint stable (ZK)'}
      </button>
    </ShieldedModuleCard>
  )
}

function CreditPanel({ mode }: { mode: 'legacy' | 'zk' }) {
  const { signer, address, provider } = useWalletStore()
  const [profileCommitment, setProfileCommitment] = useState('')
  const [newScore, setNewScore] = useState('650')
  const [busy, setBusy] = useState(false)
  const configured = Boolean(CONTRACT_ADDRESSES.PRIVATE_CREDIT_PROFILE && CONTRACT_ADDRESSES.PRIVATE_CREDIT_PROFILE !== ZERO_ADDRESS)

  const handleUpdate = async () => {
    if (mode !== 'zk') return toast.error('Use Private (ZK) mode')
    if (!signer || !address) return toast.error('Connect wallet')
    const profile = getPrivateCreditProfileContract(signer)
    if (!profile) return toast.error('PrivateCreditProfile not configured')
    const commitment = parseBytes32(profileCommitment) ?? randomHex() as `0x${string}`
    setBusy(true)
    try {
      toast.loading('Generating credit proof…', { id: 'credit' })
      const { proof, publicInputs } = await proveCreditProfile({
        nullifierHash: randomHex(),
        profileCommitment: commitment,
        newScore,
        merkleRoot: randomHex(),
      })
      toast.loading('Updating credit score…', { id: 'credit' })
      const tx = await profile.updateCreditScore(proof, publicInputs)
      await waitAndParseTransaction(tx, address, provider)
      toast.success('Credit profile updated', { id: 'credit' })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed', { id: 'credit' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <ShieldedModuleCard title="Credit profile">
      <p className="text-sm text-terminal-text-dim">
        Publish or refresh a credit score lenders can check in private lending — they see the band you prove, not
        your full wallet graph.
      </p>
      <div>
        <label className="block text-sm text-terminal-text-dim mb-1">Profile commitment (optional)</label>
        <input className="input-field w-full font-mono text-xs" value={profileCommitment} onChange={(e) => setProfileCommitment(e.target.value)} disabled={busy} />
      </div>
      <div>
        <label className="block text-sm text-terminal-text-dim mb-1">New score</label>
        <input className="input-field w-full" value={newScore} onChange={(e) => setNewScore(e.target.value)} disabled={busy} />
      </div>
      <button type="button" className="btn-primary" disabled={!configured || busy} onClick={() => void handleUpdate()}>
        {busy ? 'Submitting…' : 'Update credit score (ZK)'}
      </button>
    </ShieldedModuleCard>
  )
}

function BondsPanel({ mode }: { mode: 'legacy' | 'zk' }) {
  const { signer, address, provider } = useWalletStore()
  const [quoteAmount, setQuoteAmount] = useState('100')
  const [noteId, setNoteId] = useState('0')
  const [busy, setBusy] = useState<'buy' | 'redeem' | null>(null)
  const configured = Boolean(CONTRACT_ADDRESSES.PRIVATE_BOND_MARKET && CONTRACT_ADDRESSES.PRIVATE_BOND_MARKET !== ZERO_ADDRESS)

  const handlePurchase = async () => {
    if (mode !== 'zk') return toast.error('Use Private (ZK) mode')
    if (!signer || !address) return toast.error('Connect wallet')
    const market = getPrivateBondMarketContract(signer)
    if (!market) return toast.error('PrivateBondMarket not configured')
    const v = validateAmount(quoteAmount)
    if (!v.valid) return toast.error(v.error || 'Invalid amount')
    setBusy('buy')
    try {
      toast.loading('Generating bond purchase proof…', { id: 'bond-buy' })
      const { proof, publicInputs } = await provePrivateBond({
        nullifierHash: randomHex(),
        noteCommitment: randomHex(),
        faceValue: parseEther(quoteAmount).toString(),
        merkleRoot: randomHex(),
      })
      toast.loading('Purchasing bond…', { id: 'bond-buy' })
      const tx = await market.purchaseBond(parseEther(quoteAmount), proof, publicInputs)
      await waitAndParseTransaction(tx, address, provider)
      toast.success('Bond purchased', { id: 'bond-buy' })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed', { id: 'bond-buy' })
    } finally {
      setBusy(null)
    }
  }

  const handleRedeem = async () => {
    if (mode !== 'zk') return toast.error('Use Private (ZK) mode')
    if (!signer || !address) return toast.error('Connect wallet')
    const market = getPrivateBondMarketContract(signer)
    if (!market) return toast.error('PrivateBondMarket not configured')
    const idNum = parseInt(noteId, 10)
    if (!Number.isFinite(idNum) || idNum < 0) return toast.error('Invalid note id')
    setBusy('redeem')
    try {
      toast.loading('Generating redeem proof…', { id: 'bond-redeem' })
      const { proof, publicInputs } = await provePrivateBond({
        nullifierHash: randomHex(),
        noteCommitment: randomHex(),
        faceValue: '0',
        merkleRoot: randomHex(),
      })
      toast.loading('Redeeming bond…', { id: 'bond-redeem' })
      const tx = await market.redeemBond(idNum, proof, publicInputs)
      await waitAndParseTransaction(tx, address, provider)
      toast.success('Bond redeemed', { id: 'bond-redeem' })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed', { id: 'bond-redeem' })
    } finally {
      setBusy(null)
    }
  }

  return (
    <ShieldedModuleCard title="Private bonds">
      <p className="text-sm text-terminal-text-dim">
        Buy and redeem bond notes privately: face value and ownership move in the shielded pool without a public
        holder registry.
      </p>
      <div>
        <label className="block text-sm text-terminal-text-dim mb-1">Purchase quote (AGS)</label>
        <input type="number" min={0} step="0.001" className="input-field w-full" value={quoteAmount} onChange={(e) => setQuoteAmount(e.target.value)} disabled={busy !== null} />
      </div>
      <button type="button" className="btn-primary mb-3" disabled={!configured || busy !== null} onClick={() => void handlePurchase()}>
        {busy === 'buy' ? 'Submitting…' : 'Purchase bond (ZK)'}
      </button>
      <div>
        <label className="block text-sm text-terminal-text-dim mb-1">Note id to redeem</label>
        <input className="input-field w-full" value={noteId} onChange={(e) => setNoteId(e.target.value)} disabled={busy !== null} />
      </div>
      <button type="button" className="btn-secondary" disabled={!configured || busy !== null} onClick={() => void handleRedeem()}>
        {busy === 'redeem' ? 'Submitting…' : 'Redeem bond (ZK)'}
      </button>
    </ShieldedModuleCard>
  )
}

function DisclosurePanel({ mode }: { mode: 'legacy' | 'zk' }) {
  const { signer, address, provider } = useWalletStore()
  const [kind, setKind] = useState('0')
  const [nullifier, setNullifier] = useState('')
  const [subjectCommitment, setSubjectCommitment] = useState('')
  const [threshold, setThreshold] = useState('')
  const [merkleRoot, setMerkleRoot] = useState('')
  const [busy, setBusy] = useState(false)
  const configured =
    CONTRACT_ADDRESSES.SELECTIVE_DISCLOSURE_HUB &&
    CONTRACT_ADDRESSES.SELECTIVE_DISCLOSURE_HUB !== ZERO_ADDRESS

  const handleVerify = async () => {
    if (mode !== 'zk') {
      toast.error('Switch to Private (ZK) mode for selective disclosure')
      return
    }
    if (!signer || !address) return toast.error('Connect wallet')
    const n = parseBytes32(nullifier)
    const s = parseBytes32(subjectCommitment)
    const root = parseBytes32(merkleRoot)
    if (!n || !s || !root) return toast.error('Nullifier, commitment, and merkle root must be 32-byte hex')
    const hub = getSelectiveDisclosureHubContract(signer)
    if (!hub) return toast.error('SelectiveDisclosureHub not configured')
    setBusy(true)
    try {
      const kindNum = parseInt(kind, 10)
      const thresholdWei = BigInt(threshold || '0')
      toast.loading('Generating disclosure proof…', { id: 'disclosure' })
      const { proof, publicInputs } = await proveSelectiveDisclosure({
        nullifierHash: n,
        kind: kindNum.toString(),
        subjectCommitment: s,
        threshold: thresholdWei.toString(),
        merkleRoot: root,
      })
      toast.loading('Submitting disclosure…', { id: 'disclosure' })
      const tx = await hub.verifyDisclosure(kindNum, proof, publicInputs)
      await waitAndParseTransaction(tx, address, provider)
      toast.success('Disclosure verified on-chain', { id: 'disclosure' })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Disclosure failed', { id: 'disclosure' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <ShieldedModuleCard title="Selective disclosure">
      <p className="text-sm text-terminal-text-dim">
        Prove only what you agree to share — net-worth band, age threshold, ownership, or repayment history — without
        exporting your whole shielded balance to an auditor.
      </p>
      <div>
        <label className="block text-sm text-terminal-text-dim mb-1">Disclosure kind</label>
        <select className="input-field w-full" value={kind} onChange={(e) => setKind(e.target.value)} disabled={busy}>
          <option value="0">Net worth band</option>
          <option value="1">Age threshold</option>
          <option value="2">Ownership</option>
          <option value="3">Repayment history</option>
        </select>
      </div>
      <div>
        <label className="block text-sm text-terminal-text-dim mb-1">Nullifier hash</label>
        <input className="input-field w-full font-mono text-xs" value={nullifier} onChange={(e) => setNullifier(e.target.value)} disabled={busy} />
      </div>
      <div>
        <label className="block text-sm text-terminal-text-dim mb-1">Subject commitment</label>
        <input className="input-field w-full font-mono text-xs" value={subjectCommitment} onChange={(e) => setSubjectCommitment(e.target.value)} disabled={busy} />
      </div>
      <div>
        <label className="block text-sm text-terminal-text-dim mb-1">Threshold / band (wei)</label>
        <input className="input-field w-full" value={threshold} onChange={(e) => setThreshold(e.target.value)} disabled={busy} />
      </div>
      <div>
        <label className="block text-sm text-terminal-text-dim mb-1">Merkle root</label>
        <input className="input-field w-full font-mono text-xs" value={merkleRoot} onChange={(e) => setMerkleRoot(e.target.value)} disabled={busy} />
      </div>
      <button type="button" className="btn-primary" disabled={!configured || busy} onClick={() => void handleVerify()}>
        {busy ? 'Verifying…' : 'Verify selective disclosure'}
      </button>
    </ShieldedModuleCard>
  )
}

function RelayerPanel() {
  const { signer, address, provider } = useWalletStore()
  const [stakeAmount, setStakeAmount] = useState('')
  const [busy, setBusy] = useState(false)
  const configured =
    CONTRACT_ADDRESSES.RELAYER_MARKETPLACE && CONTRACT_ADDRESSES.RELAYER_MARKETPLACE !== ZERO_ADDRESS

  const handleRegister = async () => {
    try {
      checkRateLimit('critical')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Rate limit')
      return
    }
    if (!signer || !address) return toast.error('Connect wallet')
    const v = validateAmount(stakeAmount)
    if (!v.valid) return toast.error(v.error || 'Invalid stake')
    const market = getRelayerMarketplaceContract(signer)
    const token = getTokenContract(signer)
    if (!market) return toast.error('RelayerMarketplace not configured')
    setBusy(true)
    try {
      const wei = parseEther(stakeAmount)
      toast.loading('Approving stake…', { id: 'relayer' })
      const approveTx = await token.approve(await market.getAddress(), wei)
      await approveTx.wait()
      toast.loading('Registering relayer…', { id: 'relayer' })
      const tx = await market.register(wei)
      await waitAndParseTransaction(tx, address, provider)
      toast.success('Relayer registered', { id: 'relayer' })
      setStakeAmount('')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed', { id: 'relayer' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <ShieldedModuleCard title="Relayer market">
      <p className="text-sm text-terminal-text-dim">
        Stake AGS to run a gas relay for other users’ private transactions. You earn relay fees; higher stake improves
        trust and queue priority on Sonic.
      </p>
      <div>
        <label className="block text-sm text-terminal-text-dim mb-1">Stake (AGS)</label>
        <input
          type="number"
          step="0.001"
          min={0}
          className="input-field w-full"
          value={stakeAmount}
          onChange={(e) => setStakeAmount(e.target.value)}
          disabled={busy}
        />
      </div>
      <button type="button" className="btn-primary" disabled={!configured || busy} onClick={() => void handleRegister()}>
        {busy ? 'Registering…' : 'Register as relayer'}
      </button>
    </ShieldedModuleCard>
  )
}

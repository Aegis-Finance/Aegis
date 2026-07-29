import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Contract, ethers, getAddress } from 'ethers'
import toast from 'react-hot-toast'

import { CONTRACT_ADDRESSES, DEFAULT_NETWORK, ZERO_ADDRESS } from '@/config/contracts'
import { useWalletStore } from '@/store/walletStore'
import {
  getDefaultReadProvider,
  getStagedCapitalVaultAt,
} from '@/utils/contracts'
import { formatAddress } from '@/utils/format'
import { isValidAddress } from '@/utils/security'
import { stagedCapitalInvestorLeaf } from '@/utils/stagedCapitalMerkle'
import { stagedCapitalTypedDomain, STAGED_CAPITAL_EIP712_TYPES } from '@/utils/stagedCapitalEip712'
import { waitAndParseTransaction } from '@/utils/transactionHelper'

const ROUND_STATUS = ['Funding', 'Failed', 'Active', 'Completed'] as const

const ERC20_MIN = [
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
] as const

type RoundView = {
  founder: string
  token: string
  hardCap: bigint
  minRaise: bigint
  startTime: bigint
  endTime: bigint
  totalRaised: bigint
  status: number
  milestoneCount: number
  committeeThreshold: number
  nextMilestone: number
  releaseBps: readonly bigint[]
  investorMerkleRoot: string
}

function parseRound(raw: unknown): RoundView {
  const r = raw as Record<string, unknown>
  const bpsRaw = r.releaseBps
  const releaseBps = Array.isArray(bpsRaw)
    ? (bpsRaw as unknown[]).map((x) => BigInt(String(x)))
    : []
  return {
    founder: String(r.founder),
    token: String(r.token),
    hardCap: BigInt(String(r.hardCap)),
    minRaise: BigInt(String(r.minRaise)),
    startTime: BigInt(String(r.startTime)),
    endTime: BigInt(String(r.endTime)),
    totalRaised: BigInt(String(r.totalRaised)),
    status: Number(r.status),
    milestoneCount: Number(r.milestoneCount),
    committeeThreshold: Number(r.committeeThreshold),
    nextMilestone: Number(r.nextMilestone),
    releaseBps,
    investorMerkleRoot: String(r.investorMerkleRoot ?? ethers.ZeroHash),
  }
}

export default function StagedCapital() {
  const { provider, signer, address, chainId, isConnected } = useWalletStore()
  const [roundIdStr, setRoundIdStr] = useState('1')
  const [depositAmount, setDepositAmount] = useState('')
  const [stealthTagHex, setStealthTagHex] = useState('')
  const [evidenceHex, setEvidenceHex] = useState('')
  const [committeeSigs, setCommitteeSigs] = useState<{ signer: string; signature: string }[]>([])
  const [merkleProofJson, setMerkleProofJson] = useState('[]')

  const [createToken, setCreateToken] = useState('')
  const [createFounder, setCreateFounder] = useState('')
  const [createCommittee, setCreateCommittee] = useState('')
  const [createThreshold, setCreateThreshold] = useState('2')
  const [createHardCap, setCreateHardCap] = useState('')
  const [createMinRaise, setCreateMinRaise] = useState('')
  const [createFundingDays, setCreateFundingDays] = useState('30')
  const [createReleaseBps, setCreateReleaseBps] = useState('2500,2500,2500,2500')
  const [createMerkleRoot, setCreateMerkleRoot] = useState('')
  const [creatingRound, setCreatingRound] = useState(false)

  const [searchParams] = useSearchParams()
  const vaultParam = (searchParams.get('vault') ?? '').trim()
  const vaultQueryInvalid = Boolean(vaultParam && !isValidAddress(vaultParam))

  const readProvider = provider ?? getDefaultReadProvider()

  const effectiveVaultAddr = useMemo(() => {
    if (vaultParam) {
      if (!isValidAddress(vaultParam)) return null
      return getAddress(vaultParam)
    }
    const d = CONTRACT_ADDRESSES.STAGED_CAPITAL_VAULT
    if (!d || d === ZERO_ADDRESS || !isValidAddress(d)) return null
    return getAddress(d)
  }, [vaultParam])

  const vaultRead = useMemo(
    () => (effectiveVaultAddr ? getStagedCapitalVaultAt(effectiveVaultAddr, readProvider) : null),
    [effectiveVaultAddr, readProvider]
  )

  const effectiveChainId = chainId ?? DEFAULT_NETWORK.chainId

  const roundId = useMemo(() => {
    try {
      return BigInt(roundIdStr.trim() || '0')
    } catch {
      return 0n
    }
  }, [roundIdStr])

  const { data: roundData, refetch: refetchRound } = useQuery({
    queryKey: ['staged-capital-round', effectiveVaultAddr, roundIdStr, address],
    enabled: Boolean(vaultRead && roundId > 0n),
    queryFn: async () => {
      if (!vaultRead || roundId === 0n) return null
      const raw = await vaultRead.getRound(roundId)
      const committee: string[] = await vaultRead.getCommittee(roundId)
      const payouts: bigint[] = []
      const rv = parseRound(raw)
      for (let i = 0; i < rv.milestoneCount; i++) {
        const p: bigint = await vaultRead.milestonePayout(roundId, i)
        payouts.push(p)
      }
      const dep =
        address && roundId > 0n
          ? (await vaultRead.deposits(roundId, address)) as bigint
          : 0n
      let tokenSymbol = 'TOKEN'
      let tokenDecimals = 18
      try {
        const t = new Contract(rv.token, ERC20_MIN, readProvider)
        tokenSymbol = await t.symbol()
        const d = Number(await t.decimals())
        if (Number.isFinite(d) && d >= 0 && d <= 36) tokenDecimals = d
      } catch {
        /* ignore */
      }
      let investorLeafPreview: string | null = null
      if (address) {
        investorLeafPreview = stagedCapitalInvestorLeaf(address)
        try {
          const onChain = (await vaultRead.computeInvestorLeaf(address)) as string
          if (onChain.toLowerCase() !== investorLeafPreview.toLowerCase()) {
            console.warn('stagedCapital leaf mismatch JS vs chain', { investorLeafPreview, onChain })
          }
        } catch {
          /* ignore */
        }
      }
      return { round: rv, committee, payouts, myDeposit: dep, tokenSymbol, tokenDecimals, investorLeafPreview }
    },
  })

  const signAttestation = async () => {
    if (!effectiveVaultAddr || !vaultRead || !signer || roundId === 0n) {
      toast.error('Connect a committee wallet and set a valid round id.')
      return
    }
    if (roundData?.round.status !== 2) {
      toast.error('Round must be Active (finalize after min raise) before committee attestations.')
      return
    }
    const addr = await signer.getAddress()
    const committee = roundData?.committee ?? []
    if (!committee.some((c) => c.toLowerCase() === addr.toLowerCase())) {
      toast.error('Connected wallet is not on this round’s committee.')
      return
    }
    let evidence: string
    try {
      evidence = ethers.isHexString(evidenceHex.trim(), 32)
        ? evidenceHex.trim()
        : ethers.keccak256(ethers.toUtf8Bytes(evidenceHex.trim() || 'milestone'))
    } catch {
      toast.error('Evidence must be 32-byte hex or text (hashed).')
      return
    }
    if (committeeSigs.some((s) => s.signer.toLowerCase() === addr.toLowerCase())) {
      toast.error('You already added a signature for this wallet.')
      return
    }
    try {
      const domain = stagedCapitalTypedDomain(effectiveVaultAddr!, effectiveChainId)
      const sig = await signer.signTypedData(domain, STAGED_CAPITAL_EIP712_TYPES, {
        roundId,
        milestoneIndex: BigInt(roundData?.round.nextMilestone ?? 0),
        evidenceHash: evidence,
      })
      setCommitteeSigs((prev) => [...prev, { signer: addr, signature: sig }])
      toast.success('Attestation signature recorded locally — submit when you have enough committee sigs.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Signing failed')
    }
  }

  const submitAttestation = async () => {
    if (!vaultRead || !signer || roundId === 0n) return
    if (roundData?.round.status !== 2) {
      toast.error('Round must be Active.')
      return
    }
    const v = effectiveVaultAddr ? getStagedCapitalVaultAt(effectiveVaultAddr, signer) : null
    if (!v) return
    const thr = roundData?.round.committeeThreshold ?? 0
    if (committeeSigs.length < thr) {
      toast.error(`Need at least ${thr} committee signatures (have ${committeeSigs.length}).`)
      return
    }
    let evidence: string
    try {
      evidence = ethers.isHexString(evidenceHex.trim(), 32)
        ? evidenceHex.trim()
        : ethers.keccak256(ethers.toUtf8Bytes(evidenceHex.trim() || 'milestone'))
    } catch {
      toast.error('Invalid evidence hash.')
      return
    }
    const idx = roundData?.round.nextMilestone ?? 0
    const signers = committeeSigs.map((s) => s.signer)
    const signatures = committeeSigs.map((s) => s.signature)
    try {
      const tx = await v.attestMilestone(roundId, idx, evidence, signers, signatures)
      const user = await signer.getAddress()
      await waitAndParseTransaction(tx, user, provider ?? readProvider)
      toast.success('Milestone attested on-chain.')
      setCommitteeSigs([])
      await refetchRound()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Attestation failed')
    }
  }

  const deposit = async () => {
    if (!signer || !roundData || roundId === 0n) return
    const v = effectiveVaultAddr ? getStagedCapitalVaultAt(effectiveVaultAddr, signer) : null
    if (!v) return
    let amount: bigint
    try {
      amount = ethers.parseUnits(depositAmount.trim() || '0', roundData.tokenDecimals)
    } catch {
      toast.error(`Invalid amount (token uses ${roundData.tokenDecimals} decimals).`)
      return
    }
    if (amount <= 0n) {
      toast.error('Amount must be positive.')
      return
    }
    const token = new Contract(roundData.round.token, ERC20_MIN, signer)
    const user = await signer.getAddress()
    try {
      const allowance: bigint = await token.allowance(user, effectiveVaultAddr!)
      if (allowance < amount) {
        const txA = await token.approve(effectiveVaultAddr!, ethers.MaxUint256)
        await waitAndParseTransaction(txA, user, provider ?? readProvider)
      }
      let tag = ethers.ZeroHash
      if (stealthTagHex.trim()) {
        tag = ethers.isHexString(stealthTagHex.trim(), 32)
          ? stealthTagHex.trim()
          : ethers.keccak256(ethers.toUtf8Bytes(stealthTagHex.trim()))
      }
      const root = roundData.round.investorMerkleRoot
      const hasAllowlist =
        root &&
        root !== ethers.ZeroHash &&
        root.toLowerCase() !== '0x0000000000000000000000000000000000000000000000000000000000000000'
      let merkleProof: string[] = []
      if (hasAllowlist) {
        try {
          const parsed = JSON.parse(merkleProofJson.trim() || '[]') as unknown
          if (!Array.isArray(parsed)) throw new Error('Proof must be a JSON array')
          merkleProof = parsed.map((x) => {
            const s = String(x).trim()
            if (!ethers.isHexString(s, 32)) throw new Error(`Invalid proof element: ${s}`)
            return s
          })
        } catch (err) {
          toast.error(err instanceof Error ? err.message : 'Invalid Merkle proof JSON')
          return
        }
      }
      const tx = await v.commitCapital(roundId, amount, tag, merkleProof)
      await waitAndParseTransaction(tx, user, provider ?? readProvider)
      toast.success('Capital committed.')
      setDepositAmount('')
      await refetchRound()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Deposit failed')
    }
  }

  const finalize = async () => {
    if (!signer) {
      toast.error('Connect a wallet to send finalizeRound.')
      return
    }
    const v = effectiveVaultAddr ? getStagedCapitalVaultAt(effectiveVaultAddr, signer) : null
    if (!v || roundId === 0n) return
    try {
      const user = await signer.getAddress()
      const tx = await v.finalizeRound(roundId)
      await waitAndParseTransaction(tx, user, provider ?? readProvider)
      toast.success('Round finalized.')
      await refetchRound()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Finalize failed')
    }
  }

  const refund = async () => {
    if (!signer) return
    const v = effectiveVaultAddr ? getStagedCapitalVaultAt(effectiveVaultAddr, signer) : null
    if (!v || roundId === 0n) return
    try {
      const user = await signer.getAddress()
      const tx = await v.refund(roundId)
      await waitAndParseTransaction(tx, user, provider ?? readProvider)
      toast.success('Refund claimed.')
      await refetchRound()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Refund failed')
    }
  }

  const createRound = async () => {
    if (!signer || !effectiveVaultAddr) {
      toast.error('Connect wallet and configure vault address.')
      return
    }
    const v = getStagedCapitalVaultAt(effectiveVaultAddr, signer)
    if (!v) return
    const user = await signer.getAddress()
    const founder = createFounder.trim() || user
    if (!isValidAddress(createToken.trim())) {
      toast.error('Enter a valid ERC-20 token address.')
      return
    }
    const committee = createCommittee
      .split(/[,\s]+/)
      .map((s) => s.trim())
      .filter(Boolean)
    if (committee.length === 0 || committee.length > 24) {
      toast.error('Committee must have 1–24 wallet addresses.')
      return
    }
    for (const c of committee) {
      if (!isValidAddress(c)) {
        toast.error(`Invalid committee address: ${c}`)
        return
      }
    }
    const thr = parseInt(createThreshold, 10)
    if (!Number.isFinite(thr) || thr < 1 || thr > committee.length) {
      toast.error('Threshold must be between 1 and committee size.')
      return
    }
    let hardCap: bigint
    let minRaise: bigint
    try {
      hardCap = ethers.parseEther(createHardCap.trim() || '0')
      minRaise = ethers.parseEther(createMinRaise.trim() || '0')
    } catch {
      toast.error('Invalid cap or min raise amount.')
      return
    }
    const days = parseFloat(createFundingDays)
    if (!Number.isFinite(days) || days <= 0) {
      toast.error('Invalid funding window.')
      return
    }
    const startTime = BigInt(Math.floor(Date.now() / 1000))
    const endTime = startTime + BigInt(Math.ceil(days * 86400))
    const releaseBps = createReleaseBps
      .split(/[,\s]+/)
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => Number.isFinite(n))
    if (releaseBps.length === 0) {
      toast.error('Enter milestone release bps (e.g. 2500,2500,2500,2500).')
      return
    }
    const bpsSum = releaseBps.reduce((a, b) => a + b, 0)
    if (bpsSum !== 10000) {
      toast.error(`Release bps must sum to 10000 (got ${bpsSum}).`)
      return
    }
    let investorMerkleRoot = ethers.ZeroHash
    if (createMerkleRoot.trim()) {
      if (!ethers.isHexString(createMerkleRoot.trim(), 32)) {
        toast.error('Merkle root must be 32-byte hex or empty.')
        return
      }
      investorMerkleRoot = createMerkleRoot.trim()
    }

    setCreatingRound(true)
    try {
      const tx = await v.createRound(
        getAddress(createToken.trim()),
        getAddress(founder),
        committee.map((c) => getAddress(c)),
        BigInt(thr),
        hardCap,
        minRaise,
        startTime,
        endTime,
        releaseBps.map((n) => Number(n)),
        investorMerkleRoot
      )
      const receipt = await waitAndParseTransaction(tx, user, provider ?? readProvider)
      toast.success('Round created on-chain.')
      if (receipt?.logs) {
        setRoundIdStr(String(Number(roundIdStr) + 1))
      }
      await refetchRound()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'createRound failed')
    } finally {
      setCreatingRound(false)
    }
  }

  const claim = async () => {
    if (!signer) return
    const v = effectiveVaultAddr ? getStagedCapitalVaultAt(effectiveVaultAddr, signer) : null
    if (!v || roundId === 0n) return
    try {
      const user = await signer.getAddress()
      const tx = await v.claimMilestone(roundId)
      await waitAndParseTransaction(tx, user, provider ?? readProvider)
      toast.success('Milestone claimed to founder.')
      await refetchRound()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Claim failed')
    }
  }

  if (vaultQueryInvalid) {
    return (
      <div className="mx-auto max-w-4xl space-y-6">
        <h1 className="text-2xl font-semibold text-terminal-text md:text-3xl">Staged capital</h1>
        <div className="card border border-red-500/40 bg-red-950/20 text-sm text-terminal-text-dim">
          That vault link is not valid. Open Staged capital from the app menu, or ask the round organizer for a correct link.
        </div>
        <Link to="/staged-capital" className="text-terminal-accent underline text-sm">
          Go to Staged capital
        </Link>
      </div>
    )
  }

  if (!vaultRead) {
    return (
      <div className="mx-auto max-w-4xl space-y-6">
        <header className="space-y-2">
          <h1 className="text-2xl font-semibold text-terminal-text md:text-3xl">Staged capital</h1>
          <p className="text-sm text-terminal-text-dim max-w-2xl">
            Milestone-based funding for a small invited group — like a private seed round, not a public campaign.
          </p>
        </header>
        <div className="card text-sm text-terminal-text-dim">
          Staged capital is not live on this network yet. For a public raise with many backers, use{' '}
          <Link to="/crowdfunding" className="text-terminal-accent underline">
            Crowdfunding
          </Link>
          .
        </div>
      </div>
    )
  }

  const nowSec = Math.floor(Date.now() / 1000)
  const r = roundData?.round
  const canFinalize = r?.status === 0 && nowSec > Number(r.endTime)
  const isFounder = address && r?.founder.toLowerCase() === address.toLowerCase()
  const statusLabel = r ? (ROUND_STATUS[r.status] ?? 'Unknown') : '—'
  const fundingOpen = r?.status === 0
  const fundingEndDate = r ? new Date(Number(r.endTime) * 1000).toLocaleString() : null

  return (
    <StagedCapitalPage
      roundIdStr={roundIdStr}
      setRoundIdStr={setRoundIdStr}
      onRefresh={() => void refetchRound()}
      roundData={roundData}
      r={r}
      statusLabel={statusLabel}
      fundingOpen={fundingOpen}
      fundingEndDate={fundingEndDate}
      canFinalize={canFinalize}
      isFounder={Boolean(isFounder)}
      isConnected={isConnected}
      depositAmount={depositAmount}
      setDepositAmount={setDepositAmount}
      stealthTagHex={stealthTagHex}
      setStealthTagHex={setStealthTagHex}
      merkleProofJson={merkleProofJson}
      setMerkleProofJson={setMerkleProofJson}
      onDeposit={() => void deposit()}
      onFinalize={() => void finalize()}
      onRefund={() => void refund()}
      evidenceHex={evidenceHex}
      setEvidenceHex={setEvidenceHex}
      committeeSigs={committeeSigs}
      onSignAttestation={() => void signAttestation()}
      onSubmitAttestation={() => void submitAttestation()}
      onClearSigs={() => setCommitteeSigs([])}
      onClaim={() => void claim()}
      createToken={createToken}
      setCreateToken={setCreateToken}
      createFounder={createFounder}
      setCreateFounder={setCreateFounder}
      createCommittee={createCommittee}
      setCreateCommittee={setCreateCommittee}
      createThreshold={createThreshold}
      setCreateThreshold={setCreateThreshold}
      createHardCap={createHardCap}
      setCreateHardCap={setCreateHardCap}
      createMinRaise={createMinRaise}
      setCreateMinRaise={setCreateMinRaise}
      createFundingDays={createFundingDays}
      setCreateFundingDays={setCreateFundingDays}
      createReleaseBps={createReleaseBps}
      setCreateReleaseBps={setCreateReleaseBps}
      createMerkleRoot={createMerkleRoot}
      setCreateMerkleRoot={setCreateMerkleRoot}
      creatingRound={creatingRound}
      onCreateRound={() => void createRound()}
      roundId={roundId}
    />
  )
}

type RoundQueryData = {
  round: RoundView
  committee: string[]
  payouts: bigint[]
  myDeposit: bigint
  tokenSymbol: string
  tokenDecimals: number
  investorLeafPreview: string | null
}

type StagedCapitalPageProps = {
  roundIdStr: string
  setRoundIdStr: (v: string) => void
  onRefresh: () => void
  roundData: RoundQueryData | null | undefined
  r: RoundView | undefined
  statusLabel: string
  fundingOpen: boolean
  fundingEndDate: string | null
  canFinalize: boolean | undefined
  isFounder: boolean
  isConnected: boolean
  depositAmount: string
  setDepositAmount: (v: string) => void
  stealthTagHex: string
  setStealthTagHex: (v: string) => void
  merkleProofJson: string
  setMerkleProofJson: (v: string) => void
  onDeposit: () => void
  onFinalize: () => void
  onRefund: () => void
  evidenceHex: string
  setEvidenceHex: (v: string) => void
  committeeSigs: { signer: string; signature: string }[]
  onSignAttestation: () => void
  onSubmitAttestation: () => void
  onClearSigs: () => void
  onClaim: () => void
  createToken: string
  setCreateToken: (v: string) => void
  createFounder: string
  setCreateFounder: (v: string) => void
  createCommittee: string
  setCreateCommittee: (v: string) => void
  createThreshold: string
  setCreateThreshold: (v: string) => void
  createHardCap: string
  setCreateHardCap: (v: string) => void
  createMinRaise: string
  setCreateMinRaise: (v: string) => void
  createFundingDays: string
  setCreateFundingDays: (v: string) => void
  createReleaseBps: string
  setCreateReleaseBps: (v: string) => void
  createMerkleRoot: string
  setCreateMerkleRoot: (v: string) => void
  creatingRound: boolean
  onCreateRound: () => void
  roundId: bigint
}

function StagedCapitalPage(props: StagedCapitalPageProps) {
  const [tab, setTab] = useState<'join' | 'create'>('join')
  const [showAdvancedInvest, setShowAdvancedInvest] = useState(false)
  const [showAdvancedCreate, setShowAdvancedCreate] = useState(false)

  const {
    roundIdStr,
    setRoundIdStr,
    onRefresh,
    roundData,
    r,
    statusLabel,
    fundingOpen,
    fundingEndDate,
    canFinalize,
    isFounder,
    isConnected,
    depositAmount,
    setDepositAmount,
    stealthTagHex,
    setStealthTagHex,
    merkleProofJson,
    setMerkleProofJson,
    onDeposit,
    onFinalize,
    onRefund,
    evidenceHex,
    setEvidenceHex,
    committeeSigs,
    onSignAttestation,
    onSubmitAttestation,
    onClearSigs,
    onClaim,
    createToken,
    setCreateToken,
    createFounder,
    setCreateFounder,
    createCommittee,
    setCreateCommittee,
    createThreshold,
    setCreateThreshold,
    createHardCap,
    setCreateHardCap,
    createMinRaise,
    setCreateMinRaise,
    createFundingDays,
    setCreateFundingDays,
    createReleaseBps,
    setCreateReleaseBps,
    createMerkleRoot,
    setCreateMerkleRoot,
    creatingRound,
    onCreateRound,
    roundId,
  } = props

  const hasAllowlist =
    r &&
    r.investorMerkleRoot &&
    r.investorMerkleRoot !== ethers.ZeroHash &&
    r.investorMerkleRoot.toLowerCase() !== '0x0000000000000000000000000000000000000000000000000000000000000000'

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold text-terminal-text md:text-3xl">Staged capital</h1>
        <p className="text-sm text-terminal-text-dim max-w-2xl leading-relaxed">
          Raise from a small invited group with funds released in milestones. Investors commit during a funding window;
          a committee you choose must approve each milestone before the founder receives the next slice.
        </p>
        <p className="text-xs text-terminal-text-dim">
          Running a public campaign with many backers? Use{' '}
          <Link to="/crowdfunding" className="text-terminal-accent underline">
            Crowdfunding
          </Link>{' '}
          instead.
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-3">
        <StepCard step="1" title="Commit" body="Investors deposit during the funding window. Optional allowlists keep the round private." />
        <StepCard step="2" title="Approve milestones" body="Your committee signs off when deliverables land — e.g. 2-of-3 wallets must agree." />
        <StepCard step="3" title="Release funds" body="After approval, the founder claims each slice. If the round fails, investors can refund." />
      </div>

      <div className="flex rounded-lg border border-terminal-border/40 p-1 bg-terminal-bg/40">
        <button
          type="button"
          onClick={() => setTab('join')}
          className={`flex-1 rounded-md py-2.5 text-sm font-medium ${
            tab === 'join' ? 'bg-terminal-surface text-terminal-text shadow-sm' : 'text-terminal-text-dim'
          }`}
        >
          Join a round
        </button>
        <button
          type="button"
          onClick={() => setTab('create')}
          className={`flex-1 rounded-md py-2.5 text-sm font-medium ${
            tab === 'create' ? 'bg-terminal-accent/15 text-terminal-accent shadow-sm' : 'text-terminal-text-dim'
          }`}
        >
          Start a round
        </button>
      </div>

      {tab === 'join' && (
        <div className="space-y-4">
          <div className="card border border-terminal-border/60 bg-terminal-surface/80 flex flex-wrap gap-3 items-end">
            <label className="block space-y-1.5 text-sm flex-1 min-w-[120px]">
              <span className="text-xs text-terminal-text-dim">Round number</span>
              <input
                value={roundIdStr}
                onChange={(e) => setRoundIdStr(e.target.value)}
                className="input-field w-full min-w-0"
                placeholder="1"
              />
            </label>
            <button type="button" onClick={onRefresh} className="btn-secondary shrink-0">
              Refresh
            </button>
          </div>

          {!roundData && roundId > 0n ? (
            <p className="text-sm text-terminal-text-dim card">No round found with that number — check the id with the organizer.</p>
          ) : null}

          {roundData && r ? (
            <>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <StatCard label="Status" value={statusLabel} />
                <StatCard
                  label="Raised"
                  value={`${ethers.formatUnits(r.totalRaised, roundData.tokenDecimals)} ${roundData.tokenSymbol}`}
                  hint={`Min ${ethers.formatUnits(r.minRaise, roundData.tokenDecimals)} · Cap ${ethers.formatUnits(r.hardCap, roundData.tokenDecimals)}`}
                />
                <StatCard label="Committee" value={`${r.committeeThreshold} of ${roundData.committee.length}`} hint="Signatures per milestone" />
                <StatCard
                  label="Your deposit"
                  value={`${ethers.formatUnits(roundData.myDeposit, roundData.tokenDecimals)} ${roundData.tokenSymbol}`}
                />
              </div>

              <div className="card border border-terminal-border/50 bg-terminal-bg/40 space-y-3 text-sm">
                <div className="grid sm:grid-cols-2 gap-3">
                  <div>
                    <div className="text-xs text-terminal-text-dim">Founder</div>
                    <div className="font-mono text-xs mt-0.5">{formatAddress(r.founder)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-terminal-text-dim">Payment token</div>
                    <div className="mt-0.5">{roundData.tokenSymbol}</div>
                  </div>
                  {fundingEndDate ? (
                    <div>
                      <div className="text-xs text-terminal-text-dim">Funding ends</div>
                      <div className="mt-0.5">{fundingEndDate}</div>
                    </div>
                  ) : null}
                  <div>
                    <div className="text-xs text-terminal-text-dim">Next milestone</div>
                    <div className="mt-0.5">#{r.nextMilestone} of {r.milestoneCount}</div>
                  </div>
                </div>

                <details className="text-xs">
                  <summary className="cursor-pointer text-terminal-accent">Milestone schedule</summary>
                  <ul className="mt-2 space-y-1 text-terminal-text-dim list-disc list-inside">
                    {r.releaseBps.map((bps, i) => (
                      <li key={i}>
                        Milestone {i + 1}: {(Number(bps) / 100).toFixed(1)}% →{' '}
                        {ethers.formatUnits(roundData.payouts[i] ?? 0n, roundData.tokenDecimals)} {roundData.tokenSymbol}
                      </li>
                    ))}
                  </ul>
                </details>

                <details className="text-xs">
                  <summary className="cursor-pointer text-terminal-accent">Committee wallets</summary>
                  <ul className="mt-2 space-y-1 font-mono text-[11px]">
                    {roundData.committee.map((c) => (
                      <li key={c}>{formatAddress(c)}</li>
                    ))}
                  </ul>
                </details>
              </div>

              {fundingOpen && (
                <div className="card border border-terminal-accent/25 bg-terminal-accent/5 space-y-4">
                  <div>
                    <h2 className="text-lg font-semibold text-terminal-text">Invest in this round</h2>
                    <p className="text-xs text-terminal-text-dim mt-1">
                      Commit {roundData.tokenSymbol} before the funding window closes. You may need committee approval on
                      an allowlist first.
                    </p>
                  </div>
                  <label className="block space-y-1.5">
                    <span className="text-xs text-terminal-text-dim">Amount ({roundData.tokenSymbol})</span>
                    <input
                      value={depositAmount}
                      onChange={(e) => setDepositAmount(e.target.value)}
                      className="input-field w-full min-w-0 text-right font-mono"
                      placeholder="0.0"
                    />
                  </label>
                  <button type="button" className="text-xs text-terminal-accent" onClick={() => setShowAdvancedInvest((v) => !v)}>
                    {showAdvancedInvest ? 'Hide' : 'Show'} privacy &amp; allowlist options
                  </button>
                  {showAdvancedInvest ? (
                    <div className="space-y-3 rounded-lg border border-terminal-border/30 bg-terminal-bg/40 p-3">
                      <Field
                        label="Private tag (optional)"
                        value={stealthTagHex}
                        onChange={setStealthTagHex}
                        placeholder="Optional label — kept off-chain"
                      />
                      {hasAllowlist ? (
                        <label className="block space-y-1.5">
                          <span className="text-xs text-terminal-text-dim">Allowlist proof (from organizer)</span>
                          <textarea
                            value={merkleProofJson}
                            onChange={(e) => setMerkleProofJson(e.target.value)}
                            className="input-field w-full min-h-[4rem] font-mono text-xs"
                            placeholder='["0x…","0x…"]'
                          />
                        </label>
                      ) : (
                        <p className="text-[11px] text-terminal-text-dim">This round is open — no allowlist proof needed.</p>
                      )}
                    </div>
                  ) : null}
                  <button type="button" className="btn-primary w-full py-3" disabled={!isConnected} onClick={onDeposit}>
                    {isConnected ? 'Commit capital' : 'Connect wallet to invest'}
                  </button>
                </div>
              )}

              {r.status === 0 && (
                <div className="card space-y-3 text-sm">
                  <h3 className="font-semibold text-terminal-text">Close funding</h3>
                  <p className="text-xs text-terminal-text-dim">
                    After the deadline, anyone can close the window. If the minimum was not met, investors get refunds.
                    Otherwise the round becomes active and milestones begin.
                  </p>
                  <button type="button" className="btn-secondary" disabled={!isConnected || !canFinalize} onClick={onFinalize}>
                    Close funding window
                  </button>
                </div>
              )}

              {r.status === 1 && (
                <div className="card space-y-3">
                  <p className="text-sm text-terminal-text-dim">This round did not reach its minimum. Claim your deposit back.</p>
                  <button
                    type="button"
                    className="btn-primary w-full py-3"
                    disabled={!isConnected || roundData.myDeposit === 0n}
                    onClick={onRefund}
                  >
                    Refund my deposit
                  </button>
                </div>
              )}

              {r.status === 2 && (
                <div className="grid gap-4 lg:grid-cols-2">
                  <div className="card space-y-4">
                    <div>
                      <h3 className="font-semibold text-terminal-text">Committee approval</h3>
                      <p className="text-xs text-terminal-text-dim mt-1">
                        Committee members sign that milestone #{r.nextMilestone + 1} is complete. Submit when you have
                        enough signatures.
                      </p>
                    </div>
                    <Field
                      label="Evidence note or hash"
                      value={evidenceHex}
                      onChange={setEvidenceHex}
                      placeholder="Delivery link, report hash, or short description"
                    />
                    <div className="flex flex-wrap gap-2">
                      <button type="button" className="btn-secondary text-sm" disabled={!isConnected} onClick={onSignAttestation}>
                        Sign approval
                      </button>
                      <button type="button" className="btn-primary text-sm" disabled={!isConnected} onClick={onSubmitAttestation}>
                        Submit ({committeeSigs.length} sigs)
                      </button>
                      {committeeSigs.length > 0 ? (
                        <button type="button" className="text-xs text-terminal-text-dim underline" onClick={onClearSigs}>
                          Clear
                        </button>
                      ) : null}
                    </div>
                  </div>
                  <div className="card space-y-4">
                    <div>
                      <h3 className="font-semibold text-terminal-text">Founder claim</h3>
                      <p className="text-xs text-terminal-text-dim mt-1">
                        After committee approval, the founder wallet claims the next milestone payout.
                      </p>
                    </div>
                    <button type="button" className="btn-primary w-full py-3" disabled={!isConnected || !isFounder} onClick={onClaim}>
                      {isFounder ? 'Claim milestone funds' : 'Connect founder wallet'}
                    </button>
                  </div>
                </div>
              )}

              {r.status === 3 && (
                <div className="card text-sm text-terminal-text-dim text-center py-6">
                  Round complete — all milestones have been claimed.
                </div>
              )}
            </>
          ) : null}
        </div>
      )}

      {tab === 'create' && (
        <div className="card border border-terminal-border/60 bg-terminal-surface/80 space-y-4">
          <div>
            <h2 className="text-lg font-semibold text-terminal-text">Start a new round</h2>
            <p className="text-xs text-terminal-text-dim mt-1">
              Set payment token, funding caps, milestone splits, and who approves each release. You stay the founder unless
              you specify another wallet.
            </p>
          </div>
          <div className="grid md:grid-cols-2 gap-3">
            <Field label="Payment token address" value={createToken} onChange={setCreateToken} placeholder="0x…" mono />
            <Field label="Founder wallet" value={createFounder} onChange={setCreateFounder} placeholder="Defaults to you" mono />
            <Field label="Hard cap (token amount)" value={createHardCap} onChange={setCreateHardCap} />
            <Field label="Minimum raise" value={createMinRaise} onChange={setCreateMinRaise} />
            <Field label="Funding period (days)" value={createFundingDays} onChange={setCreateFundingDays} />
            <Field label="Committee approvals needed" value={createThreshold} onChange={setCreateThreshold} placeholder="e.g. 2" />
          </div>
          <button type="button" className="text-xs text-terminal-accent" onClick={() => setShowAdvancedCreate((v) => !v)}>
            {showAdvancedCreate ? 'Hide' : 'Show'} committee &amp; allowlist settings
          </button>
          {showAdvancedCreate ? (
            <div className="grid gap-3 rounded-lg border border-terminal-border/30 bg-terminal-bg/40 p-3">
              <Field
                label="Committee wallets (comma-separated, up to 24)"
                value={createCommittee}
                onChange={setCreateCommittee}
                placeholder="0x…, 0x…"
                mono
              />
              <Field
                label="Investor allowlist root (optional)"
                value={createMerkleRoot}
                onChange={setCreateMerkleRoot}
                placeholder="Leave empty for open round"
                mono
              />
            </div>
          ) : (
            <Field
              label="Committee wallets (comma-separated)"
              value={createCommittee}
              onChange={setCreateCommittee}
              placeholder="Lead investor, co-investor, advisor…"
              mono
            />
          )}
          <Field
            label="Milestone release %"
            value={createReleaseBps}
            onChange={setCreateReleaseBps}
            placeholder="2500,2500,2500,2500 (= 25% each)"
          />
          <button type="button" className="btn-primary w-full py-3" disabled={!isConnected || creatingRound} onClick={onCreateRound}>
            {creatingRound ? 'Confirm in wallet…' : isConnected ? 'Create round' : 'Connect wallet'}
          </button>
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

function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-terminal-border/40 bg-terminal-bg/50 px-4 py-3">
      <div className="text-[11px] text-terminal-text-dim uppercase tracking-wide">{label}</div>
      <div className="text-base font-semibold text-terminal-text mt-1 tabular-nums">{value}</div>
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

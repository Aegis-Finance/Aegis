import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { EventLog } from 'ethers'
import toast from 'react-hot-toast'
import { randomBytes } from 'ethers'
import { ZERO_ADDRESS, CONTRACT_ADDRESSES } from '@/config/contracts'
import { useWalletStore } from '@/store/walletStore'
import {
  getGovernanceContract,
  getGovernanceTreasuryContract,
  getGovernanceEmergencyContract,
  getErc20Contract,
} from '@/utils/contracts'
import { proveGovernance } from '@/utils/prover'
import { groth16ProofBigintsToBytes256 } from '@/utils/proofBytes'
import { proveViaService, proverServiceUrl, randomBytes32Hex } from '@/utils/zkHelpers'
import { isValidHex, checkRateLimit } from '@/utils/security'
import { waitAndParseTransaction } from '@/utils/transactionHelper'
import ModuleDeploymentNotice, { ModuleConfiguredSection } from '@/components/ModuleDeploymentNotice'
import ZkProverNotice from '@/components/ZkProverNotice'
import {
  formatAddress,
  formatBalance,
  formatDate,
  formatDuration,
  formatNumber,
} from '@/utils/format'
export default function Governance() {
  const { provider } = useWalletStore()
  const [activeTab, setActiveTab] = useState<'proposals' | 'create' | 'private-vote' | 'delegate'>('proposals')

  const { data: metrics } = useQuery({
    queryKey: ['governance-metrics'],
    queryFn: async () => {
      if (!provider) return null
      try {
        const contract = getGovernanceContract(provider)
        const [nextProposalId, activeProposals, totalVotingPower] = await contract.getGovernanceMetrics()
        const [votingPeriod, executionDelay, proposalThreshold, quorumThreshold, executionMajorityThreshold] =
          await contract.getGovernanceConfig()
        return {
          nextProposalId: Number(nextProposalId),
          activeProposals: Number(activeProposals),
          totalVotingPower: BigInt(totalVotingPower),
          votingPeriod: BigInt(votingPeriod),
          executionDelay: BigInt(executionDelay),
          proposalThreshold: BigInt(proposalThreshold),
          quorumThreshold: BigInt(quorumThreshold),
          executionMajorityThreshold: BigInt(executionMajorityThreshold),
        }
      } catch (error) {
        console.error('Error fetching governance metrics:', error)
        return { nextProposalId: 0, activeProposals: 0, totalVotingPower: 0n }
      }
    },
    enabled: !!provider,
  })

  const { data: treasurySummary } = useQuery({
    queryKey: ['governance-treasury-overview'],
    queryFn: async () => {
      if (!provider) return null
      try {
        const contract = getGovernanceTreasuryContract(provider)
        const state = (await contract.getTreasuryState()) as unknown as {
          treasuryToken: string
          treasuryWallet: string
          totalAllocated: bigint
          totalExecuted: bigint
        }
        const treasuryAddress = await contract.getAddress()
        const tokenAddress = state.treasuryToken

        let tokenSymbol = 'AGS'
        let decimals = 18
        let balance = 0n

        if (tokenAddress && tokenAddress !== ZERO_ADDRESS) {
          const tokenContract = getErc20Contract(tokenAddress, provider)
          try {
            tokenSymbol = await tokenContract.symbol()
          } catch {
            tokenSymbol = 'AGS'
          }
          try {
            decimals = Number(await tokenContract.decimals())
          } catch {
            decimals = 18
          }
          try {
            balance = await tokenContract.balanceOf(treasuryAddress)
          } catch {
            balance = 0n
          }
        }

        const committed = state.totalAllocated - state.totalExecuted

        return {
          tokenAddress,
          treasuryAddress,
          tokenSymbol,
          decimals,
          balance,
          totalAllocated: state.totalAllocated,
          totalExecuted: state.totalExecuted,
          committed: committed > 0n ? committed : 0n,
        }
      } catch (error) {
        console.error('Error fetching governance treasury overview:', error)
        return null
      }
    },
    enabled: !!provider && CONTRACT_ADDRESSES.GOVERNANCE_TREASURY !== ZERO_ADDRESS,
    staleTime: 60_000,
  })

  const { data: emergencySummary } = useQuery({
    queryKey: ['governance-emergency-overview'],
    queryFn: async () => {
      if (!provider) return null
      try {
        const contract = getGovernanceEmergencyContract(provider)
        const proposalCount = Number(await contract.emergencyProposalCount())
        const criticalThreshold = Number(await contract.CRITICAL_THRESHOLD())
        const economicThreshold = Number(await contract.ECONOMIC_THRESHOLD())
        const complianceThreshold = Number(await contract.COMPLIANCE_THRESHOLD())

        return {
          proposalCount,
          thresholds: {
            critical: criticalThreshold,
            economic: economicThreshold,
            compliance: complianceThreshold,
          },
        }
      } catch (error) {
        console.error('Error fetching emergency oversight stats:', error)
        return null
      }
    },
    enabled: !!provider && CONTRACT_ADDRESSES.GOVERNANCE_EMERGENCY !== ZERO_ADDRESS,
    staleTime: 60_000,
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-terminal-accent mb-2">Governance</h1>
          <p className="text-sm text-terminal-text-dim max-w-3xl">
            Read proposals, create new ones, cast shielded votes, delegate power, and queue or execute timelocked actions
            when a proposal passes.
          </p>
        </div>
      </div>

      <ModuleDeploymentNotice
        moduleName="Governance"
        contractAddress={CONTRACT_ADDRESSES.GOVERNANCE}
        envHint="VITE_GOVERNANCE_ADDRESS"
      />
      <ZkProverNotice moduleLabel="Private governance votes" />

      <ModuleConfiguredSection contractAddress={CONTRACT_ADDRESSES.GOVERNANCE}>
      {metrics && <GovernanceMetricsPanel metrics={metrics} />}

      {(treasurySummary || emergencySummary) && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {treasurySummary && (
            <section className="card space-y-4">
              <header>
                <h2 className="text-xl font-semibold text-terminal-text">Governance Treasury</h2>
                <p className="text-sm text-terminal-text-dim">
                  Token balance and allocations controlled by governance votes.
                </p>
              </header>
              <dl className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <dt className="text-terminal-text-dim">Token</dt>
                  <dd className="font-semibold text-terminal-text">
                    {treasurySummary.tokenSymbol} ({formatAddress(treasurySummary.tokenAddress)})
                  </dd>
                </div>
                <div>
                  <dt className="text-terminal-text-dim">Treasury Wallet</dt>
                  <dd className="font-semibold text-terminal-text">
                    {formatAddress(treasurySummary.treasuryAddress)}
                  </dd>
                </div>
                <div>
                  <dt className="text-terminal-text-dim">On-Chain Balance</dt>
                  <dd className="font-semibold text-terminal-accent">
                    {formatBalance(treasurySummary.balance, treasurySummary.decimals)}{' '}
                    {treasurySummary.tokenSymbol}
                  </dd>
                </div>
                <div>
                  <dt className="text-terminal-text-dim">Committed (Queued)</dt>
                  <dd className="font-semibold text-terminal-warning">
                    {formatBalance(treasurySummary.committed, treasurySummary.decimals)}{' '}
                    {treasurySummary.tokenSymbol}
                  </dd>
                </div>
                <div>
                  <dt className="text-terminal-text-dim">Total Allocated</dt>
                  <dd className="font-semibold text-terminal-text">
                    {formatBalance(treasurySummary.totalAllocated, treasurySummary.decimals)}{' '}
                    {treasurySummary.tokenSymbol}
                  </dd>
                </div>
                <div>
                  <dt className="text-terminal-text-dim">Total Executed</dt>
                  <dd className="font-semibold text-terminal-text">
                    {formatBalance(treasurySummary.totalExecuted, treasurySummary.decimals)}{' '}
                    {treasurySummary.tokenSymbol}
                  </dd>
                </div>
              </dl>
            </section>
          )}

          {emergencySummary && (
            <section className="card space-y-4">
              <header>
                <h2 className="text-xl font-semibold text-terminal-text">Emergency actions</h2>
                <p className="text-sm text-terminal-text-dim">
                  A separate path for urgent problems — broken proofs, market stress, or compliance risk. Takes more votes
                  than a normal proposal, and the same type cannot be triggered again until its cooldown ends.
                </p>
              </header>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="card bg-terminal-surface/60 border-terminal-border/60">
                  <p className="text-xs uppercase tracking-wide text-terminal-text-muted mb-1">
                    Filed
                  </p>
                  <p className="text-2xl font-semibold text-terminal-text">
                    {formatNumber(emergencySummary.proposalCount)}
                  </p>
                </div>
                <div className="card bg-terminal-surface/60 border-terminal-border/60">
                  <p className="text-xs uppercase tracking-wide text-terminal-text-muted mb-1">
                    Security cooldown
                  </p>
                  <p className="text-lg font-semibold text-terminal-text">
                    {formatDuration(emergencySummary.thresholds.critical)}
                  </p>
                  <p className="text-[11px] text-terminal-text-dim">After a proof or circuit emergency</p>
                </div>
                <div className="card bg-terminal-surface/60 border-terminal-border/60">
                  <p className="text-xs uppercase tracking-wide text-terminal-text-muted mb-1">
                    Market cooldown
                  </p>
                  <p className="text-lg font-semibold text-terminal-text">
                    {formatDuration(emergencySummary.thresholds.economic)}
                  </p>
                  <p className="text-[11px] text-terminal-text-dim">After liquidity or oracle emergencies</p>
                </div>
                <div className="card bg-terminal-surface/60 border-terminal-border/60">
                  <p className="text-xs uppercase tracking-wide text-terminal-text-muted mb-1">
                    Compliance cooldown
                  </p>
                  <p className="text-lg font-semibold text-terminal-text">
                    {formatDuration(emergencySummary.thresholds.compliance)}
                  </p>
                  <p className="text-[11px] text-terminal-text-dim">After regulatory or governance emergencies</p>
                </div>
              </div>
            </section>
          )}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2 border-terminal-border border-b">
        <button
          onClick={() => setActiveTab('proposals')}
          className={`px-4 py-2 font-medium transition-colors ${
            activeTab === 'proposals'
              ? 'text-terminal-accent border-b-2 border-terminal-accent'
              : 'text-terminal-text-dim hover:text-terminal-text'
          }`}
        >
          Proposals
        </button>
        <button
          onClick={() => setActiveTab('create')}
          className={`px-4 py-2 font-medium transition-colors ${
            activeTab === 'create'
              ? 'text-terminal-accent border-b-2 border-terminal-accent'
              : 'text-terminal-text-dim hover:text-terminal-text'
          }`}
        >
          Create Proposal
        </button>
        <button
          onClick={() => setActiveTab('private-vote')}
          className={`px-4 py-2 font-medium transition-colors ${
            activeTab === 'private-vote'
              ? 'text-terminal-accent border-b-2 border-terminal-accent'
              : 'text-terminal-text-dim hover:text-terminal-text'
          }`}
        >
          Private vote (ZK)
        </button>
        <button
          onClick={() => setActiveTab('delegate')}
          className={`px-4 py-2 font-medium transition-colors ${
            activeTab === 'delegate'
              ? 'text-terminal-accent border-b-2 border-terminal-accent'
              : 'text-terminal-text-dim hover:text-terminal-text'
          }`}
        >
          Delegate (ZK)
        </button>
      </div>

      {/* Content */}
      {activeTab === 'proposals' && <ProposalsList />}
      {activeTab === 'create' && <CreateProposal />}
      {activeTab === 'private-vote' && <PrivateVotePanel />}
      {activeTab === 'delegate' && <PrivateDelegationPanel />}
      </ModuleConfiguredSection>
    </div>
  )
}

type GovernanceMetrics = {
  nextProposalId: number
  activeProposals: number
  totalVotingPower: bigint
  votingPeriod?: bigint
  executionDelay?: bigint
  proposalThreshold?: bigint
  quorumThreshold?: bigint
  executionMajorityThreshold?: bigint
}

function GovernanceMetricsPanel({ metrics }: { metrics: GovernanceMetrics }) {
  const hasRules = metrics.votingPeriod !== undefined

  return (
    <section className="card border-terminal-border/60 bg-terminal-surface/60 p-0 overflow-hidden">
      <div className="px-6 py-4 border-b border-terminal-border/60">
        <h2 className="text-sm font-semibold text-terminal-text">At a glance</h2>
        <p className="text-xs text-terminal-text-dim mt-0.5">Live counts from the governance contract.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-terminal-border/60">
        <MetricCell
          label="Next proposal #"
          hint="ID assigned to the next submission"
          value={formatNumber(metrics.nextProposalId)}
        />
        <MetricCell
          label="Open now"
          hint="Proposals still accepting votes"
          value={formatNumber(metrics.activeProposals)}
          accent={metrics.activeProposals > 0}
        />
        <MetricCell
          label="Voting power"
          hint="Total weight tracked on-chain"
          value={formatBalance(metrics.totalVotingPower)}
          suffix="AGS"
        />
      </div>

      {hasRules && (
        <>
          <div className="px-6 py-4 border-t border-terminal-border/60 bg-terminal-bg/30">
            <h3 className="text-sm font-semibold text-terminal-text mb-1">How a proposal moves</h3>
            <p className="text-xs text-terminal-text-dim mb-4">
              Fixed on-chain timings — same for every proposal on this deployment.
            </p>
            <ol className="grid grid-cols-1 md:grid-cols-4 gap-3 text-sm">
              <TimelineStep step={1} title="Vote" detail={formatDuration(metrics.votingPeriod!)} />
              <TimelineStep step={2} title="Queue" detail="If it passes" />
              <TimelineStep
                step={3}
                title="Timelock"
                detail={formatDuration(metrics.executionDelay!)}
              />
              <TimelineStep step={4} title="Execute" detail="Changes go live" />
            </ol>
          </div>

          <div className="px-6 py-4 border-t border-terminal-border/60">
            <h3 className="text-sm font-semibold text-terminal-text mb-3">AGS bars to clear</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <ThresholdCell
                label="To submit"
                detail="Minimum stake to open a proposal"
                value={formatBalance(metrics.proposalThreshold!)}
              />
              <ThresholdCell
                label="Turnout floor"
                detail="Minimum total votes for a valid result"
                value={formatBalance(metrics.quorumThreshold!)}
              />
              <ThresholdCell
                label="Yes votes needed"
                detail="Minimum for votes to pass execution"
                value={formatBalance(metrics.executionMajorityThreshold!)}
              />
            </div>
          </div>
        </>
      )}
    </section>
  )
}

function MetricCell({
  label,
  hint,
  value,
  suffix,
  accent,
}: {
  label: string
  hint: string
  value: string
  suffix?: string
  accent?: boolean
}) {
  return (
    <div className="px-6 py-5 text-center sm:text-left">
      <p className="text-xs uppercase tracking-wide text-terminal-text-dim mb-1">{label}</p>
      <p
        className={`text-2xl font-bold tabular-nums ${
          accent ? 'text-terminal-accent' : 'text-terminal-text'
        }`}
      >
        {value}
        {suffix ? <span className="text-base font-semibold text-terminal-text-dim ml-1.5">{suffix}</span> : null}
      </p>
      <p className="text-xs text-terminal-text-dim mt-1">{hint}</p>
    </div>
  )
}

function TimelineStep({ step, title, detail }: { step: number; title: string; detail: string }) {
  return (
    <li className="flex items-start gap-3 rounded-lg border border-terminal-border/50 bg-terminal-surface/80 px-3 py-3">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-terminal-accent/15 text-xs font-bold text-terminal-accent">
        {step}
      </span>
      <div>
        <p className="font-medium text-terminal-text">{title}</p>
        <p className="text-xs text-terminal-text-dim mt-0.5">{detail}</p>
      </div>
    </li>
  )
}

function ThresholdCell({ label, detail, value }: { label: string; detail: string; value: string }) {
  return (
    <div className="rounded-lg border border-terminal-border/50 bg-terminal-bg/40 px-4 py-3">
      <p className="text-xs uppercase tracking-wide text-terminal-text-dim">{label}</p>
      <p className="text-xl font-bold text-terminal-accent tabular-nums mt-1">
        {value} <span className="text-sm font-semibold text-terminal-text-dim">AGS</span>
      </p>
      <p className="text-xs text-terminal-text-dim mt-1.5 leading-relaxed">{detail}</p>
    </div>
  )
}

function ProposalsList() {
  const { provider } = useWalletStore()
  
  const { data: proposals } = useQuery<Proposal[]>({
    queryKey: ['governance-proposals'],
    queryFn: async () => {
      if (!provider) return []
      try {
        const contract = getGovernanceContract(provider)
        const filter = contract.filters.ProposalCreated()
        const events = (await contract.queryFilter(filter)) as EventLog[]

        const proposalPromises = events.map(async (event) => {
          const proposalId = event.args?.[0]
          if (!proposalId) return null
          try {
            const proposal = await contract.getProposal(proposalId)
            const votes = await contract.getProposalVotes(proposalId)
            return {
              id: Number(proposalId),
              title: proposal[0] as string,
              description: proposal[1] as string,
              startTime: Number(proposal[5]),
              endTime: Number(proposal[6]),
              state: proposal[8],
              forVotes: votes[0] as bigint,
              againstVotes: votes[1] as bigint,
              abstainVotes: votes[2] as bigint,
              totalVotes: votes[3] as bigint,
              quorumReached: votes[4] as boolean,
            }
          } catch (error) {
            console.warn('Failed to fetch proposal detail', error)
            return null
          }
        })

        const results = await Promise.all(proposalPromises)
        return results.filter((proposal): proposal is Proposal => proposal !== null)
      } catch (error) {
        console.error('Error fetching proposals:', error)
        return []
      }
    },
    enabled: !!provider,
  })

  if (!proposals || proposals.length === 0) {
    return (
      <div className="card text-center py-12 space-y-2">
        <p className="text-terminal-text font-medium">No proposals yet</p>
        <p className="text-sm text-terminal-text-dim max-w-md mx-auto">
          When someone submits one on-chain, it shows up here with live vote counts.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-terminal-text-dim max-w-2xl leading-relaxed">
        Proposals pulled from the chain. For, against, and status update as voting happens.
      </p>
      {proposals.map((proposal) => (
        <ProposalCard key={proposal.id} proposal={proposal} />
      ))}
    </div>
  )
}

type Proposal = {
  id: number
  title: string
  description: string
  startTime: number
  endTime: number
  state: number | string
  forVotes: bigint
  againstVotes: bigint
  abstainVotes: bigint
  totalVotes: bigint
  quorumReached: boolean
}

const PROPOSAL_STATE_LABELS = [
  'Pending',
  'Active',
  'Canceled',
  'Defeated',
  'Succeeded',
  'Queued',
  'Expired',
  'Executed',
] as const

function proposalStateLabel(state: number | string): string {
  const n = typeof state === 'number' ? state : parseInt(String(state), 10)
  if (Number.isFinite(n) && n >= 0 && n < PROPOSAL_STATE_LABELS.length) {
    return PROPOSAL_STATE_LABELS[n]
  }
  return String(state)
}

function ProposalCard({ proposal }: { proposal: Proposal }) {
  const queryClient = useQueryClient()
  const { provider, signer, address } = useWalletStore()
  const [actionBusy, setActionBusy] = useState<'queue' | 'execute' | null>(null)

  const { data: liveState } = useQuery({
    queryKey: ['governance-proposal-state', proposal.id],
    queryFn: async () => {
      if (!provider) return null
      const contract = getGovernanceContract(provider)
      return Number(await contract.getProposalState(proposal.id))
    },
    enabled: !!provider,
    refetchInterval: 20_000,
  })

  const stateNum = liveState ?? (typeof proposal.state === 'number' ? proposal.state : parseInt(String(proposal.state), 10))
  const stateLabel = proposalStateLabel(stateNum)

  const handleQueue = async () => {
    if (!signer || !address || !provider) return toast.error('Connect wallet')
    setActionBusy('queue')
    try {
      toast.loading('Queueing proposal…', { id: 'gov-queue' })
      const contract = getGovernanceContract(signer)
      const tx = await contract.queueProposal(proposal.id)
      await waitAndParseTransaction(tx, address, provider)
      toast.success('Proposal queued', { id: 'gov-queue' })
      await queryClient.invalidateQueries({ queryKey: ['governance-proposals'] })
      await queryClient.invalidateQueries({ queryKey: ['governance-proposal-state', proposal.id] })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Queue failed', { id: 'gov-queue' })
    } finally {
      setActionBusy(null)
    }
  }

  const handleExecute = async () => {
    if (!signer || !address || !provider) return toast.error('Connect wallet')
    setActionBusy('execute')
    try {
      toast.loading('Executing proposal…', { id: 'gov-exec' })
      const contract = getGovernanceContract(signer)
      const tx = await contract.executeProposal(proposal.id)
      await waitAndParseTransaction(tx, address, provider)
      toast.success('Proposal executed', { id: 'gov-exec' })
      await queryClient.invalidateQueries({ queryKey: ['governance-proposals'] })
      await queryClient.invalidateQueries({ queryKey: ['governance-proposal-state', proposal.id] })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Execute failed', { id: 'gov-exec' })
    } finally {
      setActionBusy(null)
    }
  }

  return (
    <div className="card">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold text-terminal-text mb-1">
            #{proposal.id} · {proposal.title}
          </h3>
          <p className="text-sm text-terminal-text-dim">{proposal.description}</p>
        </div>
        <div className="text-xs text-terminal-text-dim">
          {formatDate(proposal.startTime)}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-4 text-sm mb-3">
        <div>
          <span className="text-terminal-text-dim">For: </span>
          <span className="text-terminal-accent">{formatBalance(proposal.forVotes)}</span>
        </div>
        <div>
          <span className="text-terminal-text-dim">Against: </span>
          <span className="text-terminal-error">{formatBalance(proposal.againstVotes)}</span>
        </div>
        <div>
          <span className="text-terminal-text-dim">Status: </span>
          <span className="text-terminal-warning">{stateLabel}</span>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {stateNum === 4 ? (
          <button
            type="button"
            className="btn-secondary btn-sm"
            disabled={actionBusy !== null}
            onClick={() => void handleQueue()}
          >
            {actionBusy === 'queue' ? 'Queueing…' : 'Queue proposal'}
          </button>
        ) : null}
        {stateNum === 5 ? (
          <button
            type="button"
            className="btn-primary btn-sm"
            disabled={actionBusy !== null}
            onClick={() => void handleExecute()}
          >
            {actionBusy === 'execute' ? 'Executing…' : 'Execute proposal'}
          </button>
        ) : null}
      </div>
    </div>
  )
}

function CreateProposal() {
  const queryClient = useQueryClient()
  const { signer, address, provider } = useWalletStore()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [targetsJson, setTargetsJson] = useState('[]')
  const [valuesJson, setValuesJson] = useState('[]')
  const [calldatasJson, setCalldatasJson] = useState('[]')
  const [proposerCommitment, setProposerCommitment] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async () => {
    try {
      checkRateLimit('critical')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Rate limit')
      return
    }
    if (!signer || !address || !provider) {
      toast.error('Connect wallet')
      return
    }
    if (!title.trim() || !description.trim()) {
      toast.error('Title and description are required')
      return
    }

    let targets: string[] = []
    let values: bigint[] = []
    let calldatas: string[] = []
    try {
      targets = JSON.parse(targetsJson || '[]') as string[]
      const vals = JSON.parse(valuesJson || '[]') as (string | number)[]
      values = vals.map((v) => BigInt(v))
      calldatas = JSON.parse(calldatasJson || '[]') as string[]
      if (!Array.isArray(targets) || !Array.isArray(values) || !Array.isArray(calldatas)) {
        throw new Error('Invalid JSON arrays')
      }
      if (targets.length !== values.length || targets.length !== calldatas.length) {
        throw new Error('targets, values, and calldatas must have the same length')
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Invalid action JSON')
      return
    }

    const commitment = parseBytes32(proposerCommitment) ?? randomBytes32Hex()
    const nullifier = randomBytes32Hex()
    const contract = getGovernanceContract(signer)
    if (!contract) {
      toast.error('Governance not configured')
      return
    }

    setSubmitting(true)
    try {
      toast.loading('Generating proposal proof…', { id: 'gov-create' })
      let zkProof: Uint8Array
      if (proverServiceUrl()) {
        const { proof } = await proveViaService('/governance/propose/prove', {
          title,
          description,
          proposerCommitment: commitment,
          nullifier,
        })
        zkProof = groth16ProofBigintsToBytes256(proof)
      } else {
        const { proof } = await proveGovernance({
          proposerCommitment: commitment,
          nullifier,
          action: 'propose',
          title,
        })
        zkProof = groth16ProofBigintsToBytes256(proof)
      }
      toast.loading('Submitting proposal…', { id: 'gov-create' })
      const tx = await contract.createProposal({
        title: title.trim(),
        description: description.trim(),
        targets,
        values,
        calldatas,
        proposerCommitment: commitment,
        nullifier,
        zkProof,
      })
      await waitAndParseTransaction(tx, address, provider)
      toast.success('Proposal created', { id: 'gov-create' })
      setTitle('')
      setDescription('')
      await queryClient.invalidateQueries({ queryKey: ['governance-proposals'] })
      await queryClient.invalidateQueries({ queryKey: ['governance-metrics'] })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Create failed', { id: 'gov-create' })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="card max-w-2xl space-y-4">
      <h2 className="text-xl font-semibold">Create proposal</h2>
      <p className="text-sm text-terminal-text-dim leading-relaxed">
        Opens a governance proposal with a zero-knowledge proof that you meet the on-chain proposer threshold. Leave
        action arrays empty for discussion-only proposals.
      </p>
      <div>
        <label className="block text-sm text-terminal-text-dim mb-1">Title</label>
        <input className="input-field w-full" value={title} onChange={(e) => setTitle(e.target.value)} disabled={submitting} />
      </div>
      <div>
        <label className="block text-sm text-terminal-text-dim mb-1">Description</label>
        <textarea
          className="input-field w-full min-h-[100px]"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          disabled={submitting}
        />
      </div>
      <div>
        <label className="block text-sm text-terminal-text-dim mb-1">Proposer commitment (optional 0x…)</label>
        <input
          className="input-field w-full font-mono text-xs"
          value={proposerCommitment}
          onChange={(e) => setProposerCommitment(e.target.value)}
          disabled={submitting}
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className="block text-sm text-terminal-text-dim mb-1">targets JSON</label>
          <textarea className="input-field w-full font-mono text-xs min-h-[80px]" value={targetsJson} onChange={(e) => setTargetsJson(e.target.value)} disabled={submitting} />
        </div>
        <div>
          <label className="block text-sm text-terminal-text-dim mb-1">values JSON</label>
          <textarea className="input-field w-full font-mono text-xs min-h-[80px]" value={valuesJson} onChange={(e) => setValuesJson(e.target.value)} disabled={submitting} />
        </div>
        <div>
          <label className="block text-sm text-terminal-text-dim mb-1">calldatas JSON</label>
          <textarea className="input-field w-full font-mono text-xs min-h-[80px]" value={calldatasJson} onChange={(e) => setCalldatasJson(e.target.value)} disabled={submitting} />
        </div>
      </div>
      <button type="button" className="btn-primary" disabled={submitting} onClick={() => void handleSubmit()}>
        {submitting ? 'Submitting…' : 'Create proposal (ZK)'}
      </button>
    </div>
  )
}

function parseBytes32(raw: string): `0x${string}` | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const body = trimmed.startsWith('0x') ? trimmed.slice(2) : trimmed
  if (!isValidHex(body, 32)) return null
  return (`0x${body.padStart(64, '0')}`) as `0x${string}`
}

function PrivateVotePanel() {
  const { signer, address, provider } = useWalletStore()
  const [proposalId, setProposalId] = useState('')
  const [voteType, setVoteType] = useState<'0' | '1' | '2'>('1')
  const [voterCommitment, setVoterCommitment] = useState('')
  const [votingPower, setVotingPower] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const tallyConfigured =
    CONTRACT_ADDRESSES.SHIELDED_GOVERNANCE_TALLY &&
    CONTRACT_ADDRESSES.SHIELDED_GOVERNANCE_TALLY !== ZERO_ADDRESS

  const handleVote = async () => {
    try {
      checkRateLimit('critical')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Rate limit')
      return
    }
    if (!signer || !address) {
      toast.error('Connect wallet')
      return
    }
    const pid = parseInt(proposalId, 10)
    if (!Number.isFinite(pid) || pid < 0) {
      toast.error('Invalid proposal id')
      return
    }
    const commitment = parseBytes32(voterCommitment)
    if (!commitment) {
      toast.error('Voter commitment must be 32-byte hex')
      return
    }
    const power = BigInt(votingPower || '0')
    if (power <= 0n) {
      toast.error('Voting power must be positive')
      return
    }
    const contract = getGovernanceContract(signer)
    const nullifier = '0x' + Buffer.from(randomBytes(32)).toString('hex')
    const voteTimestamp = BigInt(Math.floor(Date.now() / 1000))

    setSubmitting(true)
    try {
      toast.loading('Generating governance proof…', { id: 'gov-vote' })
      const { proof } = await proveGovernance({
        proposalId: pid.toString(),
        voterCommitment: commitment,
        votingPower: power.toString(),
        voteTimestamp: voteTimestamp.toString(),
        nullifier,
        voteType,
      })
      const zkProof = groth16ProofBigintsToBytes256(proof)
      toast.loading('Submitting private vote…', { id: 'gov-vote' })
      const tx = await contract.castVote(
        pid,
        parseInt(voteType, 10),
        commitment,
        power,
        voteTimestamp,
        nullifier,
        zkProof
      )
      await waitAndParseTransaction(tx, address, provider)
      toast.success('Vote submitted', { id: 'gov-vote' })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Vote failed. Check your inputs and try again.', {
        id: 'gov-vote',
      })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="card max-w-2xl space-y-4">
      <h2 className="text-xl font-semibold">Private vote (ZK)</h2>
      <p className="text-sm text-terminal-text-dim leading-relaxed">
        Cast For, Against, or Abstain without tying your choice to your public wallet. You prove you hold the weight
        in zero knowledge, then submit the vote on-chain.
      </p>
      {tallyConfigured ? (
        <p className="text-xs text-terminal-text-dim">
          This deployment can keep individual votes hidden until the proposal closes.
        </p>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="block text-sm text-terminal-text-dim mb-1">Proposal #</label>
          <input
            className="input-field w-full"
            value={proposalId}
            onChange={(e) => setProposalId(e.target.value)}
            disabled={submitting}
          />
        </div>
        <div>
          <label className="block text-sm text-terminal-text-dim mb-1">Vote</label>
          <select
            className="input-field w-full"
            value={voteType}
            onChange={(e) => setVoteType(e.target.value as '0' | '1' | '2')}
            disabled={submitting}
          >
            <option value="0">Against</option>
            <option value="1">For</option>
            <option value="2">Abstain</option>
          </select>
        </div>
      </div>
      <div>
        <label className="block text-sm text-terminal-text-dim mb-1">Your voter ID</label>
        <input
          className="input-field w-full font-mono text-xs"
          value={voterCommitment}
          onChange={(e) => setVoterCommitment(e.target.value)}
          placeholder="32-byte hex (0x…)"
          disabled={submitting}
        />
      </div>
      <div>
        <label className="block text-sm text-terminal-text-dim mb-1">Weight to cast</label>
        <input
          className="input-field w-full"
          value={votingPower}
          onChange={(e) => setVotingPower(e.target.value)}
          disabled={submitting}
        />
      </div>
      <button type="button" className="btn-primary" disabled={submitting} onClick={() => void handleVote()}>
        {submitting ? 'Submitting…' : 'Cast private vote'}
      </button>
    </div>
  )
}

function PrivateDelegationPanel() {
  const { signer, address, provider } = useWalletStore()
  const [delegatorCommitment, setDelegatorCommitment] = useState('')
  const [delegateCommitment, setDelegateCommitment] = useState('')
  const [delegatedPower, setDelegatedPower] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const handleDelegate = async () => {
    try {
      checkRateLimit('critical')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Rate limit')
      return
    }
    if (!signer || !address) {
      toast.error('Connect wallet')
      return
    }
    const from = parseBytes32(delegatorCommitment)
    const to = parseBytes32(delegateCommitment)
    if (!from || !to) {
      toast.error('Commitments must be 32-byte hex')
      return
    }
    const power = BigInt(delegatedPower || '0')
    if (power <= 0n) {
      toast.error('Delegated power must be positive')
      return
    }
    const contract = getGovernanceContract(signer)
    const nullifier = '0x' + Buffer.from(randomBytes(32)).toString('hex')

    setSubmitting(true)
    try {
      toast.loading('Generating delegation proof…', { id: 'gov-delegate' })
      const { proof } = await proveGovernance({
        delegatorCommitment: from,
        delegateCommitment: to,
        delegatedPower: power.toString(),
        nullifier,
        action: 'delegate',
      })
      const zkProof = groth16ProofBigintsToBytes256(proof)
      toast.loading('Submitting delegation…', { id: 'gov-delegate' })
      const tx = await contract.delegateVotingPower(from, to, power, nullifier, zkProof)
      await waitAndParseTransaction(tx, address, provider)
      toast.success('Delegation submitted', { id: 'gov-delegate' })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Delegation failed', { id: 'gov-delegate' })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="card max-w-2xl space-y-4">
      <h2 className="text-xl font-semibold">Delegate (ZK)</h2>
      <p className="text-sm text-terminal-text-dim leading-relaxed">
        Hand your voting weight to another private identity without tying it to your wallet on-chain. You sign with a
        zero-knowledge proof; only the commitments change hands, not your public address. To undo it, run revoke the
        same way with a new proof.
      </p>
      <div>
        <label className="block text-sm text-terminal-text-dim mb-1">Your commitment</label>
        <input
          className="input-field w-full font-mono text-xs"
          value={delegatorCommitment}
          onChange={(e) => setDelegatorCommitment(e.target.value)}
          placeholder="32-byte hex (0x…)"
          disabled={submitting}
        />
      </div>
      <div>
        <label className="block text-sm text-terminal-text-dim mb-1">Delegate&apos;s commitment</label>
        <input
          className="input-field w-full font-mono text-xs"
          value={delegateCommitment}
          onChange={(e) => setDelegateCommitment(e.target.value)}
          placeholder="32-byte hex (0x…)"
          disabled={submitting}
        />
      </div>
      <div>
        <label className="block text-sm text-terminal-text-dim mb-1">Weight to delegate</label>
        <input
          className="input-field w-full"
          value={delegatedPower}
          onChange={(e) => setDelegatedPower(e.target.value)}
          disabled={submitting}
        />
      </div>
      <button type="button" className="btn-primary" disabled={submitting} onClick={() => void handleDelegate()}>
        {submitting ? 'Submitting…' : 'Delegate voting power'}
      </button>
    </div>
  )
}


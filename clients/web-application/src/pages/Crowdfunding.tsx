import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { EventLog } from 'ethers'
import { ethers } from 'ethers'
import toast from 'react-hot-toast'

import { CONTRACT_ADDRESSES, DEFAULT_NETWORK } from '@/config/contracts'
import { useWalletStore } from '@/store/walletStore'
import { getCrowdfundingContract } from '@/utils/contracts'
import { formatBalance, formatDate, formatAddress } from '@/utils/format'
import { waitAndParseTransaction } from '@/utils/transactionHelper'
import DaoModuleNotice from '@/components/DaoModuleNotice'
import ModuleDeploymentNotice, { ModuleConfiguredSection } from '@/components/ModuleDeploymentNotice'
import ZkModeToggle, { type ZkPrivacyMode } from '@/components/ZkModeToggle'
import ZkProverNotice from '@/components/ZkProverNotice'
import CrowdfundingLifecycleActions from '@/components/products/CrowdfundingLifecycleActions'
import { proveCrowdfunding } from '@/utils/prover'

const NATIVE_SYMBOL = DEFAULT_NETWORK.nativeCurrency.symbol

type CrowdfundingStatus =
  | 'Active'
  | 'Successful'
  | 'Failed'
  | 'Withdrawn'
  | 'Disputed'
  | 'Refunding'

type SovereigntyConfig = {
  enablePrivateContributions: boolean
  enableMarketDrivenDisputes: boolean
  enableVoluntaryCompliance: boolean
  enableSpontaneousOrder: boolean
  minimumStakeForSovereignty: bigint
  minimumContribution: bigint
  maximumContribution: bigint
}

/** Public `contribute` path: empty proof (must be eight zeros on-chain). */
const ZERO_ZK_PROOF = [0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n] as const

type CrowdfundingCampaign = {
  id: number
  creator: string
  targetAmount: bigint
  deadline: number
  paymentToken: string
  totalRaised: bigint
  contributorCount: number
  status: CrowdfundingStatus
  isPrivate: boolean
  withdrawUnlocksAt: number
  config: SovereigntyConfig
}

type CrowdfundingStats = {
  totalRaised: bigint
  totalCampaigns: number
  activeCampaigns: number
  successfulCampaigns: number
}

/**
 * Matches `AegisCrowdShield.IndividualSovereigntyConfig` for this UI: public contributions, disputes on.
 * Per-campaign contribution bounds must satisfy `0 < min ≤ max ≤ target` on-chain.
 */
function defaultSovereigntyConfig(targetWei: bigint): SovereigntyConfig {
  return {
    enablePrivateContributions: false,
    enableMarketDrivenDisputes: true,
    enableVoluntaryCompliance: false,
    enableSpontaneousOrder: true,
    minimumStakeForSovereignty: 0n,
    minimumContribution: 1n,
    maximumContribution: targetWei,
  }
}

function mapStatus(status: number): CrowdfundingStatus {
  switch (status) {
    case 0:
      return 'Active'
    case 1:
      return 'Successful'
    case 2:
      return 'Failed'
    case 3:
      return 'Withdrawn'
    case 4:
      return 'Disputed'
    case 5:
      return 'Refunding'
    default:
      return 'Failed'
  }
}

function extractErrorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'shortMessage' in error) {
    return String((error as { shortMessage: string }).shortMessage)
  }
  if (error instanceof Error) return error.message
  return 'Transaction failed'
}

function parseCampaignCreatedArgs(event: EventLog): { campaignId: bigint } | null {
  const a = event.args
  if (a == null) return null
  const rec = a as unknown as Record<string, unknown>
  if (typeof rec.campaignId === 'bigint') {
    return { campaignId: rec.campaignId }
  }
  if (Array.isArray(a) && a.length > 0) {
    return { campaignId: BigInt(a[0].toString()) }
  }
  return null
}

export default function Crowdfunding() {
  const [activeTab, setActiveTab] = useState<'campaigns' | 'create'>('campaigns')
  const [mode, setMode] = useState<ZkPrivacyMode>('zk')

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <h1 className="text-3xl font-bold text-terminal-accent mb-2">Crowdfunding</h1>
        <p className="text-sm text-terminal-text-dim max-w-3xl">
          Public fundraising: set a funding goal and deadline, and let anyone contribute. Hit the goal and the creator
          receives the pool after a short on-chain waiting period. Miss it and backers can reclaim their money. Best for
          product launches, community projects, and open calls where many people might chip in.
        </p>
        <div className="border border-terminal-border rounded-lg p-4 text-sm max-w-3xl space-y-2">
          <div className="font-medium text-terminal-text">When to use this page</div>
          <p className="text-terminal-text-dim">
            Choose Crowdfunding when you want a <strong className="text-terminal-text">broad audience</strong>, one clear
            target, and backer protections baked in — refunds if the goal fails, and a dispute window after a successful
            raise.
          </p>
          <p className="text-terminal-text-dim">
            Closing a <strong className="text-terminal-text">small private round</strong> with staged payouts and a
            named milestone committee? Use{' '}
            <Link to="/staged-capital" className="text-terminal-accent underline">
              Staged capital
            </Link>{' '}
            instead.
          </p>
        </div>
        <DaoModuleNotice>
          <p>
            Campaigns run on <strong className="text-terminal-text">AegisCrowdShield</strong> rules: all-or-nothing
            targets and contributor refunds on failure. After success, the creator cannot withdraw until{' '}
            <strong className="text-terminal-text">max(now, deadline) + 14 days</strong> so backers can open a dispute
            while funds stay on-chain. Withdrawals pause while status is{' '}
            <strong className="text-terminal-text">Disputed</strong>. Unlike Staged capital, payouts are not gated by a
            private committee signing each milestone.
          </p>
        </DaoModuleNotice>
        <ModuleDeploymentNotice
          moduleName="Crowdfunding"
          contractAddress={CONTRACT_ADDRESSES.CROWDFUNDING}
          envHint="VITE_CROWDFUNDING_ADDRESS"
        />
        <ZkProverNotice moduleLabel="Private contributions" />
        <ZkModeToggle mode={mode} onChange={setMode} className="justify-start" zkOnly />
      </div>

      <ModuleConfiguredSection contractAddress={CONTRACT_ADDRESSES.CROWDFUNDING}>
      <div className="flex gap-2 border-terminal-border border-b">
        {(['campaigns', 'create'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 font-medium capitalize transition-colors ${
              activeTab === tab
                ? 'text-terminal-accent border-b-2 border-terminal-accent'
                : 'text-terminal-text-dim hover:text-terminal-text'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {activeTab === 'campaigns' && <CampaignsList mode={mode} />}
      {activeTab === 'create' && <CreateCampaign />}
      </ModuleConfiguredSection>
    </div>
  )
}

function CampaignsList({ mode }: { mode: ZkPrivacyMode }) {
  const { provider } = useWalletStore()

  const { data: campaigns } = useQuery({
    queryKey: ['crowdfunding-campaigns'],
    queryFn: async () => {
      if (!provider) return []
      try {
        const contract = getCrowdfundingContract(provider)
        const filter = contract.filters.CampaignCreated()
        const events = (await contract.queryFilter(filter)) as EventLog[]

        const campaignPromises = events.map(async (event) => {
          const parsed = parseCampaignCreatedArgs(event)
          if (!parsed) return null
          const campaignId = parsed.campaignId
          try {
            const raw = await contract.getCampaign(campaignId)
            const cfg = raw.config as SovereigntyConfig
            return {
              id: Number(campaignId),
              creator: String(raw.creator),
              targetAmount: BigInt(raw.targetAmount),
              deadline: Number(raw.deadline),
              paymentToken: String(raw.paymentToken),
              totalRaised: BigInt(raw.totalRaised),
              contributorCount: Number(raw.contributorCount),
              status: mapStatus(Number(raw.status)),
              isPrivate: Boolean(raw.isPrivate),
              withdrawUnlocksAt: Number(raw.withdrawUnlocksAt),
              config: {
                enablePrivateContributions: Boolean(cfg.enablePrivateContributions),
                enableMarketDrivenDisputes: Boolean(cfg.enableMarketDrivenDisputes),
                enableVoluntaryCompliance: Boolean(cfg.enableVoluntaryCompliance),
                enableSpontaneousOrder: Boolean(cfg.enableSpontaneousOrder),
                minimumStakeForSovereignty: BigInt(cfg.minimumStakeForSovereignty),
                minimumContribution:
                  cfg.minimumContribution !== undefined ? BigInt(cfg.minimumContribution) : 1n,
                maximumContribution:
                  cfg.maximumContribution !== undefined
                    ? BigInt(cfg.maximumContribution)
                    : BigInt(raw.targetAmount),
              },
            } satisfies CrowdfundingCampaign
          } catch (campaignError) {
            console.warn('Failed to read campaign', campaignError)
            return null
          }
        })

        const results = await Promise.all(campaignPromises)
        return results.filter((campaign): campaign is CrowdfundingCampaign => campaign !== null)
      } catch (error) {
        console.error('Error fetching campaigns:', error)
        return []
      }
    },
    enabled: !!provider,
    refetchInterval: 30000,
  })

  const { data: stats } = useQuery<CrowdfundingStats | null>({
    queryKey: ['crowdfunding-stats'],
    queryFn: async () => {
      if (!provider) return null
      try {
        const contract = getCrowdfundingContract(provider)
        const filter = contract.filters.CampaignCreated()
        const events = (await contract.queryFilter(filter)) as EventLog[]

        let totalRaised = 0n
        const totalCampaigns = events.length
        let activeCampaigns = 0
        let successfulCampaigns = 0

        for (const event of events) {
          try {
            const parsed = parseCampaignCreatedArgs(event)
            if (!parsed) continue
            const raw = await contract.getCampaign(parsed.campaignId)
            totalRaised += BigInt(raw.totalRaised)
            const status = Number(raw.status)
            if (status === 0) activeCampaigns++
            if (status === 1) successfulCampaigns++
          } catch (innerError) {
            console.warn('Error aggregating campaign stats', innerError)
          }
        }

        return {
          totalRaised,
          totalCampaigns,
          activeCampaigns,
          successfulCampaigns,
        }
      } catch {
        return null
      }
    },
    enabled: !!provider,
  })

  if (!campaigns || campaigns.length === 0) {
    return (
      <div className="space-y-6">
        {stats && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="card">
              <div className="text-sm text-terminal-text-dim mb-1">Total Raised</div>
              <div className="text-2xl font-bold text-terminal-accent">
                {formatBalance(stats.totalRaised)} {NATIVE_SYMBOL}
              </div>
            </div>
            <div className="card">
              <div className="text-sm text-terminal-text-dim mb-1">Total Campaigns</div>
              <div className="text-2xl font-bold text-terminal-text">{stats.totalCampaigns}</div>
            </div>
            <div className="card">
              <div className="text-sm text-terminal-text-dim mb-1">Active</div>
              <div className="text-2xl font-bold text-terminal-accent">{stats.activeCampaigns}</div>
            </div>
            <div className="card">
              <div className="text-sm text-terminal-text-dim mb-1">Successful</div>
              <div className="text-2xl font-bold text-terminal-text">{stats.successfulCampaigns}</div>
            </div>
          </div>
        )}
        <div className="card text-center py-12">
          <p className="text-terminal-text-dim">No campaigns found</p>
          <p className="text-sm text-terminal-text-dim mt-2">Create the first campaign to get started</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="card">
            <div className="text-sm text-terminal-text-dim mb-1">Total Raised</div>
            <div className="text-2xl font-bold text-terminal-accent">
              {formatBalance(stats.totalRaised)} {NATIVE_SYMBOL}
            </div>
          </div>
          <div className="card">
            <div className="text-sm text-terminal-text-dim mb-1">Total Campaigns</div>
            <div className="text-2xl font-bold text-terminal-text">{stats.totalCampaigns}</div>
          </div>
          <div className="card">
            <div className="text-sm text-terminal-text-dim mb-1">Active</div>
            <div className="text-2xl font-bold text-terminal-accent">{stats.activeCampaigns}</div>
          </div>
          <div className="card">
            <div className="text-sm text-terminal-text-dim mb-1">Successful</div>
            <div className="text-2xl font-bold text-terminal-text">{stats.successfulCampaigns}</div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {campaigns.map((campaign) => (
          <CampaignCard key={campaign.id} campaign={campaign} mode={mode} />
        ))}
      </div>
    </div>
  )
}

function creatorUnlockLabel(campaign: CrowdfundingCampaign): string | null {
  if (campaign.status !== 'Successful' && campaign.status !== 'Disputed') return null
  if (campaign.totalRaised === 0n) return null
  const unlockTs =
    campaign.withdrawUnlocksAt > 0
      ? campaign.withdrawUnlocksAt
      : campaign.deadline + 14 * 24 * 3600
  return formatDate(unlockTs * 1000)
}

function CampaignCard({ campaign, mode }: { campaign: CrowdfundingCampaign; mode: ZkPrivacyMode }) {
  const progress =
    campaign.targetAmount > 0n ? Number((campaign.totalRaised * 100n) / campaign.targetAmount) : 0
  const isActive = campaign.status === 'Active' && Date.now() / 1000 < campaign.deadline
  const isExpired = Date.now() / 1000 >= campaign.deadline
  const unlockLabel = creatorUnlockLabel(campaign)

  return (
    <div className="card hover:border-terminal-accent/50 transition-colors">
      <div className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <span
            className={`text-xs px-2 py-1 rounded ${
              isActive
                ? 'bg-terminal-accent/20 text-terminal-accent'
                : campaign.status === 'Successful'
                  ? 'bg-green-500/20 text-green-500'
                  : campaign.status === 'Disputed'
                    ? 'bg-amber-500/20 text-amber-500'
                    : 'bg-terminal-muted/20 text-terminal-text-dim'
            }`}
          >
            {isExpired && campaign.status === 'Active' ? 'Expired' : campaign.status}
          </span>
          <span className="text-xs text-terminal-text-dim">#{campaign.id}</span>
        </div>
        <div className="text-sm text-terminal-text-dim mb-1">by {formatAddress(campaign.creator)}</div>
        {campaign.config.enableMarketDrivenDisputes && (
          <div className="text-[11px] text-terminal-text-dim">Market disputes enabled</div>
        )}
      </div>

      <div className="mb-4">
        <div className="flex items-center justify-between text-sm mb-2">
          <span className="text-terminal-text-dim">Progress</span>
          <span className="font-semibold text-terminal-text">{progress}%</span>
        </div>
        <div className="w-full bg-terminal-muted/20 rounded-full h-2 mb-2">
          <div
            className="h-2 rounded-full transition-all bg-terminal-accent"
            style={{ width: `${Math.min(progress, 100)}%` }}
          />
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-terminal-text-dim">
            {formatBalance(campaign.totalRaised)} / {formatBalance(campaign.targetAmount)}
          </span>
          <span className="text-terminal-text-dim">{campaign.contributorCount} contributors</span>
        </div>
      </div>

      <div className="text-xs text-terminal-text-dim mb-2">
        Deadline: {formatDate(campaign.deadline * 1000)}
      </div>
      {unlockLabel && (
        <div className="text-[11px] text-terminal-text-dim mb-3 border border-terminal-border/60 rounded p-2">
          Creator can withdraw on-chain after: <span className="text-terminal-text">{unlockLabel}</span>
          {campaign.status === 'Disputed' && (
            <span className="block mt-1 text-amber-500/90">Withdrawal is paused until the dispute is resolved.</span>
          )}
        </div>
      )}

      <button className="btn-primary w-full" disabled={!isActive}>
        {isActive ? 'Contribute' : 'View details'}
      </button>

      {isActive && (
        <ContributePanel
          campaignId={campaign.id}
          allowPrivate={campaign.config.enablePrivateContributions}
          mode={mode}
        />
      )}

      <CrowdfundingLifecycleActions campaign={campaign} />
    </div>
  )
}

function CreateCampaign() {
  const queryClient = useQueryClient()
  const { provider, isConnected, address } = useWalletStore()
  const [targetAmount, setTargetAmount] = useState('')
  const [duration, setDuration] = useState('14')
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!provider || !address) {
      toast.error('Connect your wallet')
      return
    }
    setBusy(true)
    const id = toast.loading('Creating campaign…')
    try {
      const signer = await provider.getSigner()
      const contract = getCrowdfundingContract(signer)
      const minDur = await contract.MINIMUM_CAMPAIGN_DURATION()
      const days = parseFloat(duration || '0')
      if (!Number.isFinite(days) || days <= 0) {
        toast.error('Enter a valid duration in days', { id })
        return
      }
      const durationSec = BigInt(Math.ceil(days * 86400))
      if (durationSec < BigInt(minDur.toString())) {
        toast.error(`Duration must be at least ${Number(minDur) / 86400} days`, { id })
        return
      }
      const targetWei = ethers.parseEther(targetAmount || '0')
      if (targetWei <= 0n) {
        toast.error('Enter a positive target amount', { id })
        return
      }
      const commitmentHash = ethers.keccak256(
        ethers.toUtf8Bytes(`aegis:campaign:${address}:${Date.now()}:${targetWei.toString()}`)
      )
      const sov = defaultSovereigntyConfig(targetWei)
      const tx = await contract.createCampaign(
        targetWei,
        durationSec,
        ethers.ZeroAddress,
        commitmentHash,
        false,
        sov
      )
      await waitAndParseTransaction(tx, address, provider)
      await queryClient.invalidateQueries({ queryKey: ['crowdfunding-campaigns'] })
      await queryClient.invalidateQueries({ queryKey: ['crowdfunding-stats'] })
      toast.success('Campaign created', { id })
      setTargetAmount('')
      setDuration('14')
    } catch (err) {
      toast.error(extractErrorMessage(err), { id })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card max-w-md">
      <h2 className="text-xl font-semibold mb-4">Create campaign</h2>
      <p className="text-sm text-terminal-text-dim mb-6">
        Creates a campaign on <code className="text-terminal-accent">AegisCrowdShield</code> with public
        contributions and market disputes enabled. Target is in native token ({NATIVE_SYMBOL} on Sonic).
      </p>
      <form className="space-y-4" onSubmit={onSubmit}>
        <div>
          <label className="block text-sm font-medium text-terminal-text-dim mb-2">Target amount (native)</label>
          <input
            type="number"
            step="0.0001"
            min="0"
            value={targetAmount}
            onChange={(e) => setTargetAmount(e.target.value)}
            className="input-field w-full"
            placeholder="0.0"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-terminal-text-dim mb-2">Duration (days)</label>
          <input
            type="number"
            min="7"
            step="1"
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
            className="input-field w-full"
            placeholder="14"
          />
          <p className="text-xs text-terminal-text-dim mt-1">On-chain minimum is 7 days.</p>
        </div>
        <button type="submit" className="btn-primary w-full" disabled={!isConnected || busy}>
          {busy ? 'Submitting…' : 'Create campaign'}
        </button>
        {!isConnected && (
          <p className="text-xs text-terminal-text-dim text-center">Connect wallet to create a campaign</p>
        )}
      </form>
    </div>
  )
}

function ContributePanel({
  campaignId,
  allowPrivate,
  mode,
}: {
  campaignId: number
  allowPrivate: boolean
  mode: ZkPrivacyMode
}) {
  const { provider, isConnected, address } = useWalletStore()
  const queryClient = useQueryClient()
  const [amount, setAmount] = useState('')
  const [busy, setBusy] = useState(false)

  async function contributePublic() {
    if (!provider || !address) return
    setBusy(true)
    const id = toast.loading('Submitting contribution…')
    try {
      const signer = await provider.getSigner()
      const contract = getCrowdfundingContract(signer)
      const wei = ethers.parseEther(amount || '0')
      if (wei <= 0n) throw new Error('Enter amount')
      const tx = await contract.contribute(campaignId, wei, ethers.ZeroHash, [...ZERO_ZK_PROOF], [], {
        value: wei,
      })
      await waitAndParseTransaction(tx, address, provider)
      await queryClient.invalidateQueries({ queryKey: ['crowdfunding-campaigns'] })
      await queryClient.invalidateQueries({ queryKey: ['crowdfunding-stats'] })
      toast.success('Contributed', { id })
      setAmount('')
    } catch (err) {
      toast.error(extractErrorMessage(err), { id })
    } finally {
      setBusy(false)
    }
  }

  async function contributePrivateZk() {
    if (!provider || !address) return
    if (!allowPrivate) {
      toast.error('This campaign does not allow private contributions')
      return
    }
    setBusy(true)
    const id = toast.loading('Generating crowdfunding proof…')
    try {
      const signer = await provider.getSigner()
      const contract = getCrowdfundingContract(signer)
      const wei = ethers.parseEther(amount || '0')
      if (wei <= 0n) throw new Error('Enter amount')
      const contributorCommitment = ethers.id(`crowd-${campaignId}-${address}-${Date.now()}`)
      const { proof, publicInputs } = await proveCrowdfunding({
        campaignId: campaignId.toString(),
        amount: wei.toString(),
        contributorCommitment,
      })
      toast.loading('Submitting private contribution…', { id })
      const tx = await contract.contribute(campaignId, wei, contributorCommitment, proof, publicInputs, {
        value: wei,
      })
      await waitAndParseTransaction(tx, address, provider)
      await queryClient.invalidateQueries({ queryKey: ['crowdfunding-campaigns'] })
      toast.success('Private contribution submitted', { id })
      setAmount('')
    } catch (err) {
      toast.error(extractErrorMessage(err), { id })
    } finally {
      setBusy(false)
    }
  }

  async function handleContribute() {
    if (mode === 'zk' && allowPrivate) {
      await contributePrivateZk()
    } else {
      await contributePublic()
    }
  }

  if (!isConnected) return null

  const zkActive = mode === 'zk' && allowPrivate

  return (
    <div className="mt-3 space-y-2">
      <div className="flex items-center gap-2">
        <input
          type="number"
          min="0"
          step="0.001"
          className="input-field flex-1"
          placeholder="Amount (native)"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <button type="button" className="btn-secondary" onClick={() => void handleContribute()} disabled={busy || !amount}>
          {busy ? '…' : zkActive ? 'Contribute (ZK)' : 'Contribute'}
        </button>
      </div>
      <p className="text-[11px] text-terminal-text-dim">
        {zkActive
          ? 'ZK path: Groth16 proof via `crowdfunding` circuit — requires local wasm/zkey or prover service.'
          : 'Public path: zero nullifier, zero proof — explorers see the contribution.'}
      </p>
    </div>
  )
}

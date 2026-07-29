import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ethers } from 'ethers'
import type { EventLog } from 'ethers'
import toast from 'react-hot-toast'

import { DEFAULT_NETWORK } from '@/config/contracts'
import { useWalletStore } from '@/store/walletStore'
import { getCrowdfundingContract } from '@/utils/contracts'
import { formatBalance } from '@/utils/format'
import { waitAndParseTransaction } from '@/utils/transactionHelper'

const NATIVE_SYMBOL = DEFAULT_NETWORK.nativeCurrency.symbol

type CampaignLite = {
  id: number
  creator: string
  status: string
  deadline: number
  targetAmount: bigint
  totalRaised: bigint
  withdrawUnlocksAt: number
  config: { enableMarketDrivenDisputes: boolean }
}

function extractError(error: unknown): string {
  if (error && typeof error === 'object' && 'shortMessage' in error) {
    return String((error as { shortMessage: string }).shortMessage)
  }
  if (error instanceof Error) return error.message
  return 'Transaction failed'
}

export default function CrowdfundingLifecycleActions({
  campaign,
  onSuccess,
}: {
  campaign: CampaignLite
  onSuccess?: () => void
}) {
  const queryClient = useQueryClient()
  const { provider, signer, address, isConnected } = useWalletStore()
  const [evidenceHex, setEvidenceHex] = useState('')
  const [disputeIdInput, setDisputeIdInput] = useState('')
  const [voteSupport, setVoteSupport] = useState<'true' | 'false'>('true')
  const [busy, setBusy] = useState<string | null>(null)

  const nowSec = Math.floor(Date.now() / 1000)
  const isCreator = Boolean(address && campaign.creator.toLowerCase() === address.toLowerCase())
  const unlockTs =
    campaign.withdrawUnlocksAt > 0
      ? campaign.withdrawUnlocksAt
      : campaign.deadline + 14 * 24 * 3600
  const pastDeadline = nowSec >= campaign.deadline
  const goalMet = campaign.totalRaised >= campaign.targetAmount && campaign.targetAmount > 0n
  const canWithdraw =
    isCreator &&
    campaign.status !== 'Disputed' &&
    campaign.status !== 'Withdrawn' &&
    nowSec >= unlockTs &&
    (campaign.status === 'Successful' || (pastDeadline && goalMet))

  const canRefund =
    campaign.status === 'Failed' ||
    campaign.status === 'Refunding' ||
    (pastDeadline && !goalMet && campaign.status === 'Active')

  const { data: contribution } = useQuery({
    queryKey: ['crowdfunding-contribution', campaign.id, address],
    queryFn: async () => {
      if (!provider || !address) return null
      const c = getCrowdfundingContract(provider)
      const raw = await c.contributions(campaign.id, address)
      return {
        amount: BigInt(raw.amount ?? raw[0] ?? 0),
        hasVotingRights: Boolean(raw.hasVotingRights ?? raw[4]),
      }
    },
    enabled: Boolean(provider && address),
  })

  const { data: minStake } = useQuery({
    queryKey: ['crowdfunding-min-dispute-stake'],
    queryFn: async () => {
      if (!provider) return ethers.parseEther('0.1')
      const c = getCrowdfundingContract(provider)
      return BigInt(await c.MINIMUM_DISPUTE_STAKE())
    },
    enabled: Boolean(provider),
    staleTime: 60_000,
  })

  const { data: campaignDisputeId } = useQuery({
    queryKey: ['crowdfunding-campaign-dispute', campaign.id],
    queryFn: async () => {
      if (!provider) return null
      const c = getCrowdfundingContract(provider)
      const filter = c.filters.DisputeInitiated(undefined, campaign.id)
      const events = (await c.queryFilter(filter)) as EventLog[]
      if (events.length === 0) return null
      const last = events[events.length - 1]
      const id = last.args?.disputeId ?? last.args?.[0]
      return id != null ? Number(id) : null
    },
    enabled: Boolean(provider),
  })

  const effectiveDisputeId =
    disputeIdInput.trim() !== ''
      ? parseInt(disputeIdInput, 10)
      : campaignDisputeId ?? null

  async function runAction(label: string, fn: () => Promise<void>) {
    if (!signer || !address || !provider) {
      toast.error('Connect your wallet')
      return
    }
    setBusy(label)
    const toastId = toast.loading(`${label}…`)
    try {
      await fn()
      toast.success(`${label} submitted`, { id: toastId })
      await queryClient.invalidateQueries({ queryKey: ['crowdfunding-campaigns'] })
      await queryClient.invalidateQueries({ queryKey: ['crowdfunding-stats'] })
      await queryClient.invalidateQueries({ queryKey: ['crowdfunding-contribution', campaign.id] })
      await queryClient.invalidateQueries({ queryKey: ['crowdfunding-campaign-dispute', campaign.id] })
      onSuccess?.()
    } catch (err) {
      toast.error(extractError(err), { id: toastId })
    } finally {
      setBusy(null)
    }
  }

  const handleWithdraw = () =>
    void runAction('Withdraw funds', async () => {
      const c = getCrowdfundingContract(signer!)
      const tx = await c.withdrawFunds(campaign.id)
      await waitAndParseTransaction(tx, address!, provider!)
    })

  const handleRefund = () =>
    void runAction('Request refund', async () => {
      const c = getCrowdfundingContract(signer!)
      const tx = await c.requestRefund(campaign.id)
      await waitAndParseTransaction(tx, address!, provider!)
    })

  const handleInitiateDispute = () =>
    void runAction('Initiate dispute', async () => {
      const stake = minStake ?? ethers.parseEther('0.1')
      let evidence: string
      try {
        evidence = ethers.isHexString(evidenceHex.trim(), 32)
          ? evidenceHex.trim()
          : ethers.keccak256(ethers.toUtf8Bytes(evidenceHex.trim() || `dispute-${campaign.id}`))
      } catch {
        throw new Error('Evidence must be 32-byte hex or text (hashed)')
      }
      const c = getCrowdfundingContract(signer!)
      const tx = await c.initiateDispute(campaign.id, evidence, { value: stake })
      await waitAndParseTransaction(tx, address!, provider!)
      setEvidenceHex('')
    })

  const handleVoteDispute = () =>
    void runAction('Vote on dispute', async () => {
      if (effectiveDisputeId == null || !Number.isFinite(effectiveDisputeId)) {
        throw new Error('Enter a valid dispute id')
      }
      const c = getCrowdfundingContract(signer!)
      const tx = await c.voteOnDispute(effectiveDisputeId, voteSupport === 'true')
      await waitAndParseTransaction(tx, address!, provider!)
    })

  const handleResolveDispute = () =>
    void runAction('Resolve dispute', async () => {
      if (effectiveDisputeId == null || !Number.isFinite(effectiveDisputeId)) {
        throw new Error('Enter a valid dispute id')
      }
      const c = getCrowdfundingContract(signer!)
      const tx = await c.resolveDispute(effectiveDisputeId)
      await waitAndParseTransaction(tx, address!, provider!)
    })

  if (!isConnected) return null

  const contributed = contribution?.amount ?? 0n
  const showDispute =
    campaign.config.enableMarketDrivenDisputes &&
    contributed > 0n &&
    (campaign.status === 'Successful' || campaign.status === 'Disputed')

  return (
    <div className="mt-3 pt-3 border-t border-terminal-border/50 space-y-3">
      <div className="text-xs font-semibold text-terminal-text">Campaign actions</div>
      {contributed > 0n ? (
        <p className="text-[11px] text-terminal-text-dim">
          Your contribution: {formatBalance(contributed)} {NATIVE_SYMBOL}
        </p>
      ) : null}

      {canWithdraw ? (
        <button
          type="button"
          className="btn-primary w-full btn-sm"
          disabled={busy !== null}
          onClick={handleWithdraw}
        >
          {busy === 'Withdraw funds' ? 'Withdrawing…' : 'Withdraw funds (creator)'}
        </button>
      ) : null}

      {canRefund && contributed > 0n ? (
        <button
          type="button"
          className="btn-secondary w-full btn-sm"
          disabled={busy !== null}
          onClick={handleRefund}
        >
          {busy === 'Request refund' ? 'Submitting…' : 'Request refund'}
        </button>
      ) : null}

      {showDispute ? (
        <div className="space-y-2 rounded border border-terminal-border/40 p-2">
          <p className="text-[11px] text-terminal-text-dim">
            Dispute stake: {formatBalance(minStake ?? 0n)} {NATIVE_SYMBOL}
          </p>
          <input
            className="input-field w-full text-xs"
            placeholder="Evidence (text or 0x…32 bytes)"
            value={evidenceHex}
            onChange={(e) => setEvidenceHex(e.target.value)}
            disabled={busy !== null || campaign.status === 'Disputed'}
          />
          <button
            type="button"
            className="btn-secondary w-full btn-sm"
            disabled={busy !== null || campaign.status === 'Disputed'}
            onClick={handleInitiateDispute}
          >
            {busy === 'Initiate dispute' ? 'Submitting…' : 'Initiate dispute'}
          </button>

          <div className="flex gap-2 items-center">
            <input
              className="input-field flex-1 text-xs"
              placeholder={campaignDisputeId != null ? `Dispute #${campaignDisputeId}` : 'Dispute id'}
              value={disputeIdInput}
              onChange={(e) => setDisputeIdInput(e.target.value)}
              disabled={busy !== null}
            />
            <select
              className="input-field text-xs"
              value={voteSupport}
              onChange={(e) => setVoteSupport(e.target.value as 'true' | 'false')}
              disabled={busy !== null}
            >
              <option value="true">Support</option>
              <option value="false">Oppose</option>
            </select>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              className="btn-secondary flex-1 btn-sm"
              disabled={busy !== null}
              onClick={handleVoteDispute}
            >
              Vote
            </button>
            <button
              type="button"
              className="btn-secondary flex-1 btn-sm"
              disabled={busy !== null}
              onClick={handleResolveDispute}
            >
              Resolve
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { parseEther, randomBytes } from 'ethers'

import { useWalletStore } from '@/store/walletStore'
import { getStakingContract } from '@/utils/contracts'
import { formatBalance } from '@/utils/format'
import {
  effectiveStakingApyPercent,
  formatStakingApy,
  nominalStakingApyPercent,
  stakingGovernanceLinked,
  stakingYieldStatus,
  type StakingPoolSnapshot,
} from '@/utils/stakingMetrics'
import { proveStaking, proveReward } from '@/utils/prover'
import { validateAmount, detectAttackPattern, isValidHex, checkRateLimit } from '@/utils/security'
import { waitAndParseTransaction } from '@/utils/transactionHelper'
import { submitViaRelayer } from '@/utils/submitViaRelayer'
import { getStakingPositions, saveStakingPosition } from '@/utils/commitmentStorage'
import ModuleDeploymentNotice, { ModuleConfiguredSection } from '@/components/ModuleDeploymentNotice'
import ZkProverNotice from '@/components/ZkProverNotice'
import ZkModeToggle from '@/components/ZkModeToggle'
import { CONTRACT_ADDRESSES } from '@/config/contracts'

export default function Staking() {
  const [activeTab, setActiveTab] = useState<'stake' | 'unstake' | 'rewards'>('stake')
  const [mode, setMode] = useState<'legacy' | 'zk'>('zk')

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <h1 className="text-3xl font-bold text-terminal-accent mb-2">Staking</h1>
        <div className="rounded-lg border border-terminal-border/50 bg-terminal-bg px-4 py-3 text-sm text-terminal-text-dim leading-relaxed space-y-2">
          <p>
            Rewards come from an on-chain <strong className="text-terminal-text">reward pool</strong> — not newly
            minted tokens. When the pool is empty, nothing is paid out. When governance funds a new season, effective
            yield depends on how much is staked.
          </p>
          <p>
            Minimum stake is <strong className="text-terminal-text">100 AGS</strong>. Use private (ZK) mode; rewards
            are claimed separately after your stake is active.
          </p>
        </div>
        <ModuleDeploymentNotice
          moduleName="Staking"
          contractAddress={CONTRACT_ADDRESSES.STAKING}
          envHint="VITE_STAKING_ADDRESS"
        />
        <ZkProverNotice moduleLabel="Staking" />
        <ZkModeToggle mode={mode} onChange={setMode} zkOnly />
      </div>

      <ModuleConfiguredSection contractAddress={CONTRACT_ADDRESSES.STAKING}>
      {/* Stats */}
      <StakingStats />

      {/* Tabs */}
      <div className="flex gap-2 border-terminal-border border-b">
        {(['stake', 'unstake', 'rewards'] as const).map((tab) => (
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

      {/* Content */}
      {activeTab === 'stake' && <StakeForm mode={mode} />}
      {activeTab === 'unstake' && <UnstakeForm mode={mode} />}
      {activeTab === 'rewards' && <RewardsSection mode={mode} />}
      </ModuleConfiguredSection>
    </div>
  )
}

function StakingStats() {
  const { provider } = useWalletStore()

  const { data: snapshot } = useQuery({
    queryKey: ['staking-snapshot'],
    queryFn: async (): Promise<StakingPoolSnapshot & { epoch: number; epochEnd: number } | null> => {
      if (!provider) return null
      try {
        const contract = getStakingContract(provider)
        const [epochInfo, state, rewardRate, epochDuration, minStake, governance, timelock, paused] =
          await Promise.all([
            contract.getCurrentEpochInfo(),
            contract.stakingState(),
            contract.rewardRate(),
            contract.epochDuration(),
            contract.MIN_STAKE_AMOUNT(),
            contract.governanceContract(),
            contract.timelockController(),
            contract.paused(),
          ])

        return {
          epoch: Number(epochInfo[0]),
          epochEnd: Number(epochInfo[2]),
          rewardRateBpsPerEpoch: BigInt(rewardRate),
          epochDurationSec: BigInt(epochDuration),
          rewardPool: BigInt(state.rewardPool || 0),
          totalStaked: BigInt(state.totalStakedAmount || 0),
          minStakeAmount: BigInt(minStake),
          governanceAddress: String(governance),
          timelockAddress: String(timelock),
          paused: Boolean(paused),
        }
      } catch (error) {
        console.error('Error fetching staking snapshot:', error)
        return null
      }
    },
    enabled: !!provider,
    refetchInterval: 30_000,
  })

  const yieldStatus = snapshot
    ? stakingYieldStatus(snapshot.rewardPool, snapshot.totalStaked, snapshot.paused)
    : 'no_pool'
  const nominalApy = snapshot
    ? nominalStakingApyPercent(snapshot.rewardRateBpsPerEpoch, snapshot.epochDurationSec)
    : 0
  const effectiveApy = snapshot
    ? effectiveStakingApyPercent(
        snapshot.rewardRateBpsPerEpoch,
        snapshot.epochDurationSec,
        snapshot.rewardPool,
        snapshot.totalStaked
      )
    : null
  const govLinked = snapshot ? stakingGovernanceLinked(snapshot) : false

  const statusCopy: Record<ReturnType<typeof stakingYieldStatus>, string> = {
    paused: 'Staking is paused — no new rewards accrue.',
    no_pool: 'Reward pool is empty — governance must fund a season before anyone earns.',
    no_stake: 'Pool is funded but nothing is staked yet — APY applies once stake exists.',
    earning: 'Pool and stake are live — rate below reflects current pool size.',
  }

  return (
    <section className="card border-terminal-border/60 bg-terminal-surface/60 p-0 overflow-hidden">
      <div className="px-6 py-4 border-b border-terminal-border/60">
        <h2 className="text-sm font-semibold text-terminal-text">Pool status</h2>
        <p className="text-xs text-terminal-text-dim mt-1 leading-relaxed">{statusCopy[yieldStatus]}</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 lg:divide-x divide-terminal-border/60">
        <StatCell label="Epoch" value={String(snapshot?.epoch ?? 0)} hint="Current 7-day window" />
        <StatCell
          label="Total staked"
          value={`${snapshot ? formatBalance(snapshot.totalStaked) : '0'} AGS`}
          hint="All active stake"
        />
        <StatCell
          label="Reward pool"
          value={`${snapshot ? formatBalance(snapshot.rewardPool) : '0'} AGS`}
          hint="Unclaimed season budget"
          accent={snapshot ? snapshot.rewardPool > 0n : false}
        />
        <StatCell
          label="Effective APY"
          value={formatStakingApy(effectiveApy)}
          hint={
            effectiveApy === null
              ? `Max ~${nominalApy.toFixed(2)}% if pool fully funds the year`
              : `Max ~${nominalApy.toFixed(2)}% when pool is full`
          }
          accent={effectiveApy !== null && effectiveApy > 0}
        />
      </div>

      <div className="px-6 py-3 border-t border-terminal-border/60 bg-terminal-bg/30 flex flex-wrap gap-x-6 gap-y-1 text-xs text-terminal-text-dim">
        <span>Min stake: {snapshot ? formatBalance(snapshot.minStakeAmount) : '100'} AGS</span>
        <span>Governance linked: {govLinked ? 'Yes' : 'Not yet'}</span>
        {snapshot?.paused ? <span className="text-terminal-warning">Paused</span> : null}
      </div>
    </section>
  )
}

function StatCell({
  label,
  value,
  hint,
  accent,
}: {
  label: string
  value: string
  hint: string
  accent?: boolean
}) {
  return (
    <div className="px-6 py-5">
      <p className="text-xs uppercase tracking-wide text-terminal-text-dim mb-1">{label}</p>
      <p
        className={`text-2xl font-bold tabular-nums ${
          accent ? 'text-terminal-accent' : 'text-terminal-text'
        }`}
      >
        {value}
      </p>
      <p className="text-xs text-terminal-text-dim mt-1">{hint}</p>
    </div>
  )
}

interface StakeFormProps {
  mode: 'legacy' | 'zk'
}

function StakeForm({ mode }: StakeFormProps) {
  const { address, isConnected, provider, signer } = useWalletStore()
  const [amount, setAmount] = useState('')
  const [staking, setStaking] = useState(false)
  const proverUrl = import.meta.env.VITE_PROVER_URL as string | undefined

  const { data: minStake } = useQuery({
    queryKey: ['staking-min-amount'],
    queryFn: async () => {
      if (!provider) return parseEther('100')
      try {
        const contract = getStakingContract(provider)
        return BigInt(await contract.MIN_STAKE_AMOUNT())
      } catch {
        return parseEther('100')
      }
    },
    enabled: !!provider,
    staleTime: 60_000,
  })

  async function handleStake() {
    // Security checks
    try {
      checkRateLimit('api')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Rate limit exceeded. Please wait before trying again.')
      return
    }

    if (!isConnected || !address || !provider || !signer) {
      toast.error('Connect your wallet first')
      return
    }

    // Input validation
    const amountValidation = validateAmount(amount)
    if (!amountValidation.valid) {
      toast.error(amountValidation.error || 'Invalid amount')
      return
    }

    // Attack pattern detection
    if (detectAttackPattern(amount)) {
      toast.error('Invalid input detected')
      return
    }

    setStaking(true)
    try {
      const contract = getStakingContract(signer)
      const amountWei = parseEther(amount)

      const min = minStake ?? parseEther('100')
      if (amountWei < min) {
        toast.error(`Minimum stake is ${formatBalance(min)} AGS`)
        return
      }

      toast.loading('Processing stake...', { id: 'stake' })

      if (mode === 'legacy') {
        toast.error('Legacy staking not available. Please use ZK mode.')
        return
      }

      let proof: bigint[]
      let publicInputs: bigint[]
      let storedNullifier = ''
      let storedCommitment = ''

      if (proverUrl) {
        const res = await fetch(`${proverUrl}/staking/prove`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            amount: amountWei.toString(),
            recipient: address,
          }),
        })
        if (!res.ok) throw new Error('Proof service error')
        const data = await res.json()
        proof = (data.proof ?? []).map((x: string) => BigInt(x))
        publicInputs = (data.publicInputs ?? []).map((x: string) => BigInt(x))
        if (data.nullifier) storedNullifier = String(data.nullifier)
        if (data.commitment) storedCommitment = String(data.commitment)
      } else {
        try {
          const nullifierBytes = randomBytes(32)
          const commitmentBytes = randomBytes(32)
          const nullifier = BigInt('0x' + Buffer.from(nullifierBytes).toString('hex'))
          const commitment = BigInt('0x' + Buffer.from(commitmentBytes).toString('hex'))
          storedNullifier = '0x' + Buffer.from(nullifierBytes).toString('hex')
          storedCommitment = '0x' + Buffer.from(commitmentBytes).toString('hex')

          const result = await proveStaking({
            inputNullifier: nullifier.toString(),
            outputCommitment: commitment.toString(),
            amount: amountWei.toString(),
          })
          proof = result.proof
          publicInputs = result.publicInputs
        } catch {
          throw new Error('Failed to generate proof. Configure prover URL or ensure circuit artifacts are available.')
        }
      }

      toast.loading('Submitting transaction...', { id: 'stake' })
      const tx = await submitViaRelayer({
        signer,
        provider,
        walletAddress: address,
        target: contract,
        method: 'stake',
        methodArgs: [proof, publicInputs],
        fallbackTx: () => contract.stake(proof, publicInputs),
      })
      toast.loading('Waiting for confirmation...', { id: 'stake' })
      await waitAndParseTransaction(tx, address, provider)

      if (storedCommitment) {
        saveStakingPosition(address, {
          commitment: storedCommitment,
          nullifier: storedNullifier || undefined,
          stakingCommitment: storedCommitment,
          positionId: storedCommitment,
          contractType: 'staking',
          action: 'stake',
          amount: amountWei.toString(),
          timestamp: Date.now(),
        })
      }

      toast.success('Staking completed', { id: 'stake' })
      setAmount('')
    } catch (error) {
      console.error('stake failed', error)
      const message = error instanceof Error ? error.message : 'Staking failed'
      toast.error(message, { id: 'stake' })
    } finally {
      setStaking(false)
    }
  }

  return (
    <div className="card max-w-md">
      <h2 className="text-xl font-semibold mb-2">Stake</h2>
      <p className="text-sm text-terminal-text-dim mb-4 leading-relaxed">
        Lock AGS into a private stake commitment. You need at least{' '}
        <strong className="text-terminal-text">{formatBalance(minStake ?? parseEther('100'))} AGS</strong>.
      </p>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); handleStake() }}>
        <div>
          <label className="block text-sm font-medium text-terminal-text-dim mb-2">
            Amount (AGS)
          </label>
          <input
            type="number"
            step="0.001"
            min="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="input-field w-full"
            placeholder="0.0"
            disabled={staking}
          />
        </div>
        <button 
          type="submit" 
          className="btn-primary w-full" 
          disabled={!isConnected || staking || !amount || parseFloat(amount) <= 0}
        >
          {staking ? 'Staking...' : mode === 'legacy' ? 'Stake (Public)' : 'Stake (Private ZK)'}
        </button>
      </form>
    </div>
  )
}

function UnstakeForm({ mode }: { mode: 'legacy' | 'zk' }) {
  const { provider, signer, isConnected, address } = useWalletStore()
  const [nullifier, setNullifier] = useState('')
  const [requesting, setRequesting] = useState(false)
  const [completing, setCompleting] = useState(false)
  const proverUrl = import.meta.env.VITE_PROVER_URL as string | undefined

  // Check for pending unstake requests
  const { data: unstakeRequests } = useQuery({
    queryKey: ['unstake-requests', address],
    queryFn: async () => {
      if (!signer || !address) return []
      try {
        // Query unstake requests from local storage and on-chain contract
        if (!address) return []
        
        const { getUnstakeRequests } = await import('@/utils/commitmentStorage')
        const storedRequests = getUnstakeRequests(address)
        const contract = getStakingContract(signer)
        const unstakeRequests: Array<{ nullifier: string; timestamp: number; canComplete: boolean }> = []
        
        const currentTime = Math.floor(Date.now() / 1000)
        const unstakeDelay = await contract.unstakeDelay()
        
        for (const request of storedRequests) {
          try {
            // Check if unstake request exists on-chain
            // Note: unstakeRequests mapping may not be directly accessible via ABI
            // We'll need to track this via events instead
            // For now, use stored data if available
            if (request.timestamp > 0) {
              const unlockTimestamp = request.timestamp
              const delaySeconds = Number(unstakeDelay)
              unstakeRequests.push({
                nullifier: request.nullifier,
                timestamp: unlockTimestamp,
                canComplete: currentTime >= unlockTimestamp + delaySeconds,
              })
            }
          } catch (error) {
            // Request may not exist on-chain yet or ABI doesn't expose the mapping
            console.error(`Failed to check unstake request ${request.nullifier}:`, error)
          }
        }
        
        return unstakeRequests
      } catch {
        return []
      }
    },
    enabled: !!signer && !!address,
  })

  const handleRequestUnstake = async () => {
    try {
      checkRateLimit('api')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Rate limit exceeded')
      return
    }

    if (!signer || !isConnected) {
      toast.error('Please connect wallet')
      return
    }

    if (mode === 'zk' && nullifier && !isValidHex(nullifier, 32)) {
      toast.error('Invalid nullifier format (must be 32-byte hex)')
      return
    }

    setRequesting(true)
    try {
      const contract = getStakingContract(signer)
      toast.loading('Requesting unstake...', { id: 'unstake-request' })

      if (mode === 'legacy') {
        toast.error('Legacy unstaking not available. Please use ZK mode.')
        return
      } else {
        // ZK unstake request
        let proof: bigint[]
        let publicInputs: bigint[]

        if (proverUrl) {
          const res = await fetch(`${proverUrl}/staking/unstake-request/prove`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nullifier: nullifier || 'auto' }),
          })
          if (!res.ok) throw new Error('Proof service error')
          const data = await res.json()
          proof = (data.proof ?? []).map((x: string) => BigInt(x))
          publicInputs = (data.publicInputs ?? []).map((x: string) => BigInt(x))
        } else {
          const contract = getStakingContract(signer)
          const stakingNullifier = nullifier ? BigInt(nullifier) : BigInt('0x' + Buffer.from(randomBytes(32)).toString('hex'))
          const epoch = await contract.getCurrentEpochInfo().then(e => Number(e[0]))
          
          const result = await proveStaking({
            stakingNullifier: stakingNullifier.toString(),
            epoch: epoch.toString(),
          })
          proof = result.proof
          publicInputs = result.publicInputs
        }

        const tx = await contract.requestUnstake(proof, publicInputs)
        toast.loading('Waiting for confirmation...', { id: 'unstake-request' })
        await waitAndParseTransaction(tx, address!, provider!)
        toast.success('Unstake requested. Complete after 14-day delay.', { id: 'unstake-request' })
        setNullifier('')
      }
    } catch (error) {
      console.error('unstake request failed', error)
      toast.error(error instanceof Error ? error.message : 'Unstake request failed', { id: 'unstake-request' })
    } finally {
      setRequesting(false)
    }
  }

  const handleCompleteUnstake = async (requestNullifier: string) => {
    try {
      checkRateLimit('api')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Rate limit exceeded')
      return
    }

    if (!signer || !isConnected) return

    setCompleting(true)
    try {
      const contract = getStakingContract(signer)
      toast.loading('Completing unstake...', { id: 'unstake-complete' })

      let proof: bigint[]
      let publicInputs: bigint[]

      if (proverUrl) {
        const res = await fetch(`${proverUrl}/staking/unstake-complete/prove`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nullifier: requestNullifier }),
        })
        if (!res.ok) throw new Error('Proof service error')
        const data = await res.json()
        proof = (data.proof ?? []).map((x: string) => BigInt(x))
        publicInputs = (data.publicInputs ?? []).map((x: string) => BigInt(x))
      } else {
        const outputCommitmentBytes = randomBytes(32)
        const result = await proveStaking({
          stakingNullifier: requestNullifier,
          outputCommitment: '0x' + Buffer.from(outputCommitmentBytes).toString('hex'),
          amount: '0', // Will be determined by contract
        })
        proof = result.proof
        publicInputs = result.publicInputs
      }

      const tx = await contract.completeUnstake(proof, publicInputs)
      await waitAndParseTransaction(tx, address!, provider!)
      toast.success('Unstake completed', { id: 'unstake-complete' })
    } catch (error) {
      console.error('unstake complete failed', error)
      toast.error(error instanceof Error ? error.message : 'Unstake failed', { id: 'unstake-complete' })
    } finally {
      setCompleting(false)
    }
  }

  return (
    <div className="card max-w-md">
      <h2 className="text-xl font-semibold mb-4">Unstake Tokens</h2>
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-terminal-text-dim mb-2">
            Staking Nullifier (optional if prover configured)
          </label>
          <input
            type="text"
            value={nullifier}
            onChange={(e) => setNullifier(e.target.value)}
            className="input-field w-full"
            placeholder="0x... (32-byte hex)"
            disabled={requesting || !!proverUrl}
          />
        </div>
        <button
          className="btn-primary w-full"
          onClick={handleRequestUnstake}
          disabled={!isConnected || requesting}
        >
          {requesting ? 'Requesting...' : 'Request Unstake'}
        </button>
        
        {unstakeRequests && unstakeRequests.length > 0 && (
          <div className="mt-4 space-y-2">
            <h3 className="text-sm font-semibold">Pending Unstake Requests</h3>
            {unstakeRequests.map((req: { nullifier?: string }, idx: number) => (
              <div key={idx} className="flex justify-between items-center p-2 bg-terminal-surface rounded">
                <span className="text-sm">{req.nullifier?.slice(0, 10)}...</span>
                <button
                  className="btn-secondary btn-sm"
                  onClick={() => req.nullifier && handleCompleteUnstake(req.nullifier)}
                  disabled={completing || !req.nullifier}
                >
                  Complete
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function RewardsSection({ mode }: { mode: 'legacy' | 'zk' }) {
  const { provider, address, signer, isConnected } = useWalletStore()
  const [claiming, setClaiming] = useState(false)
  const [selectedPositionId, setSelectedPositionId] = useState('')
  const proverUrl = import.meta.env.VITE_PROVER_URL as string | undefined

  const positions = address ? getStakingPositions(address) : []
  const activePosition =
    positions.find((p) => p.positionId === selectedPositionId) ?? positions[0] ?? null

  const handleClaimRewards = async () => {
    try {
      checkRateLimit('api')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Rate limit exceeded')
      return
    }

    if (!signer || !isConnected || !address) {
      toast.error('Please connect wallet')
      return
    }

    if (!activePosition?.stakingCommitment) {
      toast.error('No tracked stake position on this device — stake first or import your commitment')
      return
    }

    setClaiming(true)
    try {
      const contract = getStakingContract(signer)
      toast.loading('Claiming rewards...', { id: 'claim-rewards' })

      if (mode === 'legacy') {
        toast.error('Legacy reward claiming not available. Please use ZK mode.')
        return
      }

      let proof: bigint[]
      let publicInputs: bigint[]
      const stakingNullifier = activePosition.nullifier ?? activePosition.stakingCommitment

      if (proverUrl) {
        const res = await fetch(`${proverUrl}/staking/rewards/prove`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            recipient: address,
            stakingNullifier,
            stakingCommitment: activePosition.stakingCommitment,
          }),
        })
        if (!res.ok) throw new Error('Proof service error')
        const data = await res.json()
        proof = (data.proof ?? []).map((x: string) => BigInt(x))
        publicInputs = (data.publicInputs ?? []).map((x: string) => BigInt(x))
      } else {
        const rewardCommitmentBytes = randomBytes(32)
        const rewardCommitment = BigInt('0x' + Buffer.from(rewardCommitmentBytes).toString('hex'))

        const result = await proveReward({
          stakingNullifier,
          rewardCommitment: rewardCommitment.toString(),
          rewardAmount: activePosition.amount || '0',
        })
        proof = result.proof
        publicInputs = result.publicInputs
      }

      const tx = await submitViaRelayer({
        signer,
        provider: provider!,
        walletAddress: address,
        target: contract,
        method: 'claimRewards',
        methodArgs: [proof, publicInputs],
        fallbackTx: () => contract.claimRewards(proof, publicInputs),
      })
      await waitAndParseTransaction(tx, address, provider!)
      toast.success('Rewards claimed', { id: 'claim-rewards' })
    } catch (error) {
      console.error('claim rewards failed', error)
      toast.error(error instanceof Error ? error.message : 'Claim failed', { id: 'claim-rewards' })
    } finally {
      setClaiming(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="card">
        <h2 className="text-xl font-semibold mb-2">Your rewards</h2>
        <p className="text-sm text-terminal-text-dim mb-4 leading-relaxed">
          Rewards accrue to your stake commitment. Select a position tracked on this device, then claim with a reward
          proof.
        </p>

        {positions.length > 0 ? (
          <div className="mb-4 space-y-2">
            <label className="block text-sm text-terminal-text-dim">Tracked stake positions</label>
            <select
              className="input-field w-full"
              value={activePosition?.positionId ?? ''}
              onChange={(e) => setSelectedPositionId(e.target.value)}
            >
              {positions.map((p) => (
                <option key={p.positionId} value={p.positionId}>
                  {p.positionId.slice(0, 10)}… · {formatBalance(BigInt(p.amount || '0'))} AGS
                </option>
              ))}
            </select>
          </div>
        ) : (
          <p className="text-sm text-terminal-warning mb-4">
            No stake positions saved locally. Complete a stake on this device first.
          </p>
        )}

        <button
          className="btn-primary w-full mt-2"
          onClick={handleClaimRewards}
          disabled={!isConnected || claiming || !activePosition}
        >
          {claiming ? 'Claiming...' : 'Claim Rewards'}
        </button>
      </div>
    </div>
  )
}

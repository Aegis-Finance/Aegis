import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { parseEther, randomBytes, id } from 'ethers'

import { useWalletStore } from '@/store/walletStore'
import { getYieldFarmingContract } from '@/utils/contracts'
import { formatBalance } from '@/utils/format'
import { proveYieldFarming } from '@/utils/prover'
import { groth16ProofBigintsToBytes256, hexToBytesStrict } from '@/utils/proofBytes'
import { validateAmount, detectAttackPattern, checkRateLimit } from '@/utils/security'
import { waitAndParseTransaction } from '@/utils/transactionHelper'
import DaoModuleNotice from '@/components/DaoModuleNotice'
import ModuleDeploymentNotice, { ModuleConfiguredSection } from '@/components/ModuleDeploymentNotice'
import ZkProverNotice from '@/components/ZkProverNotice'
import ZkModeToggle from '@/components/ZkModeToggle'
import { CONTRACT_ADDRESSES } from '@/config/contracts'

type YieldPool = {
  id: number
  name: string
  totalStaked: bigint
  rewardRate: bigint
  apy: number
  endTime: number
  minStakeAmount: bigint
  maxStakeAmount: bigint
  isActive: boolean
}

type YieldPoolStats = {
  totalStaked: bigint
  totalRewards: bigint
  avgApy: number
  totalPools: number
}

type YieldPosition = {
  positionId: string
  staked: bigint
  rewards: bigint
  lockDuration: number
}

export default function YieldFarming() {
  const [selectedPool, setSelectedPool] = useState<number | null>(null)
  const [mode, setMode] = useState<'legacy' | 'zk'>('zk')

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <h1 className="text-3xl font-bold text-terminal-accent mb-2">Yield Farming</h1>
        <DaoModuleNotice>
          <p>
            Pools pay rewards per <strong className="text-terminal-text">deployed farming rules</strong> (rates, caps,
            schedules). APY shown in the UI is informational — smart-contract and governance changes can alter emissions;
            principal remains exposed to the same market and protocol risks as the underlying tokens.
          </p>
        </DaoModuleNotice>
        <ModuleDeploymentNotice
          moduleName="Yield farming"
          contractAddress={CONTRACT_ADDRESSES.YIELD_FARMING}
          envHint="VITE_YIELD_FARMING_ADDRESS"
        />
        <div className="rounded-lg border border-terminal-border/60 bg-terminal-bg px-4 py-3 text-sm text-terminal-text-dim">
          Stake into existing pools below, or create a new pool if none match your campaign.
        </div>
      </div>

      <ModuleConfiguredSection contractAddress={CONTRACT_ADDRESSES.YIELD_FARMING}>
      <CreatePoolForm />

      <ZkProverNotice moduleLabel="Yield farming" />
      <ZkModeToggle mode={mode} onChange={setMode} zkOnly />

      <FarmingPools selectedPool={selectedPool} onSelectPool={setSelectedPool} mode={mode} />
      </ModuleConfiguredSection>
    </div>
  )
}

function CreatePoolForm() {
  const { signer, address, provider } = useWalletStore()
  const queryClient = useQueryClient()
  const [name, setName] = useState('AGS Season Pool')
  const [rewardRate, setRewardRate] = useState('0.001')
  const [durationDays, setDurationDays] = useState('90')
  const [minStake, setMinStake] = useState('100')
  const [maxStake, setMaxStake] = useState('1000000')
  const [isPrivate, setIsPrivate] = useState(true)
  const [busy, setBusy] = useState(false)

  const handleCreate = async () => {
    if (!signer || !address || !provider) {
      toast.error('Connect wallet')
      return
    }
    setBusy(true)
    const toastId = toast.loading('Creating pool…')
    try {
      const contract = getYieldFarmingContract(signer)
      const stakingToken = id('AGS')
      const rewardToken = id('AGS')
      const rate = parseEther(rewardRate || '0')
      const days = parseFloat(durationDays)
      const duration = BigInt(Math.ceil((Number.isFinite(days) && days > 0 ? days : 90) * 86400))
      const min = parseEther(minStake || '0')
      const max = parseEther(maxStake || '0')
      const tx = await contract.createPool(name, stakingToken, rewardToken, rate, duration, min, max, isPrivate)
      await waitAndParseTransaction(tx, address, provider)
      toast.success('Pool created', { id: toastId })
      await queryClient.invalidateQueries({ queryKey: ['yield-farming-pools'] })
      await queryClient.invalidateQueries({ queryKey: ['yield-farming-stats'] })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Create pool failed', { id: toastId })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card space-y-3">
      <h2 className="text-lg font-semibold">Create pool</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <label className="block text-sm">
          <span className="text-terminal-text-dim">Name</span>
          <input className="input-field w-full mt-1" value={name} onChange={(e) => setName(e.target.value)} disabled={busy} />
        </label>
        <label className="block text-sm">
          <span className="text-terminal-text-dim">Reward rate (AGS/sec)</span>
          <input className="input-field w-full mt-1" value={rewardRate} onChange={(e) => setRewardRate(e.target.value)} disabled={busy} />
        </label>
        <label className="block text-sm">
          <span className="text-terminal-text-dim">Duration (days)</span>
          <input className="input-field w-full mt-1" value={durationDays} onChange={(e) => setDurationDays(e.target.value)} disabled={busy} />
        </label>
        <label className="block text-sm">
          <span className="text-terminal-text-dim">Min stake (AGS)</span>
          <input className="input-field w-full mt-1" value={minStake} onChange={(e) => setMinStake(e.target.value)} disabled={busy} />
        </label>
        <label className="block text-sm">
          <span className="text-terminal-text-dim">Max stake (AGS)</span>
          <input className="input-field w-full mt-1" value={maxStake} onChange={(e) => setMaxStake(e.target.value)} disabled={busy} />
        </label>
        <label className="flex items-center gap-2 text-sm mt-6">
          <input type="checkbox" checked={isPrivate} onChange={(e) => setIsPrivate(e.target.checked)} disabled={busy} />
          <span className="text-terminal-text-dim">Private (ZK stake only)</span>
        </label>
      </div>
      <button type="button" className="btn-primary" disabled={busy || !address} onClick={() => void handleCreate()}>
        {busy ? 'Creating…' : 'Create pool on-chain'}
      </button>
    </div>
  )
}

function FarmingPools({
  selectedPool,
  onSelectPool,
  mode,
}: {
  selectedPool: number | null
  onSelectPool: (id: number | null) => void
  mode: 'legacy' | 'zk'
}) {
  const { provider } = useWalletStore()

  const { data: pools } = useQuery<YieldPool[]>({
    queryKey: ['yield-farming-pools'],
    queryFn: async () => {
      if (!provider) return []
      try {
        const contract = getYieldFarmingContract(provider)
        const fetchedPools: YieldPool[] = []
        
        const nextPoolId = await contract.nextPoolId().catch(() => 0n)
        const poolCount = Number(nextPoolId)
        
        for (let i = 0; i < poolCount; i++) {
          try {
            const pool = await contract.getPool(i)
            if (pool && pool.isActive) {
              const apy = await contract.calculateAPY(i).catch(() => 0n)
              fetchedPools.push({
                id: i,
                name: pool.name || `Pool ${i + 1}`,
                totalStaked: BigInt(pool.totalStaked || 0),
                rewardRate: BigInt(pool.rewardRate || 0),
                apy: Number(apy) / 100,
                endTime: Number(pool.poolEndTime || 0),
                minStakeAmount: BigInt(pool.minStakeAmount || 0),
                maxStakeAmount: BigInt(pool.maxStakeAmount || 0),
                isActive: pool.isActive,
              })
            }
          } catch (error) {
            continue
          }
        }

        return fetchedPools
      } catch (error) {
        console.error('Error fetching farming pools:', error)
        return []
      }
    },
    enabled: !!provider,
    refetchInterval: 30000,
  })

  const { data: stats } = useQuery<YieldPoolStats | null>({
    queryKey: ['yield-farming-stats'],
    queryFn: async () => {
      if (!provider || !pools || pools.length === 0) return null
      
      const totalStaked = pools.reduce((sum, pool) => sum + pool.totalStaked, 0n)
      const totalRewards = pools.reduce((sum, pool) => sum + pool.rewardRate, 0n)
      const avgApy = pools.reduce((sum, pool) => sum + pool.apy, 0) / pools.length

      return {
        totalStaked,
        totalRewards,
        avgApy,
        totalPools: pools.length,
      }
    },
    enabled: !!provider && !!pools,
  })

  return (
    <div className="space-y-6">
      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="card">
            <div className="text-sm text-terminal-text-dim mb-1">Total Staked</div>
            <div className="text-2xl font-bold text-terminal-accent">
              {formatBalance(stats.totalStaked)} AGS
            </div>
          </div>
          <div className="card">
            <div className="text-sm text-terminal-text-dim mb-1">Total Pools</div>
            <div className="text-2xl font-bold text-terminal-text">
              {stats.totalPools}
            </div>
          </div>
          <div className="card">
            <div className="text-sm text-terminal-text-dim mb-1">Avg APY</div>
            <div className="text-2xl font-bold text-terminal-accent">
              {stats.avgApy.toFixed(2)}%
            </div>
          </div>
          <div className="card">
            <div className="text-sm text-terminal-text-dim mb-1">Total Rewards</div>
            <div className="text-2xl font-bold text-terminal-text">
              {formatBalance(stats.totalRewards)} AGS/sec
            </div>
          </div>
        </div>
      )}

      {/* Pools Grid */}
      {!pools || pools.length === 0 ? (
        <div className="card text-center py-12">
          <p className="text-terminal-text-dim">No farming pools available</p>
          <p className="text-sm text-terminal-text-dim mt-2">
            Pools will appear here once created
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {pools.map((pool) => (
            <PoolCard
              key={pool.id}
              pool={pool}
              isSelected={selectedPool === pool.id}
              onSelect={() => onSelectPool(selectedPool === pool.id ? null : pool.id)}
            />
          ))}
        </div>
      )}

      {/* Selected Pool Details */}
      {selectedPool !== null && pools && pools.find(p => p.id === selectedPool) && (
        <PoolDetails pool={pools.find(p => p.id === selectedPool)!} mode={mode} />
      )}
    </div>
  )
}

function PoolCard({
  pool,
  isSelected,
  onSelect,
}: {
  pool: YieldPool
  isSelected: boolean
  onSelect: () => void
}) {
  return (
    <div
      className={`card cursor-pointer transition-all ${
        isSelected
          ? 'border-terminal-accent border-2 bg-terminal-accent/10'
          : 'hover:border-terminal-accent/50'
      }`}
      onClick={onSelect}
    >
      <div className="mb-4">
        <h3 className="text-lg font-semibold mb-2">{pool.name}</h3>
        <div className="text-sm text-terminal-text-dim">
          APY: <span className="text-terminal-accent font-semibold">{pool.apy.toFixed(2)}%</span>
        </div>
      </div>
      <div className="space-y-2 mb-4">
        <div className="flex items-center justify-between text-sm">
          <span className="text-terminal-text-dim">Total Staked</span>
          <span className="font-semibold text-terminal-text">
            {formatBalance(pool.totalStaked)} AGS
          </span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-terminal-text-dim">Reward Rate</span>
          <span className="font-semibold text-terminal-accent">
            {formatBalance(pool.rewardRate)}/sec
          </span>
        </div>
      </div>
      <button className="btn-primary w-full">
        {isSelected ? 'View Details' : 'Stake'}
      </button>
    </div>
  )
}

function PoolDetails({ pool, mode }: { pool: YieldPool; mode: 'legacy' | 'zk' }) {
  const { provider, address, signer, isConnected } = useWalletStore()
  const [stakeAmount, setStakeAmount] = useState('')
  const [lockDuration, setLockDuration] = useState('')
  const [staking, setStaking] = useState(false)
  const [unstaking, setUnstaking] = useState(false)
  const [unstakeAmount, setUnstakeAmount] = useState('')
  // const [positionId, setPositionId] = useState('') // Reserved for future use
  const [claiming, setClaiming] = useState(false)
  const proverUrl = import.meta.env.VITE_PROVER_URL as string | undefined

  const { data: position } = useQuery<YieldPosition | null>({
    queryKey: ['yield-position', pool.id, address],
    queryFn: async () => {
      if (!provider || !address) return null
      try {
        const contract = getYieldFarmingContract(provider)
        const positionIds = await contract.getPoolStakers(pool.id).catch(() => [])
        
        let staked = 0n
        let rewards = 0n
        let lockDuration = 0
        let foundPositionId = ''
        
        for (const posId of positionIds) {
          try {
            const positionData = await contract.getPosition(posId)
            if (positionData && positionData.isActive && Number(positionData.poolId) === pool.id) {
              const [amount, pendingRewards] = await contract.getPositionValue(posId).catch(() => [0n, 0n])
              staked += BigInt(amount || 0)
              rewards += BigInt(pendingRewards || 0)
              lockDuration = Number(positionData.lockDuration || 0)
              foundPositionId = posId
            }
          } catch {
            continue
          }
        }
        
        return foundPositionId ? {
          positionId: foundPositionId,
          staked,
          rewards,
          lockDuration,
        } : null
      } catch (error) {
        console.error('Error fetching user position:', error)
        return null
      }
    },
    enabled: !!provider && !!address,
  })

  const handleStake = async () => {
    try {
      checkRateLimit('api')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Rate limit exceeded')
      return
    }

    if (!signer || !stakeAmount || !lockDuration || !isConnected) {
      toast.error('Please connect wallet and fill all fields')
      return
    }

    const amountValidation = validateAmount(stakeAmount)
    if (!amountValidation.valid) {
      toast.error(amountValidation.error || 'Invalid amount')
      return
    }

    const durationNum = parseInt(lockDuration)
    if (isNaN(durationNum) || durationNum < 7 || durationNum > 365) {
      toast.error('Lock duration must be between 7 and 365 days')
      return
    }

    if (detectAttackPattern(stakeAmount)) {
      toast.error('Invalid input detected')
      return
    }

    const amountWei = parseEther(stakeAmount)
    if (amountWei < pool.minStakeAmount) {
      toast.error(`Minimum stake is ${formatBalance(pool.minStakeAmount)} AGS`)
      return
    }
    if (amountWei > pool.maxStakeAmount) {
      toast.error(`Maximum stake is ${formatBalance(pool.maxStakeAmount)} AGS`)
      return
    }

    setStaking(true)
    try {
      const contract = getYieldFarmingContract(signer)
      const lockDurationSeconds = BigInt(durationNum * 24 * 60 * 60)
      
      toast.loading('Processing stake...', { id: 'stake-farming' })

      if (mode === 'legacy') {
        toast.error('Legacy staking not available. Please use ZK mode.')
        return
      } else {
        let zkProof: Uint8Array
        let stakerCommitment: string
        let nullifier: string

        if (proverUrl) {
          const res = await fetch(`${proverUrl}/farming/stake/prove`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              poolId: pool.id,
              amount: amountWei.toString(),
              lockDuration: lockDurationSeconds.toString(),
              recipient: address,
            }),
          })
          if (!res.ok) {
            const errText = await res.text().catch(() => '')
            throw new Error(`Proof service error (${res.status}): ${errText || res.statusText}`)
          }
          const data = (await res.json()) as {
            proof: string
            stakerCommitment?: string
            nullifier?: string
          }
          if (!data.proof) throw new Error('Proof service response missing proof')
          zkProof = hexToBytesStrict(data.proof, 256, 'ZK proof')
          if (!data.stakerCommitment || !data.nullifier) {
            throw new Error(
              'Proof service must return stakerCommitment and nullifier (bytes32 hex) alongside proof'
            )
          }
          stakerCommitment = data.stakerCommitment.startsWith('0x')
            ? data.stakerCommitment
            : `0x${data.stakerCommitment}`
          nullifier = data.nullifier.startsWith('0x') ? data.nullifier : `0x${data.nullifier}`
        } else {
          const stakerCommitmentBytes = randomBytes(32)
          const nullifierBytes = randomBytes(32)
          stakerCommitment = '0x' + Buffer.from(stakerCommitmentBytes).toString('hex')
          nullifier = '0x' + Buffer.from(nullifierBytes).toString('hex')

          toast.loading('Generating ZK proof (client-side)...', { id: 'stake-farming' })
          const result = await proveYieldFarming({
            stakerCommitment: BigInt(stakerCommitment).toString(),
            nullifier: BigInt(nullifier).toString(),
            poolId: pool.id.toString(),
            amount: amountWei.toString(),
            lockDuration: lockDurationSeconds.toString(),
          })
          zkProof = groth16ProofBigintsToBytes256(result.proof)
        }

        toast.loading('Submitting transaction...', { id: 'stake-farming' })
        const tx = await contract.stake({
          poolId: BigInt(pool.id),
          amount: amountWei,
          lockDuration: lockDurationSeconds,
          stakerCommitment,
          nullifier,
          zkProof,
        })
        toast.loading('Waiting for confirmation...', { id: 'stake-farming' })
        await waitAndParseTransaction(tx, address!, provider!)
        toast.success('Staked successfully', { id: 'stake-farming' })
        setStakeAmount('')
        setLockDuration('')
      }
    } catch (error) {
      console.error('stake failed', error)
      toast.error(error instanceof Error ? error.message : 'Staking failed', { id: 'stake-farming' })
    } finally {
      setStaking(false)
    }
  }

  const handleUnstake = async () => {
    try {
      checkRateLimit('api')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Rate limit exceeded')
      return
    }

    if (!signer || !unstakeAmount || !position || !isConnected) {
      toast.error('Please connect wallet and enter amount')
      return
    }

    const amountValidation = validateAmount(unstakeAmount)
    if (!amountValidation.valid) {
      toast.error(amountValidation.error || 'Invalid amount')
      return
    }

    const amountWei = parseEther(unstakeAmount)
    if (amountWei > position.staked) {
      toast.error('Amount exceeds staked balance')
      return
    }

    setUnstaking(true)
    try {
      const contract = getYieldFarmingContract(signer)
      
      toast.loading('Processing unstake...', { id: 'unstake-farming' })

      let zkProof: Uint8Array
      let withdrawalCommitment: string
      let nullifier: string

      if (proverUrl) {
        const res = await fetch(`${proverUrl}/farming/unstake/prove`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            positionId: position.positionId,
            amount: amountWei.toString(),
            recipient: address,
          }),
        })
        if (!res.ok) {
          const errText = await res.text().catch(() => '')
          throw new Error(`Proof service error (${res.status}): ${errText || res.statusText}`)
        }
        const data = (await res.json()) as {
          proof: string
          withdrawalCommitment?: string
          nullifier?: string
        }
        if (!data.proof) throw new Error('Proof service response missing proof')
        zkProof = hexToBytesStrict(data.proof, 256, 'ZK proof')
        if (!data.withdrawalCommitment || !data.nullifier) {
          throw new Error(
            'Proof service must return withdrawalCommitment and nullifier (bytes32 hex) alongside proof'
          )
        }
        withdrawalCommitment = data.withdrawalCommitment.startsWith('0x')
          ? data.withdrawalCommitment
          : `0x${data.withdrawalCommitment}`
        nullifier = data.nullifier.startsWith('0x') ? data.nullifier : `0x${data.nullifier}`
      } else {
        const withdrawalCommitmentBytes = randomBytes(32)
        const nullifierBytes = randomBytes(32)
        withdrawalCommitment = '0x' + Buffer.from(withdrawalCommitmentBytes).toString('hex')
        nullifier = '0x' + Buffer.from(nullifierBytes).toString('hex')

        toast.loading('Generating ZK proof (client-side)...', { id: 'unstake-farming' })
        const result = await proveYieldFarming({
          withdrawalCommitment: BigInt(withdrawalCommitment).toString(),
          nullifier: BigInt(nullifier).toString(),
          positionId: String(position.positionId),
          amount: amountWei.toString(),
        })
        zkProof = groth16ProofBigintsToBytes256(result.proof)
      }

      toast.loading('Submitting transaction...', { id: 'unstake-farming' })
      const tx = await contract.unstake({
        positionId: position.positionId,
        amount: amountWei,
        withdrawalCommitment,
        nullifier,
        zkProof,
      })
      toast.loading('Waiting for confirmation...', { id: 'unstake-farming' })
      await tx.wait()
      toast.success('Unstaked successfully', { id: 'unstake-farming' })
      setUnstakeAmount('')
    } catch (error) {
      console.error('unstake failed', error)
      toast.error(error instanceof Error ? error.message : 'Unstaking failed', { id: 'unstake-farming' })
    } finally {
      setUnstaking(false)
    }
  }

  const handleClaimRewards = async () => {
    try {
      checkRateLimit('api')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Rate limit exceeded')
      return
    }

    if (!signer || !position || !isConnected) {
      toast.error('Please connect wallet')
      return
    }

    if (position.rewards === 0n) {
      toast.error('No rewards to claim')
      return
    }

    setClaiming(true)
    try {
      const contract = getYieldFarmingContract(signer)
      
      toast.loading('Claiming rewards...', { id: 'claim-farming' })

      let zkProof: Uint8Array
      let rewardCommitment: string
      let nullifier: string

      if (proverUrl) {
        const res = await fetch(`${proverUrl}/farming/claim-rewards/prove`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            positionId: position.positionId,
            recipient: address,
          }),
        })
        if (!res.ok) {
          const errText = await res.text().catch(() => '')
          throw new Error(`Proof service error (${res.status}): ${errText || res.statusText}`)
        }
        const data = (await res.json()) as {
          proof: string
          rewardCommitment?: string
          nullifier?: string
        }
        if (!data.proof) throw new Error('Proof service response missing proof')
        zkProof = hexToBytesStrict(data.proof, 256, 'ZK proof')
        if (!data.rewardCommitment || !data.nullifier) {
          throw new Error(
            'Proof service must return rewardCommitment and nullifier (bytes32 hex) alongside proof'
          )
        }
        rewardCommitment = data.rewardCommitment.startsWith('0x')
          ? data.rewardCommitment
          : `0x${data.rewardCommitment}`
        nullifier = data.nullifier.startsWith('0x') ? data.nullifier : `0x${data.nullifier}`
      } else {
        const rewardCommitmentBytes = randomBytes(32)
        const nullifierBytes = randomBytes(32)
        rewardCommitment = '0x' + Buffer.from(rewardCommitmentBytes).toString('hex')
        nullifier = '0x' + Buffer.from(nullifierBytes).toString('hex')

        toast.loading('Generating ZK proof (client-side)...', { id: 'claim-farming' })
        const result = await proveYieldFarming({
          rewardCommitment: BigInt(rewardCommitment).toString(),
          nullifier: BigInt(nullifier).toString(),
          positionId: String(position.positionId),
        })
        zkProof = groth16ProofBigintsToBytes256(result.proof)
      }

      toast.loading('Submitting transaction...', { id: 'claim-farming' })
      const tx = await contract.claimRewards({
        positionId: position.positionId,
        rewardCommitment,
        nullifier,
        zkProof,
      })
      toast.loading('Waiting for confirmation...', { id: 'claim-farming' })
      await tx.wait()
      toast.success('Rewards claimed', { id: 'claim-farming' })
    } catch (error) {
      console.error('claim rewards failed', error)
      toast.error(error instanceof Error ? error.message : 'Claim failed', { id: 'claim-farming' })
    } finally {
      setClaiming(false)
    }
  }

  return (
    <div className="card">
      <h2 className="text-xl font-semibold mb-4">{pool.name} - Details</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <h3 className="font-semibold text-terminal-text mb-3">Pool Information</h3>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-terminal-text-dim">Total Staked</span>
              <span className="font-semibold">{formatBalance(pool.totalStaked)} AGS</span>
            </div>
            <div className="flex justify-between">
              <span className="text-terminal-text-dim">APY</span>
              <span className="font-semibold text-terminal-accent">{pool.apy.toFixed(2)}%</span>
            </div>
            <div className="flex justify-between">
              <span className="text-terminal-text-dim">Reward Rate</span>
              <span className="font-semibold">{formatBalance(pool.rewardRate)} AGS/sec</span>
            </div>
            <div className="flex justify-between">
              <span className="text-terminal-text-dim">Min Stake</span>
              <span className="font-semibold">{formatBalance(pool.minStakeAmount)} AGS</span>
            </div>
            <div className="flex justify-between">
              <span className="text-terminal-text-dim">Max Stake</span>
              <span className="font-semibold">{formatBalance(pool.maxStakeAmount)} AGS</span>
            </div>
          </div>
        </div>
        {position && (
          <div>
            <h3 className="font-semibold text-terminal-text mb-3">Your Position</h3>
            <div className="space-y-2 text-sm mb-4">
              <div className="flex justify-between">
                <span className="text-terminal-text-dim">Staked</span>
                <span className="font-semibold">{formatBalance(position.staked)} AGS</span>
              </div>
              <div className="flex justify-between">
                <span className="text-terminal-text-dim">Claimable Rewards</span>
                <span className="font-semibold text-terminal-accent">
                  {formatBalance(position.rewards)} AGS
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-terminal-text-dim">Lock Duration</span>
                <span className="font-semibold">{Math.floor(position.lockDuration / (24 * 60 * 60))} days</span>
              </div>
            </div>
            <button 
              className="btn-primary w-full mb-2"
              onClick={handleClaimRewards}
              disabled={claiming || position.rewards === 0n}
            >
              {claiming ? 'Claiming...' : 'Claim Rewards'}
            </button>
            <div className="mt-4 space-y-2">
              <input
                type="number"
                step="0.001"
                min="0"
                value={unstakeAmount}
                onChange={(e) => setUnstakeAmount(e.target.value)}
                className="input-field w-full"
                placeholder="Unstake amount"
                disabled={unstaking}
              />
              <button
                className="btn-secondary w-full"
                onClick={handleUnstake}
                disabled={unstaking || !unstakeAmount || parseFloat(unstakeAmount) <= 0}
              >
                {unstaking ? 'Unstaking...' : 'Unstake'}
              </button>
            </div>
          </div>
        )}
        {!position && (
          <div>
            <h3 className="font-semibold text-terminal-text mb-3">Stake in Pool</h3>
            <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); handleStake() }}>
              <div>
                <label className="block text-sm font-medium text-terminal-text-dim mb-2">
                  Amount (AGS)
                </label>
                <input
                  type="number"
                  step="0.001"
                  min="0"
                  value={stakeAmount}
                  onChange={(e) => setStakeAmount(e.target.value)}
                  className="input-field w-full"
                  placeholder="0.0"
                  disabled={staking}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-terminal-text-dim mb-2">
                  Lock Duration (days)
                </label>
                <input
                  type="number"
                  min="7"
                  max="365"
                  value={lockDuration}
                  onChange={(e) => setLockDuration(e.target.value)}
                  className="input-field w-full"
                  placeholder="30"
                  disabled={staking}
                />
              </div>
              <button 
                type="submit" 
                className="btn-primary w-full" 
                disabled={!isConnected || staking || !stakeAmount || !lockDuration}
              >
                {staking ? 'Staking...' : mode === 'legacy' ? 'Stake (Public)' : 'Stake (Private ZK)'}
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  )
}

/** On-chain staking reward math — honest APY from pool + stake, not the fixed `rewardRate()` headline alone. */

const SECONDS_PER_YEAR = 365n * 24n * 60n * 60n

export type StakingPoolSnapshot = {
  rewardRateBpsPerEpoch: bigint
  epochDurationSec: bigint
  rewardPool: bigint
  totalStaked: bigint
  minStakeAmount: bigint
  governanceAddress: string
  timelockAddress: string
  paused: boolean
}

export function epochsPerYear(epochDurationSec: bigint): bigint {
  if (epochDurationSec <= 0n) return 0n
  return SECONDS_PER_YEAR / epochDurationSec
}

/** Annual % if the reward pool can fully fund `rewardRate` bps each epoch on all staked AGS. */
export function nominalStakingApyPercent(
  rewardRateBpsPerEpoch: bigint,
  epochDurationSec: bigint
): number {
  const epy = epochsPerYear(epochDurationSec)
  if (epy === 0n || rewardRateBpsPerEpoch <= 0n) return 0
  return (Number(rewardRateBpsPerEpoch) * Number(epy)) / 10000
}

/**
 * Effective annual % today: nominal rate scaled down when the pool cannot fund a full year.
 * Returns `null` when stake or pool is zero (rate is undefined, not "0% yield forever").
 */
export function effectiveStakingApyPercent(
  rewardRateBpsPerEpoch: bigint,
  epochDurationSec: bigint,
  rewardPool: bigint,
  totalStaked: bigint
): number | null {
  if (totalStaked <= 0n || rewardPool <= 0n) return null

  const nominal = nominalStakingApyPercent(rewardRateBpsPerEpoch, epochDurationSec)
  if (nominal <= 0) return 0

  const epy = epochsPerYear(epochDurationSec)
  if (epy === 0n) return null

  const annualNeed = (totalStaked * rewardRateBpsPerEpoch * epy) / 10000n
  if (annualNeed <= 0n) return null

  const fundingRatio = Number(rewardPool) / Number(annualNeed)
  return nominal * Math.min(1, fundingRatio)
}

export type StakingYieldStatus = 'paused' | 'no_pool' | 'no_stake' | 'earning'

export function stakingYieldStatus(
  rewardPool: bigint,
  totalStaked: bigint,
  paused: boolean
): StakingYieldStatus {
  if (paused) return 'paused'
  if (rewardPool <= 0n) return 'no_pool'
  if (totalStaked <= 0n) return 'no_stake'
  return 'earning'
}

export function formatStakingApy(apy: number | null): string {
  if (apy === null) return '—'
  return `${apy.toFixed(2)}%`
}

export function isZeroAddress(addr: string | undefined | null): boolean {
  if (!addr) return true
  return addr.toLowerCase() === '0x0000000000000000000000000000000000000000'
}

export function stakingGovernanceLinked(snapshot: Pick<StakingPoolSnapshot, 'governanceAddress'>): boolean {
  return !isZeroAddress(snapshot.governanceAddress)
}

/** Honest LP mining APY from on-chain gauge + pool reserves (no fake headline rates). */

const SECONDS_PER_YEAR = 365n * 24n * 60n * 60n

export type GaugeSnapshot = {
  rewardRate: bigint
  periodFinish: bigint
  totalStakedLp: bigint
  rewardTokenSymbol: string
  stakeTokenSymbol: string
  paused: boolean
}

export type PoolReserveSnapshot = {
  reserveAgs: bigint
  reserveQuote: bigint
  quoteDecimals: number
}

/** AGS emitted per second while epoch is active. */
export function gaugeActiveRewardRate(rewardRate: bigint, periodFinish: bigint, nowSec = BigInt(Math.floor(Date.now() / 1000))): bigint {
  if (periodFinish <= nowSec || rewardRate <= 0n) return 0n
  return rewardRate
}

/** Annual AGS rewards if current rate held for a year (informational). */
export function annualAgsEmission(rewardRate: bigint, periodFinish: bigint): bigint {
  const active = gaugeActiveRewardRate(rewardRate, periodFinish)
  return active * SECONDS_PER_YEAR
}

/**
 * AGS-denominated APR per 1 LP token (1e18) staked in gauge.
 * Returns null when no stakers (rate is per-LP undefined).
 */
export function agsAprPerLpToken(
  rewardRate: bigint,
  periodFinish: bigint,
  totalStakedLp: bigint
): number | null {
  if (totalStakedLp <= 0n) return null
  const active = gaugeActiveRewardRate(rewardRate, periodFinish)
  if (active <= 0n) return null
  const agsPerLpPerSec = Number(active) / Number(totalStakedLp)
  return agsPerLpPerSec * Number(SECONDS_PER_YEAR) * 100
}

/** Seconds until emission window ends. */
export function secondsUntilPeriodFinish(periodFinish: bigint, nowSec = BigInt(Math.floor(Date.now() / 1000))): bigint {
  if (periodFinish <= nowSec) return 0n
  return periodFinish - nowSec
}

export type LiquidityBootstrapStatus = 'no_emissions' | 'needs_liquidity' | 'needs_stakers' | 'live'

export function liquidityBootstrapStatus(args: {
  rewardRate: bigint
  periodFinish: bigint
  poolLive: boolean
  totalStakedLp: bigint
}): LiquidityBootstrapStatus {
  const active = gaugeActiveRewardRate(args.rewardRate, args.periodFinish)
  if (active <= 0n) return 'no_emissions'
  if (!args.poolLive) return 'needs_liquidity'
  if (args.totalStakedLp <= 0n) return 'needs_stakers'
  return 'live'
}

export function formatApr(apr: number | null): string {
  if (apr === null) return '—'
  if (!Number.isFinite(apr) || apr <= 0) return '0%'
  if (apr > 9999) return '>9999%'
  return `${apr.toFixed(2)}%`
}

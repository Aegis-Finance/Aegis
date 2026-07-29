import { CONTRACT_ADDRESSES, ZERO_ADDRESS } from '@/config/contracts'

/** Per-pool liquidity mining gauge (LP stake token = PublicLiquidityPool ERC20). */
export function resolveGaugeAddressForPoolId(poolId: string): string | undefined {
  const id = poolId.toUpperCase()
  if (id === 'USDC') {
    const a = CONTRACT_ADDRESSES.LIQUIDITY_GAUGE_USDC
    return a && a !== ZERO_ADDRESS ? a : undefined
  }
  if (id === 'SONIC' || id === 'S' || id === 'WS') {
    const sonic = CONTRACT_ADDRESSES.LIQUIDITY_GAUGE_SONIC
    if (sonic && sonic !== ZERO_ADDRESS) return sonic
  }
  const legacy = CONTRACT_ADDRESSES.LIQUIDITY_MINING_GAUGE
  return legacy && legacy !== ZERO_ADDRESS ? legacy : undefined
}

export function poolIdsWithCommunityLiquidityMining(): string[] {
  const out: string[] = []
  if (CONTRACT_ADDRESSES.LIQUIDITY_GAUGE_USDC && CONTRACT_ADDRESSES.LIQUIDITY_GAUGE_USDC !== ZERO_ADDRESS) {
    out.push('USDC')
  }
  if (CONTRACT_ADDRESSES.LIQUIDITY_GAUGE_SONIC && CONTRACT_ADDRESSES.LIQUIDITY_GAUGE_SONIC !== ZERO_ADDRESS) {
    out.push('SONIC')
  }
  return out
}

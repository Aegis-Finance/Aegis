import { useQuery } from '@tanstack/react-query'
import { getPublicPoolConfigs, type PublicPoolConfig } from '@/config/liquidity'
import { getPublicLiquidityPoolContract } from '@/utils/contracts'
import type { Provider } from 'ethers'

export async function fetchPoolReserves(provider: Provider, pool: PublicPoolConfig) {
  const contract = getPublicLiquidityPoolContract(pool.poolAddress, provider)
  const reserves = await contract.getReserves()
  const ags = reserves.reserveAgs ?? reserves[0]
  const quote = reserves.reserveQuote ?? reserves[1]
  return { ags: ags as bigint, quote: quote as bigint, live: ags > 0n && quote > 0n }
}

/** Pools with on-chain reserves (G1.4 — hide dead Aegis pairs). */
export function useLiveLiquidityPools(provider: Provider | null | undefined) {
  const configs = getPublicPoolConfigs()
  return useQuery({
    queryKey: ['live-liquidity-pools', configs.map((p) => p.poolAddress).join(',')],
    queryFn: async () => {
      if (!provider) return []
      const rows = await Promise.all(
        configs.map(async (pool) => {
          try {
            const r = await fetchPoolReserves(provider, pool)
            return { pool, ...r }
          } catch {
            return { pool, ags: 0n, quote: 0n, live: false }
          }
        }),
      )
      return rows
    },
    enabled: !!provider && configs.length > 0,
    staleTime: 30_000,
  })
}

export function pickSwapPools(args: {
  allPools: PublicPoolConfig[]
  livePoolAddresses: Set<string>
  route: 'auto' | 'aegis' | 'odos'
  /** When true, hide duplicate native S / wS bootstrap pools (canonical v3 handles AGS/S). */
  hideNativeWsDuplicates?: boolean
}): PublicPoolConfig[] {
  let pools = args.allPools
  if (args.hideNativeWsDuplicates) {
    const ws = (import.meta.env.VITE_WRAPPED_NATIVE_ADDRESS as string | undefined)?.trim()?.toLowerCase()
    pools = pools.filter((p) => {
      if (p.useNative) return false
      if (ws && p.tokenAddress?.toLowerCase() === ws) return false
      return true
    })
    // Keep at least one pool for UX if everything was filtered
    if (!pools.length) pools = args.allPools.filter((p) => p.useNative).slice(0, 1)
  }
  if (args.route === 'aegis') {
    return pools.filter((p) => args.livePoolAddresses.has(p.poolAddress.toLowerCase()))
  }
  return pools
}

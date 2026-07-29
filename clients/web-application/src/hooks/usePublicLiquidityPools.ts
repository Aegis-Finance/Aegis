import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getPublicPoolConfigs, type PublicPoolConfig } from '@/config/liquidity'
import { discoverRouterLiquidityPools } from '@/utils/discoverLiquidityPools'
import { useWalletStore } from '@/store/walletStore'

function mergePublicPoolConfigs(...lists: PublicPoolConfig[][]): PublicPoolConfig[] {
  const map = new Map<string, PublicPoolConfig>()
  for (const list of lists) {
    for (const pool of list) {
      if (!pool.poolAddress) continue
      const key = pool.poolAddress.toLowerCase()
      if (!map.has(key)) map.set(key, pool)
    }
  }
  return Array.from(map.values())
}

export function usePublicLiquidityPools() {
  const { provider } = useWalletStore()

  const { data: discovered = [] } = useQuery({
    queryKey: ['discovered-liquidity-pools'],
    queryFn: async () => {
      if (!provider) return []
      return discoverRouterLiquidityPools(provider)
    },
    enabled: !!provider,
    staleTime: 60_000,
  })

  const pools = useMemo<PublicPoolConfig[]>(
    () => mergePublicPoolConfigs(getPublicPoolConfigs(), discovered),
    [discovered],
  )

  return { pools }
}

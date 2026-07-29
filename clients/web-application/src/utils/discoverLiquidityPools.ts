import { Contract, type Provider } from 'ethers'
import { CONTRACT_ADDRESSES, ZERO_ADDRESS } from '@/config/contracts'
import { ABIS } from '@/abis'
import type { PublicPoolConfig } from '@/config/liquidity'
import { getPublicLiquidityPoolContract } from '@/utils/contracts'

export async function discoverRouterLiquidityPools(provider: Provider): Promise<PublicPoolConfig[]> {
  const routerAddr = CONTRACT_ADDRESSES.PUBLIC_POOL_ROUTER
  if (!routerAddr || routerAddr === ZERO_ADDRESS) return []

  const router = new Contract(routerAddr, ABIS.AegisPublicPoolRouter, provider)
  const count = Number(await router.poolCount())
  if (!Number.isFinite(count) || count <= 0) return []

  const pools: PublicPoolConfig[] = []
  for (let i = 0; i < count; i++) {
    const poolAddress = (await router.poolAt(i)) as string
    if (!poolAddress || poolAddress === ZERO_ADDRESS) continue
    try {
      const pool = getPublicLiquidityPoolContract(poolAddress, provider)
      const [quoteToken, quoteIsNative, symbol] = await Promise.all([
        pool.quoteToken() as Promise<string>,
        pool.quoteIsNative() as Promise<boolean>,
        pool.symbol().catch(() => 'LP'),
      ])
      pools.push({
        id: `ROUTER_${i}`,
        poolAddress,
        tokenAddress: quoteIsNative ? null : quoteToken,
        tokenSymbol: quoteIsNative ? 'S' : 'TOKEN',
        lpSymbol: symbol,
        useNative: quoteIsNative,
      })
    } catch {
      // skip malformed pool entries
    }
  }
  return pools
}

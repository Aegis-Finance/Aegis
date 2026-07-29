import { useQuery } from '@tanstack/react-query'
import { formatUnits, parseUnits } from 'ethers'

import { useWalletStore } from '@/store/walletStore'
import { getPublicPoolConfigs } from '@/config/liquidity'
import { getPublicLiquidityPoolContract, getErc20Contract } from '@/utils/contracts'
import {
  canonicalSpotAgsForOneQuote,
  fetchCanonicalAgsPerWs,
  isCanonicalV3Active,
  isNativeOrWsQuotePool,
} from '@/utils/canonicalSwap'

export type PoolSpotHint = {
  poolId: string
  label: string
  agsForOneQuote: string | null
  quoteForOneAgs: string | null
  /** When set, price is from canonical Uniswap v3 (single AGS/S reference). */
  canonical?: boolean
}

/**
 * Live prices aligned with swap routing: canonical v3 for S/wS after TGE seed; internal pools for USDC/USDT/WETH.
 */
export function usePoolSpotHints() {
  const { provider } = useWalletStore()
  const pools = getPublicPoolConfigs()

  return useQuery({
    queryKey: ['pool-spot-hints', pools.map((p) => p.poolAddress).join('|')],
    queryFn: async (): Promise<PoolSpotHint[]> => {
      if (!provider || pools.length === 0) return []

      const v3Live = await isCanonicalV3Active(provider)
      const canonicalAgsPerWs = v3Live ? await fetchCanonicalAgsPerWs(provider) : null

      const out: PoolSpotHint[] = []
      for (const p of pools) {
        let quoteDecimals = 18
        if (!p.useNative && p.tokenAddress) {
          const erc = getErc20Contract(p.tokenAddress, provider)
          quoteDecimals = Number(await erc.decimals().catch(() => 18))
        }

        const label = (p.tokenSymbol || p.id).replace(/\s+/g, ' ').trim()

        let agsForOneQuote: string | null = null
        let quoteForOneAgs: string | null = null
        let canonical = false

        try {
          if (v3Live && isNativeOrWsQuotePool(p)) {
            const spot = await canonicalSpotAgsForOneQuote(provider, p)
            if (spot) {
              agsForOneQuote = spot
              canonical = true
              if (canonicalAgsPerWs && Number(canonicalAgsPerWs) > 0) {
                quoteForOneAgs = (1 / Number(canonicalAgsPerWs)).toString()
              }
            }
          } else {
            const pool = getPublicLiquidityPoolContract(p.poolAddress, provider)
            const oneQuote = parseUnits('1', quoteDecimals)
            const agsOut = (await pool.quoteSwap(false, oneQuote)) as bigint
            agsForOneQuote = formatUnits(agsOut, 18)

            const oneAgs = parseUnits('1', 18)
            const quoteOut = (await pool.quoteSwap(true, oneAgs)) as bigint
            quoteForOneAgs = formatUnits(quoteOut, quoteDecimals)
          }
        } catch {
          // zero liquidity or reverts — omit row
        }

        out.push({ poolId: p.id, label, agsForOneQuote, quoteForOneAgs, canonical })
      }
      return out
    },
    enabled: !!provider && pools.length > 0,
    refetchInterval: 12_000,
    staleTime: 4_000,
  })
}

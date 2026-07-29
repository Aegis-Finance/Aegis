import type { BridgeTokenConfig } from './bridge'
import { bridgeTokenIdFromSymbol, getBridgeTokenBySymbol, getBridgeTokenConfigs } from './bridge'
import { DEFAULT_NETWORK, ZERO_ADDRESS } from './contracts'

function chainPackJsonHref(): string {
  const base = (import.meta.env.BASE_URL || '/').replace(/\/?$/, '/')
  return `${base}config/sonic-chain-pack.json`
}

type PackRow = {
  tokenSymbol: string
  tokenAddress: string
  enabled?: boolean
  description?: string
  settlementRail?: 'circle-cctp-v2' | 'sonic-gateway-native'
}

/**
 * Bridge token rows from `public/config/sonic-chain-pack.json` (synced from Aegis-contracts).
 * Merges optional `settlementRail` from `bridge-tokens.json` via `getBridgeTokenBySymbol`.
 * On fetch/parse failure, callers should fall back to `getBridgeTokenConfigs()`.
 */
export async function fetchSonicChainPackBridgeTokens(): Promise<BridgeTokenConfig[]> {
  const res = await fetch(chainPackJsonHref(), { cache: 'default' })
  if (!res.ok) {
    throw new Error(`sonic-chain-pack: ${res.status}`)
  }
  const data = (await res.json()) as Record<
    string,
    { chainId?: number; bridgeTokens?: PackRow[] } | undefined
  >
  const key = DEFAULT_NETWORK.chainId === 14601 ? 'sonicTestnet' : 'sonicMainnet'
  const layer = data[key]
  const rows = layer?.bridgeTokens ?? []

  return rows
    .filter((t) => t.enabled !== false)
    .map((t) => {
      const fromJson = getBridgeTokenBySymbol(t.tokenSymbol)
      const addr = t.tokenAddress
      return {
        id: bridgeTokenIdFromSymbol(t.tokenSymbol),
        tokenAddress: addr && addr.toLowerCase() !== ZERO_ADDRESS.toLowerCase() ? addr : null,
        tokenSymbol: t.tokenSymbol,
        description: t.description,
        settlementRail: t.settlementRail ?? fromJson?.settlementRail,
      }
    })
}

export async function fetchSonicChainPackBridgeTokensOrFallback(): Promise<BridgeTokenConfig[]> {
  try {
    return await fetchSonicChainPackBridgeTokens()
  } catch {
    return getBridgeTokenConfigs()
  }
}

/** Primary RPC URLs from the merged chain pack (matches Sonic docs public endpoints when synced). */
export async function fetchSonicChainPackPrimaryRpcs(): Promise<string[]> {
  try {
    const res = await fetch(chainPackJsonHref(), { cache: 'default' })
    if (!res.ok) return []
    const data = (await res.json()) as Record<string, { rpcUrls?: string[] } | undefined>
    const key = DEFAULT_NETWORK.chainId === 14601 ? 'sonicTestnet' : 'sonicMainnet'
    const urls = data[key]?.rpcUrls
    return Array.isArray(urls) ? urls.filter((u): u is string => typeof u === 'string' && u.length > 0) : []
  } catch {
    return []
  }
}

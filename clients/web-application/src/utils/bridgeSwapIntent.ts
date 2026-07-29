import type { PublicPoolConfig } from '@/config/liquidity'

const STORAGE_KEY = 'aegis:bridge-swap-intent-v1'
const LAST_APPLIED_GEN_KEY = 'aegis:bridge-swap-intent-applied-gen-v1'
const TTL_MS = 15 * 60 * 1000

export type BridgeSwapIntentPayload = {
  gen: string
  savedAt: number
  poolId?: string
  tokenSymbol?: string
  tokenAddress?: string | null
  amount?: string
  direction?: 'AGS_TO_QUOTE' | 'QUOTE_TO_AGS'
}

function newGen(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
}

/**
 * Call right before navigating to `/swap` (e.g. from Bridge). Survives refresh; consumed once on Swap.
 */
export function setBridgeSwapIntent(
  partial: Omit<BridgeSwapIntentPayload, 'gen' | 'savedAt'>
): void {
  try {
    const payload: BridgeSwapIntentPayload = {
      ...partial,
      gen: newGen(),
      savedAt: Date.now(),
    }
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
  } catch {
    // private mode / quota
  }
}

/**
 * Read and remove intent if it was not already applied (React Strict Mode / re-renders).
 */
export function consumeBridgeSwapIntentIfNew(): BridgeSwapIntentPayload | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const data = JSON.parse(raw) as BridgeSwapIntentPayload
    if (!data.gen || Date.now() - (data.savedAt || 0) > TTL_MS) {
      sessionStorage.removeItem(STORAGE_KEY)
      return null
    }
    const lastApplied = sessionStorage.getItem(LAST_APPLIED_GEN_KEY)
    if (lastApplied === data.gen) {
      return null
    }
    sessionStorage.setItem(LAST_APPLIED_GEN_KEY, data.gen)
    sessionStorage.removeItem(STORAGE_KEY)
    return data
  } catch {
    return null
  }
}

export function resolvePoolIdFromBridgeContext(
  pools: PublicPoolConfig[],
  opts: { poolId?: string; tokenSymbol?: string; tokenAddress?: string | null }
): string | null {
  if (opts.poolId && pools.some((p) => p.id === opts.poolId)) {
    return opts.poolId
  }
  if (opts.tokenAddress) {
    const a = opts.tokenAddress.toLowerCase()
    const hit = pools.find((p) => p.tokenAddress && p.tokenAddress.toLowerCase() === a)
    if (hit) return hit.id
  }
  if (opts.tokenSymbol) {
    const s = opts.tokenSymbol.replace(/[^A-Za-z0-9]/g, '').toUpperCase()
    const hit = pools.find((p) => {
      const sym = (p.tokenSymbol || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase()
      return sym === s || sym.includes(s) || p.id.toUpperCase() === s
    })
    return hit?.id ?? null
  }
  return null
}

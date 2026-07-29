/**
 * Primary RPC from `public/config/sonic-chain-pack.json` (synced from Aegis-contracts).
 * Matches Sonic Labs public endpoints when the pack is regenerated.
 */
export async function fetchChainPackPrimaryRpc(chainId: number): Promise<string | null> {
  try {
    const base = (import.meta.env.BASE_URL || '/').replace(/\/?$/, '/')
    const res = await fetch(`${base}config/sonic-chain-pack.json`, { cache: 'default' })
    if (!res.ok) return null
    const j = (await res.json()) as Record<string, { rpcUrls?: string[] } | undefined>
    const layer = chainId === 14601 ? j.sonicTestnet : j.sonicMainnet
    const u = layer?.rpcUrls?.[0]
    return typeof u === 'string' && u.startsWith('http') ? u : null
  } catch {
    return null
  }
}

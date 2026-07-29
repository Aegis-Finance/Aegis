/**
 * Shared helpers for Phase-A “public RPC” UX warnings (read-path metadata).
 */

export function isPublicSonicLabsReadRpc(url: string): boolean {
  try {
    const h = new URL(url.trim()).hostname.toLowerCase()
    if (h === '127.0.0.1' || h === 'localhost') return false
    const daoRaw = import.meta.env.VITE_DAO_RPC_URL?.trim()
    if (daoRaw) {
      try {
        if (new URL(daoRaw).hostname.toLowerCase() === h) return false
      } catch {
        /* ignore */
      }
    }
    return h.endsWith('soniclabs.com')
  } catch {
    return false
  }
}

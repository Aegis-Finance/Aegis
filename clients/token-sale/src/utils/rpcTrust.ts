const daoRpcUrl = import.meta.env.VITE_DAO_RPC_URL
  ? String(import.meta.env.VITE_DAO_RPC_URL).trim()
  : null

function daoRpcHostname(): string | null {
  if (!daoRpcUrl) return null
  try {
    return new URL(daoRpcUrl).hostname.toLowerCase()
  } catch {
    return null
  }
}

/**
 * Restrict persisted / custom RPC URLs to trusted hosts (mitigates malicious localStorage on shared devices).
 */
export function isHttpsOrLocalhost(url: string): boolean {
  try {
    const u = new URL(url)
    if (u.protocol === 'https:') return true
    if (u.protocol === 'http:' && (u.hostname === '127.0.0.1' || u.hostname === 'localhost')) return true
    return false
  } catch {
    return false
  }
}

import { isOperationalProfile } from './operationalProfile'

export function isTrustedRpcUrl(url: string): boolean {
  if (!isHttpsOrLocalhost(url)) return false
  try {
    const u = new URL(url)
    if (u.protocol === 'http:' && (u.hostname === '127.0.0.1' || u.hostname === 'localhost')) {
      return true
    }
    const h = u.hostname.toLowerCase()
    const daoHost = daoRpcHostname()
    if (daoHost && h === daoHost) return true
    if (isOperationalProfile()) {
      const extra = import.meta.env.VITE_TRUSTED_RPC_HOSTS as string | undefined
      if (extra) {
        const allow = new Set(
          extra
            .split(',')
            .map((s) => s.trim().toLowerCase())
            .filter(Boolean)
        )
        return allow.has(h)
      }
      return false
    }
    if (h.endsWith('.soniclabs.com')) return true
    const extra = import.meta.env.VITE_TRUSTED_RPC_HOSTS as string | undefined
    if (extra) {
      const allow = new Set(
        extra
          .split(',')
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean)
      )
      if (allow.has(h)) return true
    }
    return false
  } catch {
    return false
  }
}

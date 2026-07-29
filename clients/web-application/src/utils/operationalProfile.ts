/**
 * Operational / high-assurance build profile (native app bundle, sovereign node users).
 * Set `VITE_OPERATIONAL_PROFILE=1` at build time — mirrors sovereign-node-app posture.
 */

export function isOperationalProfile(): boolean {
  const profile = (import.meta.env.VITE_SECURITY_PROFILE as string | undefined)?.trim().toLowerCase()
  if (profile === 'operational') return true
  const flag = (import.meta.env.VITE_OPERATIONAL_PROFILE as string | undefined)?.trim().toLowerCase()
  return flag === '1' || flag === 'true' || flag === 'yes'
}

export const OPERATIONAL_SOVEREIGN_RPC = 'http://127.0.0.1:8547'
export const OPERATIONAL_DIRECT_RPC = 'http://127.0.0.1:8545'
export const OPERATIONAL_CIRCUITS_ORIGIN = 'http://127.0.0.1:8080'

export function operationalDefaultRpcUrl(): string {
  const explicit = (import.meta.env.VITE_RPC_URL as string | undefined)?.trim()
  if (explicit) return explicit
  const dao = (import.meta.env.VITE_DAO_RPC_URL as string | undefined)?.trim()
  if (dao) return dao
  return OPERATIONAL_SOVEREIGN_RPC
}

export function allowPublicSonicRpcInUi(): boolean {
  return !isOperationalProfile()
}

export function allowThirdPartyTranslate(): boolean {
  if (isOperationalProfile()) return false
  return import.meta.env.VITE_ENABLE_THIRD_PARTY_TRANSLATE === '1'
}

export function allowClientFingerprint(): boolean {
  if (isOperationalProfile()) return false
  return import.meta.env.VITE_ENABLE_CLIENT_FINGERPRINT === '1'
}

export function allowPrivacyTelemetry(): boolean {
  if (isOperationalProfile()) return false
  return import.meta.env.VITE_SHOW_LOCAL_PRIVACY_STATS === '1'
}

export function isPrivateReadRpc(url: string): boolean {
  try {
    const h = new URL(url.trim()).hostname.toLowerCase()
    if (h === '127.0.0.1' || h === 'localhost') return true
    const daoRaw = import.meta.env.VITE_DAO_RPC_URL?.trim()
    if (daoRaw) {
      try {
        if (new URL(daoRaw).hostname.toLowerCase() === h) return true
      } catch {
        /* ignore */
      }
    }
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

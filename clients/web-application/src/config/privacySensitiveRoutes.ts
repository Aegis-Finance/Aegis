/**
 * Routes where we avoid loading optional third-party widgets (e.g. Google Translate)
 * even when `VITE_ENABLE_THIRD_PARTY_TRANSLATE=1` — financial / ZK-heavy flows.
 *
 * See `docs/PRIVACY_DEFAULTS_AND_FINGERPRINTING.md` §6 and
 * `Aegis-contracts/docs/ops/PRIVACY_UX_LOCAL_STORAGE_AND_DEVICE.md`.
 */
const SENSITIVE_PATH_PREFIXES = [
  '/wallet',
  '/swap',
  '/lending',
  '/staking',
  '/insurance',
  '/yield-farming',
  '/derivatives',
  '/crowdfunding',
  '/staged-capital',
  '/bridge',
  '/governance',
  '/shielded-ecosystem',
] as const

export function isPrivacySensitiveRoute(pathname: string): boolean {
  const p = pathname.toLowerCase()
  for (const pre of SENSITIVE_PATH_PREFIXES) {
    if (p === pre || p.startsWith(`${pre}/`)) return true
  }
  return false
}

/**
 * Maps common on-chain reverts to operator-facing hints (Sonic / VerifierFactory alignment).
 */

function flattenContractError(err: unknown): string {
  if (err == null) return ''
  if (typeof err !== 'object') return String(err)
  const e = err as Record<string, unknown>
  const parts = [e.shortMessage, e.reason, e.message, e.data].filter(
    (x) => typeof x === 'string' && (x as string).trim().length > 0
  ) as string[]
  return parts.join(' ')
}

/**
 * Prefer a stable user/operator hint for known custom errors, else the best available message.
 */
export function formatContractErrorForToast(err: unknown, fallback: string): string {
  const raw = flattenContractError(err)
  if (/InvalidVerifier/i.test(raw)) {
    return (
      'Verifier missing or wrong layout on-chain. Register dedicated factory types per rail ' +
      '(mint-optimized, transfer-unshield, shielded-transfer, …) — not transfer-optimized as a substitute. ' +
      'See Aegis-contracts/docs/CIRCUIT_TO_CONTRACT_MAP.md'
    )
  }
  if (err instanceof Error && err.message.trim()) return err.message
  if (raw.trim()) return raw
  return fallback
}

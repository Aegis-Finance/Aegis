import { ZERO_ADDRESS } from '@/config/contracts'
import { isCircuitBundled, hasCircuitEnvPaths } from '@/config/circuitReadiness'

export function isContractConfigured(address: string | undefined | null): boolean {
  return Boolean(address && address !== ZERO_ADDRESS)
}

/** Remote Groth16 prover service (used when browser artifacts are not bundled). */
export function hasProverService(): boolean {
  const url = (import.meta.env.VITE_PROVER_URL as string | undefined)?.trim()
  return Boolean(url)
}

/** Any circuit artifact path, bundled index entry, or remote prover configured. */
export function hasLocalCircuitConfig(): boolean {
  if (hasProverService()) return true
  if (hasCircuitEnvPaths('transfer')) return true
  if (hasCircuitEnvPaths('staking')) return true
  if (hasCircuitEnvPaths('governance')) return true
  if (hasCircuitEnvPaths('farming')) return true
  if (hasCircuitEnvPaths('derivative')) return true
  if (hasCircuitEnvPaths('crowdfunding')) return true
  if (hasCircuitEnvPaths('insurance')) return true
  if (hasCircuitEnvPaths('private-amm')) return true
  if (isCircuitBundled('mint-optimized')) return true
  if (isCircuitBundled('transfer')) return true
  if (isCircuitBundled('staking')) return true
  return false
}

/** True when ZK actions can plausibly run (prover URL or circuit env/bundle configured). */
export function isZkProvingConfigured(): boolean {
  return hasProverService() || hasLocalCircuitConfig()
}

export function formatAprPercent(bps: number | bigint): string {
  const n = typeof bps === 'bigint' ? Number(bps) : bps
  return `${(n / 100).toFixed(2)}%`
}

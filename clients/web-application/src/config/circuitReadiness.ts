import manifest from '@/config/verifier-artifact-manifest.json'
import bundleIndex from '@/config/circuit-bundle-index.json'

type ManifestEntry = {
  circuitType: string
  onChainVerifierAddress?: string
  localGroth16Artifacts: { wasmPath?: string; zkeyPath?: string } | null
  /** When false, bundled zkey is dev ceremony — proofs fail against mainnet verifier. */
  zkeyMatchesStagedVk?: boolean | null
}

type BundleIndex = {
  circuits?: Record<string, { wasm?: string; zkey?: string }>
}

const manifestEntries = (manifest as { circuits?: ManifestEntry[] }).circuits ?? []
const bundledSlugs = new Set(Object.keys((bundleIndex as BundleIndex).circuits ?? {}))

/** Env keys that override default `/circuits/<slug>/…` paths (subset — extend as gen-env adds more). */
const CIRCUIT_ENV_KEYS: Record<string, { wasm?: string; zkey?: string }> = {
  transfer: { wasm: 'VITE_TRANSFER_WASM', zkey: 'VITE_TRANSFER_ZKEY' },
  'mint-optimized': { wasm: 'VITE_MINT_OPTIMIZED_WASM', zkey: 'VITE_MINT_OPTIMIZED_ZKEY' },
  'transfer-unshield': { wasm: 'VITE_TRANSFER_UNSHIELD_WASM', zkey: 'VITE_TRANSFER_UNSHIELD_ZKEY' },
  governance: { wasm: 'VITE_GOVERNANCE_WASM', zkey: 'VITE_GOVERNANCE_ZKEY' },
  staking: { wasm: 'VITE_STAKING_WASM', zkey: 'VITE_STAKING_ZKEY' },
  reward: { wasm: 'VITE_REWARD_WASM', zkey: 'VITE_REWARD_ZKEY' },
  farming: { wasm: 'VITE_FARMING_WASM', zkey: 'VITE_FARMING_ZKEY' },
  derivative: { wasm: 'VITE_DERIVATIVE_WASM', zkey: 'VITE_DERIVATIVE_ZKEY' },
  crowdfunding: { wasm: 'VITE_CROWDFUNDING_WASM', zkey: 'VITE_CROWDFUNDING_ZKEY' },
  insurance: { wasm: 'VITE_INSURANCE_WASM', zkey: 'VITE_INSURANCE_ZKEY' },
  'private-amm': { wasm: 'VITE_PRIVATE_AMM_WASM', zkey: 'VITE_PRIVATE_AMM_ZKEY' },
  'selective-disclosure': { wasm: 'VITE_SELECTIVE_DISCLOSURE_WASM', zkey: 'VITE_SELECTIVE_DISCLOSURE_ZKEY' },
  'stealth-address': { wasm: 'VITE_STEALTH_ADDRESS_WASM', zkey: 'VITE_STEALTH_ADDRESS_ZKEY' },
  'private-stable': { wasm: 'VITE_PRIVATE_STABLE_WASM', zkey: 'VITE_PRIVATE_STABLE_ZKEY' },
  'credit-profile': { wasm: 'VITE_CREDIT_PROFILE_WASM', zkey: 'VITE_CREDIT_PROFILE_ZKEY' },
  'private-bond': { wasm: 'VITE_PRIVATE_BOND_WASM', zkey: 'VITE_PRIVATE_BOND_ZKEY' },
  'prediction-market': { wasm: 'VITE_PREDICTION_MARKET_WASM', zkey: 'VITE_PREDICTION_MARKET_ZKEY' },
  payroll: { wasm: 'VITE_PAYROLL_WASM', zkey: 'VITE_PAYROLL_ZKEY' },
  savings: { wasm: 'VITE_SAVINGS_WASM', zkey: 'VITE_SAVINGS_ZKEY' },
  'treasury-shield': { wasm: 'VITE_TREASURY_SHIELD_WASM', zkey: 'VITE_TREASURY_SHIELD_ZKEY' },
  'lending-tenor': { wasm: 'VITE_LENDING_TENOR_WASM', zkey: 'VITE_LENDING_TENOR_ZKEY' },
  'lending-liquidity': { wasm: 'VITE_LENDING_LIQUIDITY_WASM', zkey: 'VITE_LENDING_LIQUIDITY_ZKEY' },
  'lending-repay': { wasm: 'VITE_LENDING_REPAY_WASM', zkey: 'VITE_LENDING_REPAY_ZKEY' },
  'lending-withdraw': { wasm: 'VITE_LENDING_WITHDRAW_WASM', zkey: 'VITE_LENDING_WITHDRAW_ZKEY' },
  'lending-liquidate': { wasm: 'VITE_LENDING_LIQUIDATE_WASM', zkey: 'VITE_LENDING_LIQUIDATE_ZKEY' },
}

function envConfigured(key: string | undefined): boolean {
  if (!key) return false
  const v = (import.meta.env[key] as string | undefined)?.trim()
  return Boolean(v)
}

function hasProverService(): boolean {
  const url = (import.meta.env.VITE_PROVER_URL as string | undefined)?.trim()
  return Boolean(url)
}

export function isCircuitBundled(slug: string): boolean {
  return bundledSlugs.has(slug)
}

export function hasCircuitEnvPaths(slug: string): boolean {
  const keys = CIRCUIT_ENV_KEYS[slug]
  if (!keys) return false
  return envConfigured(keys.wasm) || envConfigured(keys.zkey)
}

export function manifestHasLocalArtifacts(slug: string): boolean {
  const entry = manifestEntries.find((v) => v.circuitType === slug)
  return Boolean(entry?.localGroth16Artifacts?.wasmPath && entry?.localGroth16Artifacts?.zkeyPath)
}

export function manifestZkeyAligned(slug: string): boolean {
  const entry = manifestEntries.find((v) => v.circuitType === slug)
  if (entry?.zkeyMatchesStagedVk === true) return true
  if (entry?.zkeyMatchesStagedVk === false) return false
  // Legacy manifest without flag: assume bundled artifact is OK if present
  return Boolean(entry?.localGroth16Artifacts?.zkeyPath)
}

/** True when in-browser Groth16 can plausibly run for this circuit slug. */
export function isCircuitProvingReady(slug: string): boolean {
  if (hasProverService()) return true
  if (isCircuitBundled(slug) && manifestZkeyAligned(slug)) return true
  if (hasCircuitEnvPaths(slug)) return true
  if (manifestHasLocalArtifacts(slug) && manifestZkeyAligned(slug)) return true
  return false
}

/** On-chain verifiers without production-aligned proving artifacts. */
export function listZkGaps(): string[] {
  return manifestEntries
    .filter((e) => e.onChainVerifierAddress && !isCircuitProvingReady(e.circuitType))
    .map((e) => e.circuitType)
}

/** Bundled or in build/ but zkey does not match staged production VK (dev keys). */
export function listVkMisaligned(): string[] {
  return manifestEntries
    .filter((e) => e.onChainVerifierAddress && e.zkeyMatchesStagedVk === false)
    .map((e) => e.circuitType)
}

export function circuitZkGapLabel(slug: string): string | null {
  if (isCircuitProvingReady(slug)) return null
  if (hasProverService()) return null
  return `Circuit "${slug}" needs production zkey (copy from ceremony) or VITE_PROVER_URL`
}

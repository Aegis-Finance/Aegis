import manifest from '@/config/verifier-artifact-manifest.json'
import { ZERO_ADDRESS } from '@/config/contracts'

type ManifestJson = {
  latestDeploymentContracts?: Record<string, string>
}

const manifestContracts =
  (manifest as ManifestJson).latestDeploymentContracts ?? {}

/** Sync read of addresses baked in at build from `src/config/verifier-artifact-manifest.json`. */
export function getManifestContract(name: string): string | null {
  const addr = manifestContracts[name]
  if (!addr || addr === ZERO_ADDRESS) return null
  return addr
}

/** Env wins; otherwise manifest (for local dev without regenerating `.env`). */
export function resolveDeployedAddress(envKey: string, manifestKey: string): string | null {
  const fromEnv = (import.meta.env[envKey] as string | undefined)?.trim()
  if (fromEnv && fromEnv !== ZERO_ADDRESS) return fromEnv
  return getManifestContract(manifestKey)
}

export function resolvePrivateDerivativesAddress(): string | null {
  return resolveDeployedAddress('VITE_DERIVATIVES_ADDRESS', 'PrivateDerivatives')
}

export function resolvePoolPriceValidatorAddress(): string | null {
  return resolveDeployedAddress('VITE_POOL_PRICE_VALIDATOR_ADDRESS', 'PoolPriceValidatorEnhanced')
}

export function resolveMultiOracleAggregatorAddress(): string | null {
  return resolveDeployedAddress('VITE_MULTI_ORACLE_AGGREGATOR_ADDRESS', 'MultiOracleAggregator')
}

export function resolvePrivacyEntryRouterAddress(): string | null {
  const a = resolveDeployedAddress('VITE_PRIVACY_ENTRY_ROUTER_ADDRESS', 'PrivacyEntryRouter')
  if (!a || !/^0x[a-fA-F0-9]{40}$/i.test(a)) return null
  return a
}

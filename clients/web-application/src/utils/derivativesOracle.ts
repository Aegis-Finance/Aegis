import { Contract, Provider, Signer, ZeroAddress, id } from 'ethers'
import { resolveMultiOracleAggregatorAddress } from '@/utils/deploymentManifest'

/** Matches on-chain `MAX_PRICE_STALENESS` (1 hour) in oracle modules. */
export const ORACLE_MAX_STALENESS_SEC = 3600

const DERIVATIVES_ORACLE_ABI = [
  'function getAssetPrice(bytes32 asset) view returns (uint256 price, uint256 timestamp)',
  'function useMultiOracle(bytes32) view returns (bool)',
  'function multiOracleAggregators(bytes32) view returns (address)',
  'function oracleConfigs(bytes32) view returns (uint256 count, uint256 requiredConfirmations)',
  'function updatePriceFromOracle(bytes32 asset)',
] as const

export type DerivativesOracleStatus = {
  assetId: string
  assetLabel: string
  price: bigint
  timestamp: number
  ageSec: number | null
  stale: boolean
  priceMissing: boolean
  useMultiOracle: boolean
  multiOracleAggregator: string | null
  manifestMultiOracleAggregator: string | null
  legacyOracleCount: number
  requiredConfirmations: number
  feedsWired: boolean
}

export function defaultUnderlyingAssetLabel(assetId: string): string {
  if (assetId.toLowerCase() === id('AGS/SONIC').toLowerCase()) return 'AGS/SONIC'
  return `${assetId.slice(0, 10)}…${assetId.slice(-8)}`
}

export async function fetchDerivativesOracleStatus(
  provider: Provider,
  derivativesAddress: string,
  assetId: string
): Promise<DerivativesOracleStatus> {
  const c = new Contract(derivativesAddress, DERIVATIVES_ORACLE_ABI, provider)
  const nowSec = Math.floor(Date.now() / 1000)

  const [priceRow, useMulti, aggregator, config] = await Promise.all([
    c.getAssetPrice(assetId),
    c.useMultiOracle(assetId).catch(() => false),
    c.multiOracleAggregators(assetId).catch(() => ZeroAddress),
    c.oracleConfigs(assetId).catch(() => [0n, 0n]),
  ])

  const price = BigInt(priceRow?.price ?? priceRow?.[0] ?? 0)
  const timestamp = Number(priceRow?.timestamp ?? priceRow?.[1] ?? 0)
  const legacyOracleCount = Number(config?.count ?? config?.[0] ?? 0)
  const requiredConfirmations = Number(config?.requiredConfirmations ?? config?.[1] ?? 0)
  const aggAddr = String(aggregator ?? ZeroAddress)
  const multiOracleAggregator =
    aggAddr !== ZeroAddress && aggAddr.toLowerCase() !== '0x0000000000000000000000000000000000000000'
      ? aggAddr
      : null

  const ageSec = timestamp > 0 ? Math.max(0, nowSec - timestamp) : null
  const stale = timestamp > 0 ? (ageSec ?? 0) > ORACLE_MAX_STALENESS_SEC : true
  const priceMissing = price <= 0n
  const feedsWired =
    Boolean(useMulti && multiOracleAggregator) || legacyOracleCount > 0 || (!priceMissing && timestamp > 0)

  return {
    assetId,
    assetLabel: defaultUnderlyingAssetLabel(assetId),
    price,
    timestamp,
    ageSec,
    stale,
    priceMissing,
    useMultiOracle: Boolean(useMulti),
    multiOracleAggregator,
    manifestMultiOracleAggregator: resolveMultiOracleAggregatorAddress(),
    legacyOracleCount,
    requiredConfirmations,
    feedsWired,
  }
}

export function getDerivativesOracleContract(
  derivativesAddress: string,
  runner: Provider | Signer
): Contract {
  return new Contract(derivativesAddress, DERIVATIVES_ORACLE_ABI, runner)
}

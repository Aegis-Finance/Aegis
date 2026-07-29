import { Contract, Provider, formatUnits, id, parseUnits } from 'ethers'
import { resolvePrivateDerivativesAddress } from '@/utils/deploymentManifest'
import {
  blackScholesTotalPremium,
  parseRatePercentEnv,
  parseVolPercentEnv,
  secondsToYearFraction,
  type BlackScholesInputs,
  type OptionSide,
} from './blackScholes'

/** Matches `PrivateDerivatives.DerivativeType` enum ordinals. */
export const DERIVATIVE_TYPE = {
  CALL_OPTION: 0,
  PUT_OPTION: 1,
  FUTURE: 2,
} as const

export type DerivativeTypeId = (typeof DERIVATIVE_TYPE)[keyof typeof DERIVATIVE_TYPE]

export function derivativeTypeToOptionSide(type: DerivativeTypeId): OptionSide | null {
  if (type === DERIVATIVE_TYPE.CALL_OPTION) return 'call'
  if (type === DERIVATIVE_TYPE.PUT_OPTION) return 'put'
  return null
}

export type PricingGuidance = {
  spotWei: bigint
  strikeWei: bigint
  notionalWei: bigint
  secondsToExpiry: number
  intrinsicWei: bigint
  collateralWei: bigint
  bsTotalPremiumWei: bigint | null
  bsPerUnit: number
  intrinsicPerUnit: number
  timeValuePerUnit: number
  userPremiumWei: bigint
  premiumVsFairBps: number | null
  inTheMoney: boolean
}

export type PricingGuidanceParams = {
  derivativeType: DerivativeTypeId
  strikeWei: bigint
  notionalWei: bigint
  spotWei: bigint
  expiryTimestamp: number
  nowSec?: number
  userPremiumWei?: bigint
  volatility?: number
  riskFreeRate?: number
}

const DERIVATIVES_ABI_PREVIEW = [
  'function previewIntrinsicPayoff(uint8 derivativeType, uint256 strikePrice, uint256 notionalAmount, uint256 spotPrice) view returns (uint256)',
  'function previewRequiredCollateral(uint8 derivativeType, uint256 notionalAmount, uint256 strikePrice, uint256 spotPrice) view returns (uint256)',
  'function getAssetPrice(bytes32 asset) view returns (uint256 price, uint256 timestamp)',
  'function nextContractId() view returns (uint256)',
  'function totalValueLocked() view returns (uint256)',
  'function protocolFees() view returns (uint256)',
] as const

export function getDefaultDerivativeVolatility(): number {
  return parseVolPercentEnv(import.meta.env.VITE_DERIVATIVES_DEFAULT_VOL_PCT as string | undefined, 80)
}

export function getDefaultRiskFreeRate(): number {
  return parseRatePercentEnv(import.meta.env.VITE_DERIVATIVES_DEFAULT_RISK_FREE_PCT as string | undefined, 3)
}

/** Default asset id for oracle spot — `keccak256("AGS/SONIC")` when unset. */
export function getDefaultUnderlyingAssetId(): string {
  const raw = (import.meta.env.VITE_DERIVATIVES_UNDERLYING_ASSET_ID as string | undefined)?.trim()
  if (raw && /^0x[0-9a-fA-F]{64}$/.test(raw)) return raw
  return id('AGS/SONIC')
}

/** Resolve deployed `PrivateDerivatives` from env or build-time manifest. */
export async function resolveDerivativesAddress(): Promise<string | null> {
  return resolvePrivateDerivativesAddress()
}

export function getDerivativesPreviewContract(address: string, provider: Provider): Contract {
  return new Contract(address, DERIVATIVES_ABI_PREVIEW, provider)
}

/**
 * Combine on-chain intrinsic/collateral previews with off-chain Black–Scholes fair value.
 */
export async function buildPricingGuidance(
  derivativesAddress: string,
  provider: Provider,
  params: PricingGuidanceParams
): Promise<PricingGuidance> {
  const {
    derivativeType,
    strikeWei,
    notionalWei,
    spotWei,
    expiryTimestamp,
    nowSec = Math.floor(Date.now() / 1000),
    userPremiumWei = 0n,
    volatility = getDefaultDerivativeVolatility(),
    riskFreeRate = getDefaultRiskFreeRate(),
  } = params

  const contract = getDerivativesPreviewContract(derivativesAddress, provider)
  const [intrinsicWei, collateralWei] = await Promise.all([
    contract.previewIntrinsicPayoff(derivativeType, strikeWei, notionalWei, spotWei),
    contract.previewRequiredCollateral(derivativeType, notionalWei, strikeWei, spotWei),
  ])

  const secondsToExpiry = Math.max(0, expiryTimestamp - nowSec)
  const optionSide = derivativeTypeToOptionSide(derivativeType)
  const spot = Number(formatUnits(spotWei, 18))
  const strike = Number(formatUnits(strikeWei, 18))
  const notionalTokens = Number(formatUnits(notionalWei, 18))

  let bsTotalPremiumWei: bigint | null = null
  let bsPerUnit = NaN
  let intrinsicPerUnit = NaN
  let timeValuePerUnit = NaN

  if (optionSide) {
    const bsInputs: BlackScholesInputs = {
      optionType: optionSide,
      spot,
      strike,
      timeYears: secondsToYearFraction(secondsToExpiry),
      volatility,
      riskFreeRate,
    }
    const bs = blackScholesTotalPremium(bsInputs, notionalTokens)
    bsPerUnit = bs.pricePerUnit
    intrinsicPerUnit = bs.intrinsicPerUnit
    timeValuePerUnit = bs.timeValuePerUnit
    if (Number.isFinite(bs.totalPremium) && bs.totalPremium >= 0) {
      try {
        bsTotalPremiumWei = parseUnits(bs.totalPremium.toFixed(18), 18)
      } catch {
        bsTotalPremiumWei = null
      }
    }
  }

  let premiumVsFairBps: number | null = null
  if (bsTotalPremiumWei != null && bsTotalPremiumWei > 0n && userPremiumWei > 0n) {
    const diff = userPremiumWei - bsTotalPremiumWei
    premiumVsFairBps = Number((diff * 10000n) / bsTotalPremiumWei)
  }

  return {
    spotWei,
    strikeWei,
    notionalWei,
    secondsToExpiry,
    intrinsicWei: BigInt(intrinsicWei),
    collateralWei: BigInt(collateralWei),
    bsTotalPremiumWei,
    bsPerUnit,
    intrinsicPerUnit,
    timeValuePerUnit,
    userPremiumWei,
    premiumVsFairBps,
    inTheMoney: BigInt(intrinsicWei) > 0n,
  }
}

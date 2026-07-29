/**
 * Off-chain Black–Scholes reference for European options.
 * Used by the Arweave dApp for fair-value guidance only — on-chain settlement stays bilateral OTC.
 */

export type OptionSide = 'call' | 'put'

export type BlackScholesInputs = {
  optionType: OptionSide
  /** Spot price in quote per 1 unit of underlying (decimal, not wei). */
  spot: number
  strike: number
  /** Time to expiry in years (e.g. 30d → 30/365). */
  timeYears: number
  /** Annualized volatility as decimal (0.8 = 80%). */
  volatility: number
  /** Annual risk-free rate as decimal (0.03 = 3%). */
  riskFreeRate: number
}

export type BlackScholesResult = {
  /** Fair value per 1 unit of underlying (same quote denomination as spot/strike). */
  pricePerUnit: number
  intrinsicPerUnit: number
  timeValuePerUnit: number
  d1: number
  d2: number
}

/** Standard normal CDF — Abramowitz & Stegun 26.2.17 (adequate for UI guidance). */
export function normalCdf(x: number): number {
  if (!Number.isFinite(x)) return NaN
  const sign = x < 0 ? -1 : 1
  const ax = Math.abs(x) / Math.SQRT2
  const t = 1 / (1 + 0.3275911 * ax)
  const a1 = 0.254829592
  const a2 = -0.284496736
  const a3 = 1.421413741
  const a4 = -1.453152027
  const a5 = 1.061405429
  const erf =
    1 -
    (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax))
  return 0.5 * (1 + sign * erf)
}

export function intrinsicPerUnit(optionType: OptionSide, spot: number, strike: number): number {
  if (optionType === 'call') return Math.max(0, spot - strike)
  return Math.max(0, strike - spot)
}

/**
 * European Black–Scholes price per unit of underlying.
 * At expiry (T ≤ 0) returns intrinsic value only.
 */
export function blackScholesPerUnit(inputs: BlackScholesInputs): BlackScholesResult {
  const { optionType, spot: S, strike: K, timeYears: T, volatility: sigma, riskFreeRate: r } = inputs
  const intrinsic = intrinsicPerUnit(optionType, S, K)

  if (T <= 0 || !Number.isFinite(T)) {
    return { pricePerUnit: intrinsic, intrinsicPerUnit: intrinsic, timeValuePerUnit: 0, d1: NaN, d2: NaN }
  }
  if (S <= 0 || K <= 0 || sigma <= 0 || !Number.isFinite(S) || !Number.isFinite(K)) {
    return { pricePerUnit: NaN, intrinsicPerUnit: intrinsic, timeValuePerUnit: NaN, d1: NaN, d2: NaN }
  }

  const sqrtT = Math.sqrt(T)
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * sqrtT)
  const d2 = d1 - sigma * sqrtT
  const disc = Math.exp(-r * T)

  let price: number
  if (optionType === 'call') {
    price = S * normalCdf(d1) - K * disc * normalCdf(d2)
  } else {
    price = K * disc * normalCdf(-d2) - S * normalCdf(-d1)
  }

  const clamped = Math.max(price, intrinsic)
  return {
    pricePerUnit: clamped,
    intrinsicPerUnit: intrinsic,
    timeValuePerUnit: clamped - intrinsic,
    d1,
    d2,
  }
}

/** Total contract premium in quote units: per-unit BS × token amount. */
export function blackScholesTotalPremium(
  inputs: BlackScholesInputs,
  notionalTokens: number
): BlackScholesResult & { totalPremium: number } {
  const per = blackScholesPerUnit(inputs)
  const totalPremium = Number.isFinite(per.pricePerUnit) ? per.pricePerUnit * notionalTokens : NaN
  return { ...per, totalPremium }
}

/** Seconds until expiry → year fraction for BS. */
export function secondsToYearFraction(seconds: number): number {
  if (seconds <= 0) return 0
  return seconds / (365 * 24 * 60 * 60)
}

/** Parse env default vol (percent, e.g. "80") → decimal. */
export function parseVolPercentEnv(raw: string | undefined, fallbackPercent = 80): number {
  const n = raw != null && raw.trim() !== '' ? Number(raw) : fallbackPercent
  if (!Number.isFinite(n) || n <= 0) return fallbackPercent / 100
  return n / 100
}

/** Parse env default risk-free rate (percent) → decimal. */
export function parseRatePercentEnv(raw: string | undefined, fallbackPercent = 3): number {
  const n = raw != null && raw.trim() !== '' ? Number(raw) : fallbackPercent
  if (!Number.isFinite(n) || n < 0) return fallbackPercent / 100
  return n / 100
}

import { Contract, formatUnits, parseUnits } from 'ethers'
import type { Provider } from 'ethers'

import { CONTRACT_ADDRESSES, DEFAULT_NETWORK } from '@/config/contracts'
import {
  fetchCanonicalAgsPerWs,
  isCanonicalV3Active,
  wrappedNativeAddress,
} from '@/utils/canonicalSwap'
import { odosQuoteV3 } from '@/utils/odosSor'

const DUTCH_AUCTION_ADDRESS = (import.meta.env.VITE_AUCTION_ADDRESS as string | undefined)?.trim()
const ZERO_POOL = '0x0000000000000000000000000000000000000000'
const BURN_ADDR = '0x000000000000000000000000000000000000dEaD'

const DUTCH_AUCTION_ABI = [
  'function getCurrentPrice() view returns (uint256)',
  'function isActive() view returns (bool)',
  'function startPrice() view returns (uint256)',
  'function reservePrice() view returns (uint256)',
] as const

export type AgsPriceSource =
  | 'uniswap-v3'
  | 'odos'
  | 'dutch-auction'
  | 'bootstrap-pool'
  | 'none'

export type AgsReferencePrice = {
  /** Whole AGS tokens received for 1 native S (or 1 wS). */
  agsPerOneNative: number | null
  /** Native S (or wS) per 1 AGS. */
  nativePerOneAgs: number | null
  source: AgsPriceSource
  sourceLabel: string
  detail?: string
  /** Thin bootstrap pool mid-price — execution venue only, not market reference. */
  bootstrapAgsPerNative?: number | null
}

function finitePositive(n: number | null | undefined): n is number {
  return n != null && Number.isFinite(n) && n > 0
}

async function fetchV3Reference(provider: Provider): Promise<AgsReferencePrice | null> {
  if (!(await isCanonicalV3Active(provider))) return null
  const agsPerWs = await fetchCanonicalAgsPerWs(provider)
  if (!agsPerWs) return null
  const agsPerOneNative = Number(agsPerWs)
  if (!finitePositive(agsPerOneNative)) return null
  return {
    agsPerOneNative,
    nativePerOneAgs: 1 / agsPerOneNative,
    source: 'uniswap-v3',
    sourceLabel: 'Uniswap v3 (canonical)',
    detail: 'Single on-chain AGS/S venue after TGE liquidity seed.',
  }
}

async function fetchOdosReference(provider: Provider): Promise<AgsReferencePrice | null> {
  const ws = wrappedNativeAddress()
  const ags = CONTRACT_ADDRESSES.TOKEN
  if (!ws || !ags) return null
  try {
    const net = await provider.getNetwork()
    const oneWs = parseUnits('1', 18)
    const quote = await odosQuoteV3({
      chainId: Number(net.chainId),
      userAddr: BURN_ADDR,
      inputTokenAddress: ws,
      inputAmount: oneWs.toString(),
      outputTokenAddress: ags,
      slippageLimitPercent: 1,
    })
    const out = BigInt(quote.outAmounts[0] ?? '0')
    if (out <= 0n) return null
    const agsPerOneNative = Number(formatUnits(out, 18))
    if (!finitePositive(agsPerOneNative)) return null
    return {
      agsPerOneNative,
      nativePerOneAgs: 1 / agsPerOneNative,
      source: 'odos',
      sourceLabel: 'Sonic DEX aggregate (Odos)',
      detail: 'Best-effort quote across external Sonic liquidity; used for swaps when deeper than bootstrap pool.',
    }
  } catch {
    return null
  }
}

async function fetchAuctionReference(provider: Provider): Promise<AgsReferencePrice | null> {
  if (!DUTCH_AUCTION_ADDRESS || DUTCH_AUCTION_ADDRESS === ZERO_POOL) return null
  try {
    const auction = new Contract(DUTCH_AUCTION_ADDRESS, DUTCH_AUCTION_ABI, provider)
    const [priceWei, active] = await Promise.all([
      auction.getCurrentPrice() as Promise<bigint>,
      auction.isActive() as Promise<boolean>,
    ])
    if (!priceWei || priceWei === 0n) return null
    const sPerAgs = Number(formatUnits(priceWei, 18))
    if (!finitePositive(sPerAgs)) return null
    const agsPerOneNative = 1 / sPerAgs
    return {
      agsPerOneNative,
      nativePerOneAgs: sPerAgs,
      source: 'dutch-auction',
      sourceLabel: active ? 'Dutch auction (live)' : 'Dutch auction (TGE reference)',
      detail: active
        ? 'Marginal sale price on-chain during the active Dutch window.'
        : 'Sale not open yet — spot follows start price until Step E activation.',
    }
  } catch {
    return null
  }
}

async function fetchBootstrapPoolMid(
  provider: Provider,
  poolAddress: string | undefined
): Promise<number | null> {
  if (!poolAddress) return null
  try {
    const pool = new Contract(
      poolAddress,
      ['function quoteSwap(bool agsToQuote, uint256 amountIn) view returns (uint256)'],
      provider
    )
    const oneS = parseUnits('1', 18)
    const agsOut = (await pool.quoteSwap(false, oneS)) as bigint
    if (!agsOut || agsOut <= 0n) return null
    const n = Number(formatUnits(agsOut, 18))
    return finitePositive(n) ? n : null
  } catch {
    return null
  }
}

/**
 * Single AGS/S reference for UI — never promotes thin bootstrap pool reserves as "the market price".
 * Priority: Uniswap v3 (post-seed) → Odos aggregate → Dutch auction TGE curve → none.
 */
export async function fetchAgsReferencePrice(
  provider: Provider,
  bootstrapPoolAddress?: string
): Promise<AgsReferencePrice> {
  const bootstrapAgsPerNative = await fetchBootstrapPoolMid(provider, bootstrapPoolAddress)

  const v3 = await fetchV3Reference(provider)
  if (v3) {
    return { ...v3, bootstrapAgsPerNative }
  }

  const odos = await fetchOdosReference(provider)
  if (odos) {
    return { ...odos, bootstrapAgsPerNative }
  }

  const auction = await fetchAuctionReference(provider)
  if (auction) {
    return { ...auction, bootstrapAgsPerNative }
  }

  if (finitePositive(bootstrapAgsPerNative)) {
    return {
      agsPerOneNative: bootstrapAgsPerNative,
      nativePerOneAgs: 1 / bootstrapAgsPerNative,
      source: 'bootstrap-pool',
      sourceLabel: 'Bootstrap pool only',
      detail: 'Thin internal liquidity — not a market price. Prefer Auto/Odos or wait for TGE v3 seed.',
      bootstrapAgsPerNative,
    }
  }

  return {
    agsPerOneNative: null,
    nativePerOneAgs: null,
    source: 'none',
    sourceLabel: 'Unavailable',
    detail: `Connect wallet on ${DEFAULT_NETWORK.name} to load reference pricing.`,
  }
}

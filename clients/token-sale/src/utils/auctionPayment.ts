/**
 * Dutch auction payment rails — mirrors on-chain `AutomatedDutchAuction` TGE pegs.
 * @see Aegis-contracts/docs/tokendistribution/DUTCH_AUCTION_S_PRICING.md
 */
import { Contract, ZeroAddress, parseUnits, type Provider, type Signer } from 'ethers'
import type { InterfaceAbi } from 'ethers'
import auctionArtifact from '../abis/AutomatedDutchAuction.json'
import bridgeTokens from '../config/bridge-tokens.json'

export type PayRailSymbol = 'S' | 'wS' | 'WETH' | 'USDC' | 'USDT' | 'EURC'

export type PayRail = {
  symbol: PayRailSymbol
  /** `null` for native S (`msg.value`). */
  tokenAddress: string | null
  decimals: number
  /** Auction contract has a non-zero immutable `payToken*` for this ERC-20 rail. */
  configuredOnChain: boolean
}

const ERC20_ABI = [
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function allowance(address owner, address spender) external view returns (uint256)',
] as const

const ZERO = ZeroAddress

type PackRow = { tokenSymbol: string; tokenAddress: string; enabled?: boolean }

function isZeroAddress(addr: string | null | undefined): boolean {
  if (!addr) return true
  return addr.toLowerCase() === ZERO.toLowerCase()
}

function packRowsForChain(chainId: number): PackRow[] {
  if (chainId === 14601) return bridgeTokens.sonicTestnet as PackRow[]
  return bridgeTokens.sonic as PackRow[]
}

async function fetchPackRows(chainId: number): Promise<PackRow[]> {
  try {
    const base = (import.meta.env.BASE_URL || '/').replace(/\/?$/, '/')
    const res = await fetch(`${base}config/sonic-chain-pack.json`, { cache: 'default' })
    if (!res.ok) return packRowsForChain(chainId)
    const j = (await res.json()) as {
      sonicMainnet?: { bridgeTokens?: PackRow[] }
      sonicTestnet?: { bridgeTokens?: PackRow[] }
    }
    const layer = chainId === 14601 ? j.sonicTestnet : j.sonicMainnet
    return layer?.bridgeTokens ?? packRowsForChain(chainId)
  } catch {
    return packRowsForChain(chainId)
  }
}

function packAddressBySymbol(rows: PackRow[], symbol: PayRailSymbol): string | undefined {
  const row = rows.find(
    (r) =>
      r.enabled !== false &&
      r.tokenSymbol.toUpperCase() === symbol.toUpperCase() &&
      !isZeroAddress(r.tokenAddress)
  )
  return row?.tokenAddress
}

export function decimalsForPaySymbol(symbol: PayRailSymbol): number {
  if (symbol === 'USDC' || symbol === 'USDT' || symbol === 'EURC') return 6
  return 18
}

/** Fixed TGE peg: ERC-20 payment → wei S equivalent (matches contract). */
export function sWeiFromErc20Payment(symbol: PayRailSymbol, tokenAmountWei: bigint): bigint {
  if (symbol === 'wS') return tokenAmountWei
  if (symbol === 'WETH') return (tokenAmountWei * 50_000n * 10n ** 18n) / 10n ** 18n
  if (symbol === 'USDC' || symbol === 'USDT' || symbol === 'EURC') {
    return (tokenAmountWei * 49n * 10n ** 18n) / 10n ** 6n
  }
  return 0n
}

/** Expected AGS out for a payment amount at the current Dutch spot price. */
export function agsOutFromPayment(
  symbol: PayRailSymbol,
  payAmountWei: bigint,
  currentPriceWeiPerAgs: bigint
): bigint {
  if (currentPriceWeiPerAgs === 0n) return 0n
  const sWei = symbol === 'S' ? payAmountWei : sWeiFromErc20Payment(symbol, payAmountWei)
  return (sWei * 10n ** 18n) / currentPriceWeiPerAgs
}

export async function fetchPayRails(
  provider: Provider,
  auctionAddress: string,
  chainId: number
): Promise<PayRail[]> {
  const contract = new Contract(auctionAddress, auctionArtifact.abi as InterfaceAbi, provider)
  const [ws, weth, usdc, usdt, eurc, packRows] = await Promise.all([
    contract.payTokenWs(),
    contract.payTokenWeth(),
    contract.payTokenUsdc(),
    contract.payTokenUsdt(),
    contract.payTokenEurc(),
    fetchPackRows(chainId),
  ])

  const onChainBySymbol: Record<Exclude<PayRailSymbol, 'S'>, string> = {
    wS: String(ws),
    WETH: String(weth),
    USDC: String(usdc),
    USDT: String(usdt),
    EURC: String(eurc),
  }

  const rails: PayRail[] = [{ symbol: 'S', tokenAddress: null, decimals: 18, configuredOnChain: true }]

  for (const symbol of AUCTION_PAY_SYMBOLS) {
    if (symbol === 'S') continue
    const onChain = onChainBySymbol[symbol]
    const configuredOnChain = !isZeroAddress(onChain)
    const packAddr = packAddressBySymbol(packRows, symbol)
    const tokenAddress = configuredOnChain ? onChain : packAddr
    if (!tokenAddress || isZeroAddress(tokenAddress)) continue
    rails.push({
      symbol,
      tokenAddress,
      decimals: decimalsForPaySymbol(symbol),
      configuredOnChain: configuredOnChain || Boolean(packAddr),
    })
  }

  return rails
}

/** Static fallback before the pay-rails query resolves. */
export function defaultPayRails(chainId: number): PayRail[] {
  const packRows = packRowsForChain(chainId)
  const rails: PayRail[] = [{ symbol: 'S', tokenAddress: null, decimals: 18, configuredOnChain: true }]
  for (const symbol of AUCTION_PAY_SYMBOLS) {
    if (symbol === 'S') continue
    const tokenAddress = packAddressBySymbol(packRows, symbol)
    if (!tokenAddress) continue
    rails.push({
      symbol,
      tokenAddress,
      decimals: decimalsForPaySymbol(symbol),
      configuredOnChain: true,
    })
  }
  return rails
}

export async function fetchErc20Allowance(
  provider: Provider,
  tokenAddress: string,
  owner: string,
  spender: string
): Promise<bigint> {
  const token = new Contract(tokenAddress, ERC20_ABI, provider)
  return token.allowance(owner, spender) as Promise<bigint>
}

export async function approveErc20ForAuction(
  signer: Signer,
  tokenAddress: string,
  auctionAddress: string,
  amount: bigint
): Promise<void> {
  const token = new Contract(tokenAddress, ERC20_ABI, signer)
  const tx = await token.approve(auctionAddress, amount)
  await tx.wait()
}

export function parsePayAmount(amount: string, symbol: PayRailSymbol): bigint | null {
  const t = amount.trim()
  if (!t) return null
  try {
    return parseUnits(t, decimalsForPaySymbol(symbol))
  } catch {
    return null
  }
}

/** Symbols shown in the unified pay-with picker (aligned with bridge-tokens sonic list). */
export const AUCTION_PAY_SYMBOLS: PayRailSymbol[] = ['S', 'wS', 'USDC', 'USDT', 'EURC', 'WETH']

export const PAY_TOKEN_LABELS: Record<PayRailSymbol, string> = {
  S: 'Sonic',
  wS: 'Wrapped Sonic',
  USDC: 'USD Coin',
  USDT: 'Tether',
  EURC: 'Euro Coin',
  WETH: 'Wrapped Ether',
}

export type PurchaseRoute = 'private-native' | 'private-erc20'

/** Private ZK route for every configured pay token. */
export function resolvePurchaseRoute(
  _paySymbol: PayRailSymbol,
  tokenAddress: string | null | undefined
): PurchaseRoute {
  if (tokenAddress) return 'private-erc20'
  return 'private-native'
}

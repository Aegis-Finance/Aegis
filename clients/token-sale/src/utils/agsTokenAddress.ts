import { ZeroAddress, type Provider } from 'ethers'
import { ENV } from '../config'
import { getAuctionContract, getPublicProvider } from './contracts'

const ZERO = '0x0000000000000000000000000000000000000000'

function isValidTokenAddress(addr: string | null | undefined): addr is string {
  return Boolean(addr && /^0x[a-fA-F0-9]{40}$/.test(addr) && addr.toLowerCase() !== ZERO)
}

async function agsFromChainPack(): Promise<string | null> {
  try {
    const base = (import.meta.env.BASE_URL || '/').replace(/\/?$/, '/')
    const res = await fetch(`${base}config/sonic-chain-pack.json`, { cache: 'default' })
    if (!res.ok) return null
    const j = (await res.json()) as {
      sonicMainnet?: { bridgeTokens?: { tokenSymbol: string; tokenAddress: string }[] }
      sonicTestnet?: { bridgeTokens?: { tokenSymbol: string; tokenAddress: string }[] }
    }
    const layer = ENV.chainId === 14601 ? j.sonicTestnet : j.sonicMainnet
    const row = layer?.bridgeTokens?.find((r) => r.tokenSymbol?.toUpperCase() === 'AGS')
    return isValidTokenAddress(row?.tokenAddress) ? row!.tokenAddress : null
  } catch {
    return null
  }
}

let cached: { chainId: number; address: string } | null = null

/** Resolve AGS (PrivateTokenContract) address for the active chain. */
export async function resolveAgsTokenAddress(provider?: Provider): Promise<string | null> {
  if (isValidTokenAddress(ENV.tokenAddress)) return ENV.tokenAddress
  if (cached && cached.chainId === ENV.chainId) return cached.address

  const read = provider ?? getPublicProvider()
  try {
    const auction = getAuctionContract(read)
    const onChain = (await auction.agsToken()) as string
    if (isValidTokenAddress(onChain)) {
      cached = { chainId: ENV.chainId, address: onChain }
      return onChain
    }
  } catch {
    /* fall through */
  }

  const pack = await agsFromChainPack()
  if (pack) {
    cached = { chainId: ENV.chainId, address: pack }
    return pack
  }
  return null
}

export const AGS_TOKEN_SYMBOL = 'AGS'
export const AGS_TOKEN_DECIMALS = 18

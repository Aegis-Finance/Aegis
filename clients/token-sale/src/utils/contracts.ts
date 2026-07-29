import { BrowserProvider, JsonRpcProvider, Contract, Signer, Provider, ZeroAddress } from 'ethers'
import type { InterfaceAbi } from 'ethers'
import auctionArtifact from '../abis/AutomatedDutchAuction.json'
import stagedCapitalArtifact from '../abis/StagedCapitalVault.json'
import { ENV } from '../config'
import { isValidAddress } from './security'
import type { InjectedEip1193Provider } from './injectedWallets'
import { SecureRpcProvider } from './rpcProvider'

type ContractProvider = Provider | Signer

let cachedPublicProvider: JsonRpcProvider | null = null
let currentRpcUrl: string = ENV.rpcUrl

/**
 * Get public RPC provider with DDoS protection
 * Uses SecureRpcProvider for automatic rate limiting and connection pooling
 * Automatically updates when RPC URL changes
 */
export function getPublicProvider(): JsonRpcProvider {
  // Recreate provider if RPC URL changed
  if (!cachedPublicProvider || currentRpcUrl !== ENV.rpcUrl) {
    currentRpcUrl = ENV.rpcUrl
    cachedPublicProvider = new SecureRpcProvider(ENV.rpcUrl)
  }
  return cachedPublicProvider
}

/**
 * Update RPC URL and recreate provider
 */
export function updateRpcUrl(url: string): void {
  ENV.rpcUrl = url
  currentRpcUrl = url
  cachedPublicProvider = new SecureRpcProvider(url)
}

/**
 * Browser wallet provider. Pass the same EIP-1193 instance used at connect time when available
 * (EIP-6963); otherwise falls back to `window.ethereum`.
 */
export function getBrowserProvider(eip1193?: InjectedEip1193Provider | null): BrowserProvider {
  const eth =
    eip1193 ??
    (typeof window !== 'undefined' && window.ethereum ? window.ethereum : null)
  if (!eth || typeof eth.request !== 'function') {
    throw new Error('No injected wallet found')
  }
  return new BrowserProvider(eth, ENV.chainId)
}

/**
 * Get auction contract with security checks
 */
export function getAuctionContract(provider: ContractProvider) {
  // Validate address before creating contract
  if (!ENV.auctionAddress || !/^0x[a-fA-F0-9]{40}$/.test(ENV.auctionAddress)) {
    throw new Error('Invalid auction contract address')
  }
  return new Contract(ENV.auctionAddress, auctionArtifact.abi as InterfaceAbi, provider)
}

const stagedAbi = stagedCapitalArtifact.abi as InterfaceAbi

/**
 * Staged capital vault at an explicit address (env default or `?vault=` on the microsite).
 */
export function getStagedCapitalVaultAt(
  vaultAddress: string | null | undefined,
  provider: ContractProvider
): Contract | null {
  if (!vaultAddress || vaultAddress === ZeroAddress) return null
  if (!isValidAddress(vaultAddress)) return null
  if (!stagedAbi || stagedAbi.length === 0) return null
  return new Contract(vaultAddress, stagedAbi, provider)
}

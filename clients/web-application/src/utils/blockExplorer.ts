import { NETWORKS } from '@/config/contracts'

/** UI bases for chains we ship in-app; extend as you add networks. */
const EXTRA_EXPLORER_BASE: Record<number, string> = {
  1: 'https://etherscan.io',
  11155111: 'https://sepolia.etherscan.io',
  8453: 'https://basescan.org',
  42161: 'https://arbiscan.io',
  137: 'https://polygonscan.com',
}

function sonicBase(chainId: number): string | null {
  if (chainId === NETWORKS.SONIC_MAINNET.chainId) return NETWORKS.SONIC_MAINNET.blockExplorerUrls[0]
  if (chainId === NETWORKS.SONIC_TESTNET.chainId) return NETWORKS.SONIC_TESTNET.blockExplorerUrls[0]
  return null
}

/** Human-readable explorer base URL for deep links (not the JSON-RPC API). */
export function explorerUiBase(chainId: number): string | null {
  return sonicBase(chainId) ?? EXTRA_EXPLORER_BASE[chainId] ?? null
}

export function explorerTxUrl(chainId: number, txHash: string): string | null {
  const base = explorerUiBase(chainId)
  if (!base || !txHash) return null
  return `${base.replace(/\/$/, '')}/tx/${txHash}`
}

export function explorerAddressUrl(chainId: number, address: string): string | null {
  const base = explorerUiBase(chainId)
  if (!base || !address) return null
  return `${base.replace(/\/$/, '')}/address/${address}`
}

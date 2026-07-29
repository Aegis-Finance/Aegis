import { isTrustedRpcUrl } from './utils/rpcTrust'
import {
  allowPublicSonicRpcInUi,
  isOperationalProfile,
  operationalDefaultRpcUrl,
} from './utils/operationalProfile'

/**
 * TGE microsite env + defaults. All purchases use the private ZK path when circuit artifacts or a prover URL are available.
 * Maintainer checklist: `docs/AEGIS_HIDDEN_FORT_EXECUTION_PLAN.md` (Phase E, Appendix B).
 */

// Get RPC URL from localStorage or env (DAO / team RPC before generic public)
function getInitialRpcUrl(): string {
  // Check localStorage for saved preference
  const savedRpc = localStorage.getItem('aegis_rpc_url')
  if (savedRpc && isTrustedRpcUrl(savedRpc)) {
    return savedRpc
  }

  const daoRpc = import.meta.env.VITE_DAO_RPC_URL as string | undefined
  if (daoRpc && isTrustedRpcUrl(daoRpc.trim())) {
    return daoRpc.trim()
  }

  const envRpc = import.meta.env.VITE_RPC_URL as string | undefined
  if (envRpc && isTrustedRpcUrl(envRpc)) {
    return envRpc
  }

  if (isOperationalProfile()) {
    return operationalDefaultRpcUrl()
  }

  // Default to Sonic mainnet public RPC (convenience builds only)
  return 'https://rpc.soniclabs.com'
}

function optionalAddress(envKey: string): string | undefined {
  const v = (import.meta.env[envKey] as string | undefined)?.trim()
  if (!v || v === '0x0000000000000000000000000000000000000000') return undefined
  if (!/^0x[a-fA-F0-9]{40}$/.test(v)) return undefined
  return v
}

export const ENV = {
  rpcUrl: getInitialRpcUrl(),
  auctionAddress: import.meta.env.VITE_AUCTION_ADDRESS as string,
  chainId: Number(import.meta.env.VITE_CHAIN_ID ?? 146),
  explorerUrl: import.meta.env.VITE_EXPLORER_URL as string | undefined,
  proverUrl: import.meta.env.VITE_PROVER_URL as string | undefined,
  /** Optional HTTPS link (e.g. whitepaper / ops doc) shown in the distribution UI */
  saleDocsUrl: (import.meta.env.VITE_SALE_DOCS_URL as string | undefined)?.trim(),
  /** Optional HTTPS base of `Aegis-contracts/docs` on your host (no trailing slash) for footer protocol-doc links. */
  repoDocsBaseUrl: (import.meta.env.VITE_REPO_DOCS_BASE_URL as string | undefined)?.trim().replace(/\/$/, ''),
  /**
   * Optional `PrivacyEntryRouter` — when set, the app shows a Privacy entry tab (EIP-712 + relay).
   * Must match `Aegis-contracts/contracts/privacy/PrivacyEntryRouter.sol` deployment.
   */
  privacyEntryRouterAddress: optionalAddress('VITE_PRIVACY_ENTRY_ROUTER_ADDRESS'),
  /** PrivateTokenContract (AGS) — for shield balance reads on Privacy entry tab. */
  tokenAddress: optionalAddress('VITE_TOKEN_ADDRESS'),
  /** Optional StagedCapitalVault — VC-style milestone rounds (see `docs/crowdfunding/STAGED_CAPITAL_VAULT.md`). */
  stagedCapitalVaultAddress: optionalAddress('VITE_STAGED_CAPITAL_VAULT_ADDRESS'),
}

export function getInitialPurchaseMode(): 'legacy' | 'zk' {
  const explicit = (import.meta.env.VITE_TGE_DEFAULT_PURCHASE_MODE as string | undefined)?.trim()?.toLowerCase()
  if (explicit === 'legacy') return 'legacy'
  return 'zk'
}

/** Sale-first layout: disclosures collapsed. Set `VITE_TGE_COMPACT_UI=0` for full auditor copy. */
export function isCompactTgeUi(): boolean {
  const v = (import.meta.env.VITE_TGE_COMPACT_UI as string | undefined)?.trim().toLowerCase()
  if (v === '0' || v === 'false' || v === 'verbose') return false
  return true
}

/** Official Sonic-supported wallets (MetaMask, Rabby, OKX, …). */
export const SONIC_WALLET_DOCS_URL = 'https://docs.soniclabs.com/sonic/wallets'

/** Public community + org source (also on https://github.com/Aegis-Finance profile). */
export const AEGIS_COMMUNITY = {
  x: 'https://x.com/aegisecosystem',
  telegram: 'https://t.me/Aegisecosystem',
  github: 'https://github.com/Aegis-Finance',
} as const

function dedupeRpcUrls(urls: string[], max = 10): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const u of urls) {
    const t = u.trim()
    if (!t || seen.has(t)) continue
    seen.add(t)
    out.push(t)
    if (out.length >= max) break
  }
  return out
}

function canonicalRpcUrlsForChain(chainId: number): string[] {
  if (!allowPublicSonicRpcInUi()) {
    return [operationalDefaultRpcUrl()]
  }
  if (chainId === 14601) {
    return ['https://rpc.testnet.soniclabs.com', 'https://rpc.blaze.soniclabs.com']
  }
  return ['https://rpc.soniclabs.com', 'https://rpc.soniclabs.com/mainnet']
}

/**
 * RPC list for `wallet_addEthereumChain`: canonical Sonic endpoints plus the app read RPC when trusted.
 */
export function buildWalletAddChainRpcUrls(appReadRpc: string, chainId: number): string[] {
  const canonical: string[] = [...canonicalRpcUrlsForChain(chainId)]
  const u = (appReadRpc || '').trim()
  if (u && isTrustedRpcUrl(u) && !canonical.some((c) => c === u)) {
    return dedupeRpcUrls([u, ...canonical])
  }
  return dedupeRpcUrls(canonical)
}

/** Params for `wallet_addEthereumChain` matching `ENV.chainId` and current `ENV.rpcUrl`. */
export function walletAddChainParamsForEnv() {
  const chainId = ENV.chainId
  const desiredHex = `0x${chainId.toString(16)}`
  const isTestnet = chainId === 14601
  const explorer =
    ENV.explorerUrl?.replace(/\/$/, '') ?? (isTestnet ? 'https://testnet.sonicscan.org' : 'https://sonicscan.org')
  return {
    chainId: desiredHex,
    chainName: isTestnet ? 'Sonic Testnet' : 'Sonic',
    nativeCurrency: { name: 'Sonic', symbol: 'S', decimals: 18 },
    rpcUrls: buildWalletAddChainRpcUrls(ENV.rpcUrl, chainId),
    blockExplorerUrls: [explorer],
  }
}

// Save RPC URL changes to localStorage
export function setRpcUrl(url: string): void {
  if (!isTrustedRpcUrl(url)) {
    throw new Error(
      'RPC URL not allowed: use Sonic (*.soniclabs.com), localhost, VITE_DAO_RPC_URL host, or VITE_TRUSTED_RPC_HOSTS'
    )
  }
  localStorage.setItem('aegis_rpc_url', url)
  // Update ENV object (note: this won't update already-instantiated providers)
  ENV.rpcUrl = url
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('aegis-rpc-url-changed', { detail: { url } }))
  }
}

if (!ENV.auctionAddress) {
  throw new Error('VITE_AUCTION_ADDRESS is required')
}

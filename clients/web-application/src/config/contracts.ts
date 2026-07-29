import { getFirstAvailableRpcProfile, isTrustedRpcUrl } from './rpcProfiles'
import { isOperationalProfile, operationalDefaultRpcUrl } from '@/utils/operationalProfile'

export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

type ContractMeta = {
  envKey: string
  abiKey: string
  label: string
  /** If true, missing/zero address does not console.warn (e.g. post-TGE contracts). */
  optional?: boolean
}

export const CONTRACT_METADATA = {
  TOKEN: {
    envKey: 'VITE_TOKEN_ADDRESS',
    abiKey: 'Token',
    label: 'AEGIS Token',
  },
  GOVERNANCE: {
    envKey: 'VITE_GOVERNANCE_ADDRESS',
    abiKey: 'Governance',
    label: 'Private Governance',
  },
  VERIFIER_FACTORY: {
    envKey: 'VITE_VERIFIER_FACTORY_ADDRESS',
    abiKey: 'VerifierFactory',
    label: 'Verifier Factory',
  },
  LEADERBOARD: {
    envKey: 'VITE_LEADERBOARD_ADDRESS',
    abiKey: 'Leaderboard',
    label: 'Privacy Leaderboard',
  },
  STAKING: {
    envKey: 'VITE_STAKING_ADDRESS',
    abiKey: 'Staking',
    label: 'Private Staking',
  },
  LENDING: {
    envKey: 'VITE_LENDING_ADDRESS',
    abiKey: 'Lending',
    label: 'Private Lending',
  },
  INSURANCE: {
    envKey: 'VITE_INSURANCE_ADDRESS',
    abiKey: 'Insurance',
    label: 'Decentralized Insurance',
  },
  CROWDFUNDING: {
    envKey: 'VITE_CROWDFUNDING_ADDRESS',
    abiKey: 'Crowdfunding',
    label: 'Crowdfunding Shield',
  },
  YIELD_FARMING: {
    envKey: 'VITE_YIELD_FARMING_ADDRESS',
    abiKey: 'YieldFarming',
    label: 'Private Yield Farming',
  },
  SONIC_GATEWAY_WRAPPER: {
    envKey: 'VITE_SONIC_GATEWAY_WRAPPER_ADDRESS',
    abiKey: 'SONIC_GATEWAY_WRAPPER',
    label: 'Sonic Gateway Wrapper',
  },
  PRIVATE_AMM: {
    envKey: 'VITE_PRIVATEAMMCONTRACT_ADDRESS',
    abiKey: 'AMM',
    label: 'Private AMM',
  },
  TREASURY_LIQUIDITY_ALLOCATOR: {
    envKey: 'VITE_TREASURYLIQUIDITYALLOCATOR_ADDRESS',
    abiKey: 'TreasuryLiquidityAllocator',
    label: 'Treasury Liquidity Allocator',
    optional: true,
  },
  GOVERNANCE_TREASURY: {
    envKey: 'VITE_GOVERNANCE_TREASURY_ADDRESS',
    abiKey: 'GovernanceTreasury',
    label: 'Governance Treasury',
  },
  TOKEN_ALLOCATION: {
    envKey: 'VITE_TOKEN_ALLOCATION_ADDRESS',
    abiKey: 'TokenAllocation',
    label: 'Token Allocation',
  },
  CROSS_CHAIN_PRIVACY_BRIDGE: {
    envKey: 'VITE_CROSS_CHAIN_BRIDGE_ADDRESS',
    abiKey: 'CrossChainPrivacyBridge',
    label: 'Cross-Chain Privacy Bridge',
  },
  GOVERNANCE_EMERGENCY: {
    envKey: 'VITE_GOVERNANCE_EMERGENCY_ADDRESS',
    abiKey: 'GovernanceControlledEmergency',
    label: 'Governance Emergency Circuit',
  },
  POOL_PRICE_VALIDATOR: {
    envKey: 'VITE_POOL_PRICE_VALIDATOR_ADDRESS',
    abiKey: 'PoolPriceValidatorEnhanced', // Try enhanced first, falls back to PoolPriceValidator if not found
    label: 'Pool Price Validator',
  },
  BONDING_CURVE: {
    envKey: 'VITE_BONDING_CURVE_ADDRESS',
    abiKey: 'BondingCurve',
    label: 'Automated Bonding Curve',
    optional: true,
  },
  DAO_REVENUE_ROUTER: {
    envKey: 'VITE_DAO_REVENUE_ROUTER_ADDRESS',
    abiKey: 'DaoDynamicRevenueRouter',
    label: 'DAO Dynamic Revenue Router',
    optional: true,
  },
  PUBLIC_POOL_ROUTER: {
    envKey: 'VITE_PUBLIC_POOL_ROUTER_ADDRESS',
    abiKey: 'AegisPublicPoolRouter',
    label: 'Public pool router (M2)',
    optional: true,
  },
  CANONICAL_SWAP_ROUTER: {
    envKey: 'VITE_CANONICAL_SWAP_ROUTER_ADDRESS',
    abiKey: 'AegisCanonicalSwapRouter',
    label: 'Canonical swap router',
    optional: true,
  },
  TRANSPARENT_ESCROW_ORDERS: {
    envKey: 'VITE_TRANSPARENT_ESCROW_ORDERS_ADDRESS',
    abiKey: 'TransparentEscrowOrders',
    label: 'Transparent escrow orders (M3 starter)',
    optional: true,
  },
  SIGNED_LIMIT_ORDER_REGISTRY: {
    envKey: 'VITE_SIGNED_LIMIT_ORDER_REGISTRY_ADDRESS',
    abiKey: 'SignedLimitOrderRegistry',
    label: 'Signed limit orders (M3+ EIP-712)',
    optional: true,
  },
  RFQ_INTENT_SETTLEMENT: {
    envKey: 'VITE_RFQ_INTENT_SETTLEMENT_ADDRESS',
    abiKey: 'RFQIntentSettlement',
    label: 'RFQ intent settlement (M4 v1)',
    optional: true,
  },
  TOKEN_DISTRIBUTION_SALE: {
    envKey: 'VITE_TOKEN_DISTRIBUTION_SALE_ADDRESS',
    abiKey: 'TokenDistributionSale',
    label: 'ZK token distribution sale',
    optional: true,
  },
  LIQUIDITY_MINING_GAUGE: {
    envKey: 'VITE_LIQUIDITY_MINING_GAUGE_ADDRESS',
    abiKey: 'LiquidityMiningGauge',
    label: 'DAO liquidity mining gauge',
    optional: true,
  },
  LIQUIDITY_GAUGE_USDC: {
    envKey: 'VITE_LIQUIDITY_GAUGE_USDC_ADDRESS',
    abiKey: 'LiquidityMiningGauge',
    label: 'LP mining gauge (AGS/USDC)',
    optional: true,
  },
  LIQUIDITY_GAUGE_SONIC: {
    envKey: 'VITE_LIQUIDITY_GAUGE_SONIC_ADDRESS',
    abiKey: 'LiquidityMiningGauge',
    label: 'LP mining gauge (AGS/S)',
    optional: true,
  },
  TREASURY_BOND_AUCTION: {
    envKey: 'VITE_TREASURY_BOND_AUCTION_ADDRESS',
    abiKey: 'TreasuryBondAuction',
    label: 'Treasury bond auction (Dutch notes)',
    optional: true,
  },
  MESSAGING_ADAPTER_ALLOWLIST: {
    envKey: 'VITE_MESSAGING_ADAPTER_ALLOWLIST_ADDRESS',
    abiKey: 'MessagingAdapterAllowlist',
    label: 'Messaging adapter allowlist (governance-gated)',
    optional: true,
  },
  PRIVACY_ENTRY_ROUTER: {
    envKey: 'VITE_PRIVACY_ENTRY_ROUTER_ADDRESS',
    abiKey: 'PrivacyEntryRouter',
    label: 'Privacy entry router (EIP-712 relay)',
    optional: true,
  },
  STAGED_CAPITAL_VAULT: {
    envKey: 'VITE_STAGED_CAPITAL_VAULT_ADDRESS',
    abiKey: 'StagedCapitalVault',
    label: 'Staged capital vault (VC milestones)',
    optional: true,
  },
  DERIVATIVES: {
    envKey: 'VITE_DERIVATIVES_ADDRESS',
    abiKey: 'Derivatives',
    label: 'Private Derivatives',
    optional: true,
  },
  STEALTH_ADDRESS_HUB: {
    envKey: 'VITE_STEALTH_ADDRESS_HUB_ADDRESS',
    abiKey: 'StealthAddressHub',
    label: 'Stealth address hub',
    optional: true,
  },
  RELAYER_MARKETPLACE: {
    envKey: 'VITE_RELAYER_MARKETPLACE_ADDRESS',
    abiKey: 'RelayerMarketplace',
    label: 'Relayer marketplace',
    optional: true,
  },
  SELECTIVE_DISCLOSURE_HUB: {
    envKey: 'VITE_SELECTIVE_DISCLOSURE_HUB_ADDRESS',
    abiKey: 'SelectiveDisclosureHub',
    label: 'Selective disclosure hub',
    optional: true,
  },
  PRIVACY_SAVINGS_VAULT: {
    envKey: 'VITE_PRIVACY_SAVINGS_VAULT_ADDRESS',
    abiKey: 'PrivacySavingsVault',
    label: 'Privacy savings vault',
    optional: true,
  },
  ANONYMOUS_PAYROLL: {
    envKey: 'VITE_ANONYMOUS_PAYROLL_ADDRESS',
    abiKey: 'AnonymousPayroll',
    label: 'Anonymous payroll',
    optional: true,
  },
  SHIELDED_TREASURY_MANAGER: {
    envKey: 'VITE_SHIELDED_TREASURY_MANAGER_ADDRESS',
    abiKey: 'ShieldedTreasuryManager',
    label: 'Shielded treasury manager',
    optional: true,
  },
  PRIVATE_BOND_MARKET: {
    envKey: 'VITE_PRIVATE_BOND_MARKET_ADDRESS',
    abiKey: 'PrivateBondMarket',
    label: 'Private bond market',
    optional: true,
  },
  PRIVATE_PREDICTION_MARKET: {
    envKey: 'VITE_PRIVATE_PREDICTION_MARKET_ADDRESS',
    abiKey: 'PrivatePredictionMarket',
    label: 'Private prediction market',
    optional: true,
  },
  PRIVATE_STABLE_VAULT: {
    envKey: 'VITE_PRIVATE_STABLE_VAULT_ADDRESS',
    abiKey: 'PrivateStableVault',
    label: 'Private stable vault',
    optional: true,
  },
  PRIVATE_CREDIT_PROFILE: {
    envKey: 'VITE_PRIVATE_CREDIT_PROFILE_ADDRESS',
    abiKey: 'PrivateCreditProfile',
    label: 'Private credit profile',
    optional: true,
  },
  SHIELDED_GOVERNANCE_TALLY: {
    envKey: 'VITE_SHIELDED_GOVERNANCE_TALLY_ADDRESS',
    abiKey: 'ShieldedGovernanceTally',
    label: 'Shielded governance tally',
    optional: true,
  },
  SHIELDED_ECOSYSTEM_ROUTER: {
    envKey: 'VITE_SHIELDED_ECOSYSTEM_ROUTER_ADDRESS',
    abiKey: 'ShieldedEcosystemRouter',
    label: 'Shielded ecosystem router',
    optional: true,
  },
  SHIELDED_YIELD_VAULT: {
    envKey: 'VITE_SHIELDED_YIELD_VAULT_ADDRESS',
    abiKey: 'ShieldedYieldVault',
    label: 'Shielded yield vault',
    optional: true,
  },
  SHIELDED_INCENTIVE_CLAIMS: {
    envKey: 'VITE_SHIELDED_INCENTIVE_CLAIMS_ADDRESS',
    abiKey: 'ShieldedIncentiveClaims',
    label: 'Shielded incentive claims',
    optional: true,
  },
} satisfies Record<string, ContractMeta>

export type ContractKey = keyof typeof CONTRACT_METADATA

function getEnvAddress(key: string, optional?: boolean): string {
  const value = import.meta.env[key]
  if (!value || value === ZERO_ADDRESS) {
    if (!optional) {
      console.warn(`⚠️  ${key} not set. Update .env file with the deployed contract address.`)
    }
    return ZERO_ADDRESS
  }
  return value
}

export const CONTRACT_ADDRESSES = Object.fromEntries(
  Object.entries(CONTRACT_METADATA).map(([key, meta]) => [
    key,
    getEnvAddress(meta.envKey, 'optional' in meta && meta.optional === true),
  ])
) as Record<ContractKey, string>

export function getContractLabel(key: ContractKey): string {
  return CONTRACT_METADATA[key]?.label ?? key
}

export function getContractAbiKey(key: ContractKey): string {
  return CONTRACT_METADATA[key]?.abiKey
}

// Network configuration
export const NETWORKS = {
  SONIC_TESTNET: {
    chainId: 14601,
    name: 'Sonic Testnet',
    rpcUrls: [
      'https://rpc.testnet.soniclabs.com',
      'https://rpc.blaze.soniclabs.com',
    ],
    blockExplorerUrls: ['https://testnet.sonicscan.org'],
    nativeCurrency: {
      name: 'Sonic',
      symbol: 'S',
      decimals: 18,
    },
  },
  SONIC_MAINNET: {
    chainId: 146,
    name: 'Sonic Mainnet',
    rpcUrls: [
      'https://rpc.soniclabs.com',
      'https://rpc.soniclabs.com/mainnet',
    ],
    blockExplorerUrls: ['https://sonicscan.org'],
    nativeCurrency: {
      name: 'Sonic',
      symbol: 'S',
      decimals: 18,
    },
  },
} as const

/** Build-time default chain. Prefer `VITE_CHAIN_ID`, then `VITE_DEFAULT_NETWORK`; live app defaults to Sonic mainnet (146). */
function resolveDefaultNetwork() {
  const chainIdRaw = (import.meta.env.VITE_CHAIN_ID as string | undefined)?.trim()
  if (chainIdRaw) {
    const chainId = Number(chainIdRaw)
    if (chainId === NETWORKS.SONIC_MAINNET.chainId) return NETWORKS.SONIC_MAINNET
    if (chainId === NETWORKS.SONIC_TESTNET.chainId) return NETWORKS.SONIC_TESTNET
  }

  const raw = (import.meta.env.VITE_DEFAULT_NETWORK as string | undefined)?.trim().toLowerCase()
  if (raw === 'sonictestnet' || raw === 'testnet') {
    return NETWORKS.SONIC_TESTNET
  }
  if (raw === 'sonicmainnet' || raw === 'sonic' || raw === 'mainnet') {
    return NETWORKS.SONIC_MAINNET
  }

  return NETWORKS.SONIC_MAINNET
}

// Default network
export const DEFAULT_NETWORK = resolveDefaultNetwork()

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

/**
 * RPC URLs passed to `wallet_addEthereumChain`: canonical Sonic endpoints first, then the
 * app's current read RPC (if trusted) so the wallet can match what the user chose in this UI.
 */
export function buildWalletAddChainRpcUrls(appReadRpcUrl: string): string[] {
  if (isOperationalProfile()) {
    const u = (appReadRpcUrl || operationalDefaultRpcUrl()).trim()
    return isTrustedRpcUrl(u) ? dedupeRpcUrls([u]) : dedupeRpcUrls([operationalDefaultRpcUrl()])
  }
  const canonical: string[] = [...DEFAULT_NETWORK.rpcUrls]
  const u = (appReadRpcUrl || '').trim()
  if (u && isTrustedRpcUrl(u) && !canonical.some((c) => c === u)) {
    return dedupeRpcUrls([u, ...canonical])
  }
  return dedupeRpcUrls(canonical)
}

// RPC configuration
const defaultRpcProfile = getFirstAvailableRpcProfile()

export const RPC_CONFIG = {
  defaultProfileId: defaultRpcProfile.id,
  default: defaultRpcProfile.url ?? DEFAULT_NETWORK.rpcUrls[0],
  fallbacks: DEFAULT_NETWORK.rpcUrls.slice(1),
  timeout: 30000,
  retries: 3,
} as const


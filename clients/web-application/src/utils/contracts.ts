import { Contract, JsonRpcProvider, Provider, Signer, InterfaceAbi } from 'ethers'
import {
  CONTRACT_ADDRESSES,
  type ContractKey,
  getContractAbiKey,
  ZERO_ADDRESS,
  DEFAULT_NETWORK,
  RPC_CONFIG,
} from '@/config/contracts'
import { ABIS } from '@/abis'
import { checkRateLimit } from './rateLimiter'
import { isValidAddress } from './security'

/**
 * Get a contract instance with security checks
 */
export function getContract(
  contractName: ContractKey,
  provider: Provider | Signer
): Contract {
  // Rate limit contract calls
  checkRateLimit('rpc')

  const address = CONTRACT_ADDRESSES[contractName]
  const abiKey = getContractAbiKey(contractName)
  const abi = ABIS[abiKey as keyof typeof ABIS]

  if (!address || address === '0x0000000000000000000000000000000000000000') {
    throw new Error(`Contract address not set for ${contractName}`)
  }

  // Validate address format
  if (!isValidAddress(address)) {
    throw new Error(`Invalid contract address for ${contractName}: ${address}`)
  }

  if (!abi || abi.length === 0) {
    throw new Error(
      `ABI not found or empty for ${contractName}. ` +
      `Run 'npm run copy-abis' to copy ABIs from contract artifacts.`
    )
  }

  return new Contract(address, abi, provider)
}

/**
 * Contract getters for each module
 */
export const getTokenContract = (provider: Provider | Signer) =>
  getContract('TOKEN', provider)

export const getGovernanceContract = (provider: Provider | Signer) =>
  getContract('GOVERNANCE', provider)

export const getStakingContract = (provider: Provider | Signer) =>
  getContract('STAKING', provider)

export const getLendingContract = (provider: Provider | Signer) =>
  getContract('LENDING', provider)

export const getInsuranceContract = (provider: Provider | Signer) =>
  getContract('INSURANCE', provider)

export const getCrowdfundingContract = (provider: Provider | Signer) =>
  getContract('CROWDFUNDING', provider)

/** Optional VC-style milestone vault — returns null when unset. */
export function getStagedCapitalVaultContract(provider: Provider | Signer): Contract | null {
  return getStagedCapitalVaultAt(CONTRACT_ADDRESSES.STAGED_CAPITAL_VAULT, provider)
}

/**
 * Staged capital vault at an explicit address (e.g. per-deal deployment or `?vault=` in the dApp).
 * ABI must exist in `frontend/src/abis` (run `npm run copy-abis`).
 */
export function getStagedCapitalVaultAt(
  vaultAddress: string | null | undefined,
  provider: Provider | Signer
): Contract | null {
  if (!vaultAddress || vaultAddress === ZERO_ADDRESS) return null
  if (!isValidAddress(vaultAddress)) return null
  const abi = ABIS.StagedCapitalVault
  if (!abi || abi.length === 0) return null
  return new Contract(vaultAddress, abi, provider)
}

/** Read-only RPC when the user has not connected a wallet yet. */
export function getDefaultReadProvider(): JsonRpcProvider {
  return new JsonRpcProvider(RPC_CONFIG.default, DEFAULT_NETWORK.chainId)
}

export const getYieldFarmingContract = (provider: Provider | Signer) =>
  getContract('YIELD_FARMING', provider)

export const getTreasuryLiquidityAllocatorContract = (provider: Provider | Signer) =>
  getContract('TREASURY_LIQUIDITY_ALLOCATOR', provider)

export const getPrivateAmmContract = (provider: Provider | Signer) =>
  getContract('PRIVATE_AMM', provider)

export function getPublicLiquidityPoolContract(
  address: string,
  provider: Provider | Signer
): Contract {
  const abi = ABIS.PublicLiquidityPool
  if (!abi || abi.length === 0) {
    throw new Error('PublicLiquidityPool ABI missing. Run npm run copy-abis.')
  }
  return new Contract(address, abi, provider)
}

/** Optional M2 router — returns null when `VITE_PUBLIC_POOL_ROUTER_ADDRESS` is unset. */
export function getPublicPoolRouterContract(provider: Provider | Signer): Contract | null {
  const address = CONTRACT_ADDRESSES.PUBLIC_POOL_ROUTER
  if (!address || address === ZERO_ADDRESS) return null
  if (!isValidAddress(address)) return null
  const abi = ABIS.AegisPublicPoolRouter
  if (!abi || abi.length === 0) return null
  return new Contract(address, abi, provider)
}

const ERC20_ABI = [
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function balanceOf(address owner) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
] as const

export function getErc20Contract(address: string, provider: Provider | Signer): Contract {
  return new Contract(address, ERC20_ABI, provider)
}

export const getVerifierFactoryContract = (provider: Provider | Signer) =>
  getContract('VERIFIER_FACTORY', provider)

export const getLeaderboardContract = (provider: Provider | Signer) =>
  getContract('LEADERBOARD', provider)

export const getSonicGatewayWrapperContract = (provider: Provider | Signer) =>
  getContract('SONIC_GATEWAY_WRAPPER', provider)

export const getGovernanceTreasuryContract = (provider: Provider | Signer) =>
  getContract('GOVERNANCE_TREASURY', provider)

export const getTokenAllocationContract = (provider: Provider | Signer) =>
  getContract('TOKEN_ALLOCATION', provider)

export const getCrossChainPrivacyBridgeContract = (provider: Provider | Signer) =>
  getContract('CROSS_CHAIN_PRIVACY_BRIDGE', provider)

export const getGovernanceEmergencyContract = (provider: Provider | Signer) =>
  getContract('GOVERNANCE_EMERGENCY', provider)

export const getBondingCurveContract = (provider: Provider | Signer) =>
  getContract('BONDING_CURVE', provider)

export function getTransparentEscrowOrdersContract(provider: Provider | Signer): Contract | null {
  const address = CONTRACT_ADDRESSES.TRANSPARENT_ESCROW_ORDERS
  if (!address || address === ZERO_ADDRESS) return null
  const abi = ABIS.TransparentEscrowOrders
  if (!abi || abi.length === 0) return null
  return new Contract(address, abi, provider)
}

export function getSignedLimitOrderRegistryContract(provider: Provider | Signer): Contract | null {
  const address = CONTRACT_ADDRESSES.SIGNED_LIMIT_ORDER_REGISTRY
  if (!address || address === ZERO_ADDRESS) return null
  const abi = ABIS.SignedLimitOrderRegistry
  if (!abi || abi.length === 0) return null
  return new Contract(address, abi, provider)
}

export function getRfqIntentSettlementContract(provider: Provider | Signer): Contract | null {
  const address = CONTRACT_ADDRESSES.RFQ_INTENT_SETTLEMENT
  if (!address || address === ZERO_ADDRESS) return null
  const abi = ABIS.RFQIntentSettlement
  if (!abi || abi.length === 0) return null
  return new Contract(address, abi, provider)
}

export function getTokenDistributionSaleContract(provider: Provider | Signer): Contract | null {
  const address = CONTRACT_ADDRESSES.TOKEN_DISTRIBUTION_SALE
  if (!address || address === ZERO_ADDRESS) return null
  const abi = ABIS.TokenDistributionSale
  if (!abi || abi.length === 0) return null
  return new Contract(address, abi, provider)
}

export function getLiquidityMiningGaugeContract(
  provider: Provider | Signer,
  gaugeAddress?: string
): Contract | null {
  const address = gaugeAddress || CONTRACT_ADDRESSES.LIQUIDITY_MINING_GAUGE
  if (!address || address === ZERO_ADDRESS) return null
  const abi = ABIS.LiquidityMiningGauge
  if (!abi || abi.length === 0) return null
  return new Contract(address, abi, provider)
}

export function getTreasuryBondAuctionContract(provider: Provider | Signer): Contract | null {
  const address = CONTRACT_ADDRESSES.TREASURY_BOND_AUCTION
  if (!address || address === ZERO_ADDRESS) return null
  const abi = ABIS.TreasuryBondAuction
  if (!abi || abi.length === 0) return null
  return new Contract(address, abi, provider)
}

/** Optional derivatives module — returns null when unset (manifest fallback in pricing UI). */
export function getDerivativesContract(provider: Provider | Signer): Contract | null {
  const address = CONTRACT_ADDRESSES.DERIVATIVES
  if (!address || address === ZERO_ADDRESS) return null
  const abi = ABIS.Derivatives
  if (!abi || abi.length === 0) return null
  return new Contract(address, abi, provider)
}

function getOptionalContract(
  address: string,
  abi: InterfaceAbi,
  provider: Provider | Signer
): Contract | null {
  if (!address || address === ZERO_ADDRESS) return null
  if (!isValidAddress(address)) return null
  if (!abi || abi.length === 0) return null
  return new Contract(address, abi, provider)
}

export const getStealthAddressHubContract = (p: Provider | Signer) =>
  getOptionalContract(CONTRACT_ADDRESSES.STEALTH_ADDRESS_HUB, ABIS.StealthAddressHub, p)

export const getRelayerMarketplaceContract = (p: Provider | Signer) =>
  getOptionalContract(CONTRACT_ADDRESSES.RELAYER_MARKETPLACE, ABIS.RelayerMarketplace, p)

export const getSelectiveDisclosureHubContract = (p: Provider | Signer) =>
  getOptionalContract(CONTRACT_ADDRESSES.SELECTIVE_DISCLOSURE_HUB, ABIS.SelectiveDisclosureHub, p)

export const getPrivacySavingsVaultContract = (p: Provider | Signer) =>
  getOptionalContract(CONTRACT_ADDRESSES.PRIVACY_SAVINGS_VAULT, ABIS.PrivacySavingsVault, p)

export const getAnonymousPayrollContract = (p: Provider | Signer) =>
  getOptionalContract(CONTRACT_ADDRESSES.ANONYMOUS_PAYROLL, ABIS.AnonymousPayroll, p)

export const getShieldedTreasuryManagerContract = (p: Provider | Signer) =>
  getOptionalContract(CONTRACT_ADDRESSES.SHIELDED_TREASURY_MANAGER, ABIS.ShieldedTreasuryManager, p)

export const getPrivateBondMarketContract = (p: Provider | Signer) =>
  getOptionalContract(CONTRACT_ADDRESSES.PRIVATE_BOND_MARKET, ABIS.PrivateBondMarket, p)

export const getPrivatePredictionMarketContract = (p: Provider | Signer) =>
  getOptionalContract(CONTRACT_ADDRESSES.PRIVATE_PREDICTION_MARKET, ABIS.PrivatePredictionMarket, p)

export const getPrivateStableVaultContract = (p: Provider | Signer) =>
  getOptionalContract(CONTRACT_ADDRESSES.PRIVATE_STABLE_VAULT, ABIS.PrivateStableVault, p)

export const getPrivateCreditProfileContract = (p: Provider | Signer) =>
  getOptionalContract(CONTRACT_ADDRESSES.PRIVATE_CREDIT_PROFILE, ABIS.PrivateCreditProfile, p)

export const getShieldedGovernanceTallyContract = (p: Provider | Signer) =>
  getOptionalContract(CONTRACT_ADDRESSES.SHIELDED_GOVERNANCE_TALLY, ABIS.ShieldedGovernanceTally, p)

export const getShieldedEcosystemRouterContract = (p: Provider | Signer) =>
  getOptionalContract(CONTRACT_ADDRESSES.SHIELDED_ECOSYSTEM_ROUTER, ABIS.ShieldedEcosystemRouter, p)

export const getShieldedYieldVaultContract = (p: Provider | Signer) =>
  getOptionalContract(CONTRACT_ADDRESSES.SHIELDED_YIELD_VAULT, ABIS.ShieldedYieldVault, p)

export const getShieldedIncentiveClaimsContract = (p: Provider | Signer) =>
  getOptionalContract(CONTRACT_ADDRESSES.SHIELDED_INCENTIVE_CLAIMS, ABIS.ShieldedIncentiveClaims, p)


// Contract ABIs - Imported from artifacts
// Run 'npm run copy-abis' to update these from contract artifacts

import TokenABI from './Token.json'
import GovernanceABI from './Governance.json'
import StakingABI from './Staking.json'
import LendingABI from './Lending.json'
import InsuranceABI from './Insurance.json'
import CrowdfundingABI from './Crowdfunding.json'
import YieldFarmingABI from './YieldFarming.json'
import VerifierFactoryABI from './VerifierFactory.json'
import LeaderboardABI from './Leaderboard.json'
import SonicGatewayWrapperABI from './SonicGatewayWrapper.json'
import AMMABI from './AMM.json'
import PublicLiquidityPoolABI from './PublicLiquidityPool.json'
import TreasuryLiquidityAllocatorABI from './TreasuryLiquidityAllocator.json'
import GovernanceTreasuryABI from './GovernanceTreasury.json'
import TokenAllocationABI from './TokenAllocation.json'
import CrossChainPrivacyBridgeABI from './CrossChainPrivacyBridge.json'
import GovernanceControlledEmergencyABI from './GovernanceControlledEmergency.json'
import BondingCurveABI from './BondingCurve.json'
import DaoDynamicRevenueRouterABI from './DaoDynamicRevenueRouter.json'
import AegisPublicPoolRouterABI from './AegisPublicPoolRouter.json'
import AegisCanonicalSwapRouterABI from './AegisCanonicalSwapRouter.json'
import TransparentEscrowOrdersABI from './TransparentEscrowOrders.json'
import SignedLimitOrderRegistryABI from './SignedLimitOrderRegistry.json'
import RFQIntentSettlementABI from './RFQIntentSettlement.json'
import TokenDistributionSaleABI from './TokenDistributionSale.json'
import LiquidityMiningGaugeABI from './LiquidityMiningGauge.json'
import TreasuryBondAuctionABI from './TreasuryBondAuction.json'
import MessagingAdapterAllowlistABI from './MessagingAdapterAllowlist.json'
import PrivacyEntryRouterABI from './PrivacyEntryRouter.json'
import StagedCapitalVaultABI from './StagedCapitalVault.json'
import DerivativesABI from './Derivatives.json'
import StealthAddressHubABI from './StealthAddressHub.json'
import RelayerMarketplaceABI from './RelayerMarketplace.json'
import SelectiveDisclosureHubABI from './SelectiveDisclosureHub.json'
import PrivacySavingsVaultABI from './PrivacySavingsVault.json'
import AnonymousPayrollABI from './AnonymousPayroll.json'
import ShieldedTreasuryManagerABI from './ShieldedTreasuryManager.json'
import PrivateBondMarketABI from './PrivateBondMarket.json'
import PrivatePredictionMarketABI from './PrivatePredictionMarket.json'
import PrivateStableVaultABI from './PrivateStableVault.json'
import PrivateCreditProfileABI from './PrivateCreditProfile.json'
import ShieldedGovernanceTallyABI from './ShieldedGovernanceTally.json'
import ShieldedEcosystemRouterABI from './ShieldedEcosystemRouter.json'
import ShieldedYieldVaultABI from './ShieldedYieldVault.json'
import ShieldedIncentiveClaimsABI from './ShieldedIncentiveClaims.json'

export {
  TokenABI,
  GovernanceABI,
  StakingABI,
  LendingABI,
  InsuranceABI,
  CrowdfundingABI,
  YieldFarmingABI,
  VerifierFactoryABI,
  LeaderboardABI,
  SonicGatewayWrapperABI,
  AMMABI,
  PublicLiquidityPoolABI,
  TreasuryLiquidityAllocatorABI,
  GovernanceTreasuryABI,
  TokenAllocationABI,
  CrossChainPrivacyBridgeABI,
  GovernanceControlledEmergencyABI,
  BondingCurveABI,
  DaoDynamicRevenueRouterABI,
  AegisPublicPoolRouterABI,
  TransparentEscrowOrdersABI,
  SignedLimitOrderRegistryABI,
  RFQIntentSettlementABI,
  TokenDistributionSaleABI,
  LiquidityMiningGaugeABI,
  TreasuryBondAuctionABI,
  MessagingAdapterAllowlistABI,
  PrivacyEntryRouterABI,
  StagedCapitalVaultABI,
  DerivativesABI,
  StealthAddressHubABI,
  RelayerMarketplaceABI,
  SelectiveDisclosureHubABI,
  PrivacySavingsVaultABI,
  AnonymousPayrollABI,
  ShieldedTreasuryManagerABI,
  PrivateBondMarketABI,
  PrivatePredictionMarketABI,
  PrivateStableVaultABI,
  PrivateCreditProfileABI,
  ShieldedGovernanceTallyABI,
  ShieldedEcosystemRouterABI,
  ShieldedYieldVaultABI,
  ShieldedIncentiveClaimsABI,
}

// Type-safe ABI exports
// These will be empty arrays until 'npm run copy-abis' is run
export const ABIS = {
  Token: TokenABI.abi || [],
  Governance: GovernanceABI.abi || [],
  Staking: StakingABI.abi || [],
  Lending: LendingABI.abi || [],
  Insurance: InsuranceABI.abi || [],
  Crowdfunding: CrowdfundingABI.abi || [],
  YieldFarming: YieldFarmingABI.abi || [],
  VerifierFactory: VerifierFactoryABI.abi || [],
  Leaderboard: LeaderboardABI.abi || [],
  SONIC_GATEWAY_WRAPPER: SonicGatewayWrapperABI.abi || [],
  AMM: AMMABI.abi || [],
  PublicLiquidityPool: PublicLiquidityPoolABI.abi || [],
  TreasuryLiquidityAllocator: TreasuryLiquidityAllocatorABI.abi || [],
  GovernanceTreasury: GovernanceTreasuryABI.abi || [],
  TokenAllocation: TokenAllocationABI.abi || [],
  CrossChainPrivacyBridge: CrossChainPrivacyBridgeABI.abi || [],
  GovernanceControlledEmergency: GovernanceControlledEmergencyABI.abi || [],
  BondingCurve: BondingCurveABI.abi || [],
  DaoDynamicRevenueRouter: DaoDynamicRevenueRouterABI.abi || [],
  AegisPublicPoolRouter: AegisPublicPoolRouterABI.abi || [],
  AegisCanonicalSwapRouter: AegisCanonicalSwapRouterABI.abi || [],
  TransparentEscrowOrders: TransparentEscrowOrdersABI.abi || [],
  SignedLimitOrderRegistry: SignedLimitOrderRegistryABI.abi || [],
  RFQIntentSettlement: RFQIntentSettlementABI.abi || [],
  TokenDistributionSale: TokenDistributionSaleABI.abi || [],
  LiquidityMiningGauge: LiquidityMiningGaugeABI.abi || [],
  TreasuryBondAuction: TreasuryBondAuctionABI.abi || [],
  MessagingAdapterAllowlist: MessagingAdapterAllowlistABI.abi || [],
  PrivacyEntryRouter: PrivacyEntryRouterABI.abi || [],
  StagedCapitalVault: StagedCapitalVaultABI.abi || [],
  Derivatives: DerivativesABI.abi || [],
  StealthAddressHub: StealthAddressHubABI.abi || [],
  RelayerMarketplace: RelayerMarketplaceABI.abi || [],
  SelectiveDisclosureHub: SelectiveDisclosureHubABI.abi || [],
  PrivacySavingsVault: PrivacySavingsVaultABI.abi || [],
  AnonymousPayroll: AnonymousPayrollABI.abi || [],
  ShieldedTreasuryManager: ShieldedTreasuryManagerABI.abi || [],
  PrivateBondMarket: PrivateBondMarketABI.abi || [],
  PrivatePredictionMarket: PrivatePredictionMarketABI.abi || [],
  PrivateStableVault: PrivateStableVaultABI.abi || [],
  PrivateCreditProfile: PrivateCreditProfileABI.abi || [],
  ShieldedGovernanceTally: ShieldedGovernanceTallyABI.abi || [],
  ShieldedEcosystemRouter: ShieldedEcosystemRouterABI.abi || [],
  ShieldedYieldVault: ShieldedYieldVaultABI.abi || [],
  ShieldedIncentiveClaims: ShieldedIncentiveClaimsABI.abi || [],
} as const


#!/usr/bin/env node

/**
 * Script to copy contract ABIs from artifacts to frontend/src/abis
 * Run this after compiling contracts: npm run copy-abis
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const rootDir = path.resolve(__dirname, '../..')
const artifactsDir = path.join(rootDir, 'Aegis-contracts/artifacts/contracts')
const legacyArtifactsDir = path.join(rootDir, 'artifacts/contracts')
const abisDir = path.join(__dirname, '../src/abis')

// Contract mappings: contract name -> artifact path
const contracts = {
  Token: 'PrivateTokenContract.sol/PrivateTokenContract.json',
  Governance: 'PrivateGovernance.sol/PrivateGovernance.json',
  Staking: 'PrivateStakingContract.sol/PrivateStakingContract.json',
  Lending: 'PrivateLendingContract.sol/PrivateLendingContract.json',
  Insurance: 'DecentralizedInsurance.sol/DecentralizedInsurance.json',
  Crowdfunding: 'crowdfunding/AegisCrowdShield.sol/AegisCrowdShield.json',
  YieldFarming: 'PrivateYieldFarming.sol/PrivateYieldFarming.json',
  VerifierFactory: 'VerifierFactory.sol/VerifierFactory.json',
  Leaderboard: 'OnChainPrivacyLeaderboard.sol/OnChainPrivacyLeaderboard.json',
  SonicGatewayWrapper: 'wrappers/SonicGatewayWrapper.sol/SonicGatewayWrapper.json',
  AMM: 'PrivateAMMContract.sol/PrivateAMMContract.json',
  PublicLiquidityPool: 'liquidity/PublicLiquidityPool.sol/PublicLiquidityPool.json',
  TreasuryLiquidityAllocator: 'treasury/TreasuryLiquidityAllocator.sol/TreasuryLiquidityAllocator.json',
  GovernanceTreasury: 'governance/GovernanceTreasury.sol/GovernanceTreasury.json',
  TokenAllocation: 'TokenAllocation.sol/TokenAllocation.json',
  CrossChainPrivacyBridge: 'CrossChainPrivacyBridge.sol/CrossChainPrivacyBridge.json',
  GovernanceControlledEmergency: 'GovernanceControlledEmergency.sol/GovernanceControlledEmergency.json',
  BondingCurve: 'tokendistribution/AutomatedBondingCurve.sol/AutomatedBondingCurve.json',
  DaoDynamicRevenueRouter: 'treasury/DaoDynamicRevenueRouter.sol/DaoDynamicRevenueRouter.json',
  AegisPublicPoolRouter: 'dex/AegisPublicPoolRouter.sol/AegisPublicPoolRouter.json',
  AegisCanonicalSwapRouter: 'dex/AegisCanonicalSwapRouter.sol/AegisCanonicalSwapRouter.json',
  TransparentEscrowOrders: 'dex/TransparentEscrowOrders.sol/TransparentEscrowOrders.json',
  SignedLimitOrderRegistry: 'dex/SignedLimitOrderRegistry.sol/SignedLimitOrderRegistry.json',
  RFQIntentSettlement: 'dex/RFQIntentSettlement.sol/RFQIntentSettlement.json',
  TokenDistributionSale: 'tokendistribution/TokenDistributionSale.sol/TokenDistributionSale.json',
  LiquidityMiningGauge: 'incentives/LiquidityMiningGauge.sol/LiquidityMiningGauge.json',
  TreasuryBondAuction: 'treasury/TreasuryBondAuction.sol/TreasuryBondAuction.json',
  MessagingAdapterAllowlist: 'wrappers/MessagingAdapterAllowlist.sol/MessagingAdapterAllowlist.json',
  PrivacyEntryRouter: 'privacy/PrivacyEntryRouter.sol/PrivacyEntryRouter.json',
  StagedCapitalVault: 'crowdfunding/StagedCapitalVault.sol/StagedCapitalVault.json',
  Derivatives: 'PrivateDerivatives.sol/PrivateDerivatives.json',
  StealthAddressHub: 'ecosystem/StealthAddressHub.sol/StealthAddressHub.json',
  RelayerMarketplace: 'ecosystem/RelayerMarketplace.sol/RelayerMarketplace.json',
  SelectiveDisclosureHub: 'ecosystem/SelectiveDisclosureHub.sol/SelectiveDisclosureHub.json',
  PrivacySavingsVault: 'ecosystem/PrivacySavingsVault.sol/PrivacySavingsVault.json',
  AnonymousPayroll: 'ecosystem/AnonymousPayroll.sol/AnonymousPayroll.json',
  ShieldedTreasuryManager: 'ecosystem/ShieldedTreasuryManager.sol/ShieldedTreasuryManager.json',
  PrivateBondMarket: 'ecosystem/PrivateBondMarket.sol/PrivateBondMarket.json',
  PrivatePredictionMarket: 'ecosystem/PrivatePredictionMarket.sol/PrivatePredictionMarket.json',
  PrivateStableVault: 'ecosystem/PrivateStableVault.sol/PrivateStableVault.json',
  PrivateCreditProfile: 'ecosystem/PrivateCreditProfile.sol/PrivateCreditProfile.json',
  ShieldedGovernanceTally: 'ecosystem/ShieldedGovernanceTally.sol/ShieldedGovernanceTally.json',
  ShieldedEcosystemRouter: 'ecosystem/ShieldedEcosystemRouter.sol/ShieldedEcosystemRouter.json',
  ShieldedYieldVault: 'ecosystem/ShieldedYieldVault.sol/ShieldedYieldVault.json',
  ShieldedIncentiveClaims: 'ecosystem/ShieldedIncentiveClaims.sol/ShieldedIncentiveClaims.json',
}

// Ensure abis directory exists
if (!fs.existsSync(abisDir)) {
  fs.mkdirSync(abisDir, { recursive: true })
}

// Try both possible artifact locations
let actualArtifactsDir = artifactsDir
if (!fs.existsSync(actualArtifactsDir) && fs.existsSync(legacyArtifactsDir)) {
  actualArtifactsDir = legacyArtifactsDir
}

console.log('📦 Copying contract ABIs...\n')
console.log(`   Source: ${actualArtifactsDir}`)
console.log(`   Destination: ${abisDir}\n`)

if (!fs.existsSync(actualArtifactsDir)) {
  console.error(`❌ Artifacts directory not found: ${actualArtifactsDir}`)
  console.error(`   Make sure contracts are compiled: cd Aegis-contracts && npx hardhat compile`)
  process.exit(1)
}

let copied = 0
let failed = 0

for (const [name, artifactPath] of Object.entries(contracts)) {
  const sourcePath = path.join(actualArtifactsDir, artifactPath)
  const destPath = path.join(abisDir, `${name}.json`)

  try {
    if (!fs.existsSync(sourcePath)) {
      console.log(`⚠️  Skipping ${name}: Artifact not found`)
      console.log(`   Expected: ${sourcePath}\n`)
      failed++
      continue
    }

    // Read and parse the artifact
    const artifact = JSON.parse(fs.readFileSync(sourcePath, 'utf8'))
    
    // Extract just the ABI and contract name
    const abiOnly = {
      contractName: artifact.contractName,
      abi: artifact.abi,
    }

    // Write ABI to destination
    fs.writeFileSync(destPath, JSON.stringify(abiOnly, null, 2))
    console.log(`✅ Copied ${name} ABI (${artifact.abi.length} functions)`)
    copied++
  } catch (error) {
    console.error(`❌ Failed to copy ${name}:`, error.message)
    failed++
  }
}

console.log(`\n📊 Summary: ${copied} copied, ${failed} failed`)

if (copied > 0) {
  console.log('\n✨ ABIs are now available in src/abis/')
  console.log('   Import them in your components like:')
  console.log('   import { getGovernanceContract } from "@/utils/contracts"')
}

if (failed > 0) {
  console.log('\n⚠️  Some ABIs failed to copy. Make sure contracts are compiled.')
  console.log('   Run: cd Aegis-contracts && npx hardhat compile')
}


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
  TransparentEscrowOrders: 'dex/TransparentEscrowOrders.sol/TransparentEscrowOrders.json',
  SignedLimitOrderRegistry: 'dex/SignedLimitOrderRegistry.sol/SignedLimitOrderRegistry.json',
  RFQIntentSettlement: 'dex/RFQIntentSettlement.sol/RFQIntentSettlement.json',
  TokenDistributionSale: 'tokendistribution/TokenDistributionSale.sol/TokenDistributionSale.json',
  LiquidityMiningGauge: 'incentives/LiquidityMiningGauge.sol/LiquidityMiningGauge.json',
  TreasuryBondAuction: 'treasury/TreasuryBondAuction.sol/TreasuryBondAuction.json',
  MessagingAdapterAllowlist: 'wrappers/MessagingAdapterAllowlist.sol/MessagingAdapterAllowlist.json',
}

// Ensure abis directory exists
if (!fs.existsSync(abisDir)) {
  fs.mkdirSync(abisDir, { recursive: true })
}

console.log('📦 Copying contract ABIs...\n')

let copied = 0
let failed = 0

const actualArtifactsDir = fs.existsSync(artifactsDir) ? artifactsDir : legacyArtifactsDir

for (const [name, artifactPath] of Object.entries(contracts)) {
  const sourcePath = path.join(actualArtifactsDir, artifactPath)
  const destPath = path.join(abisDir, `${name}.json`)

  try {
    if (!fs.existsSync(sourcePath)) {
      console.log(`⚠️  Skipping ${name}: Artifact not found at ${sourcePath}`)
      failed++
      continue
    }

    // Read and parse the artifact
    const artifact = JSON.parse(fs.readFileSync(sourcePath, 'utf8'))
    
    // Extract just the ABI
    const abiOnly = {
      contractName: artifact.contractName,
      abi: artifact.abi,
    }

    // Write ABI to destination
    fs.writeFileSync(destPath, JSON.stringify(abiOnly, null, 2))
    console.log(`✅ Copied ${name} ABI`)
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
  console.log('   import TokenABI from "@/abis/Token.json"')
}


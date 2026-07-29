# Contract ABI Setup Guide

This guide explains how to set up contract ABIs in the frontend.

## Overview

The frontend needs contract ABIs to interact with deployed contracts. ABIs are automatically copied from compiled contract artifacts using a script.

## Quick Setup

```bash
# 1. Compile contracts (in Aegis-contracts directory)
cd ../Aegis-contracts
npx hardhat compile

# 2. Copy ABIs to frontend
cd ../frontend
npm run copy-abis
```

## How It Works

### 1. Contract Compilation

When you compile contracts in `Aegis-contracts`, Hardhat generates artifact files in:
```
Aegis-contracts/artifacts/contracts/
├── PrivateTokenContract.sol/
│   └── PrivateTokenContract.json
├── PrivateGovernance.sol/
│   └── PrivateGovernance.json
└── ... etc
```

### 2. ABI Copy Script

The `npm run copy-abis` script:
- Reads artifact JSON files from `Aegis-contracts/artifacts/contracts/`
- Extracts the `abi` field from each artifact
- Saves simplified JSON files to `frontend/src/abis/`

### 3. ABI Usage

ABIs are imported through `src/abis/index.ts`:

```typescript
import { ABIS, getGovernanceContract } from '@/utils/contracts'

// Use helper function (recommended)
const contract = getGovernanceContract(provider)

// Or use ABI directly
const contract = new Contract(address, ABIS.Governance, provider)
```

## Contract Mappings

The script maps contracts as follows:

| Frontend Name | Contract File | Artifact Path |
|--------------|---------------|---------------|
| Token | PrivateTokenContract.sol | `PrivateTokenContract.sol/PrivateTokenContract.json` |
| Governance | PrivateGovernance.sol | `governance/PrivateGovernance.sol/PrivateGovernance.json` |
| Staking | PrivateStakingContract.sol | `PrivateStakingContract.sol/PrivateStakingContract.json` |
| Lending | PrivateLendingContract.sol | `PrivateLendingContract.sol/PrivateLendingContract.json` |
| Insurance | DecentralizedInsurance.sol | `DecentralizedInsurance.sol/DecentralizedInsurance.json` |
| Crowdfunding | AegisCrowdShield.sol | `crowdfunding/AegisCrowdShield.sol/AegisCrowdShield.json` |
| YieldFarming | PrivateYieldFarming.sol | `PrivateYieldFarming.sol/PrivateYieldFarming.json` |
| VerifierFactory | VerifierFactory.sol | `VerifierFactory.sol/VerifierFactory.json` |
| Leaderboard | OnChainPrivacyLeaderboard.sol | `OnChainPrivacyLeaderboard.sol/OnChainPrivacyLeaderboard.json` |
| SonicGatewayWrapper | SonicGatewayWrapper.sol | `wrappers/SonicGatewayWrapper.sol/SonicGatewayWrapper.json` |
| AMM | PrivateAMMContract.sol | `PrivateAMMContract.sol/PrivateAMMContract.json` |
| PublicLiquidityPool | PublicLiquidityPool.sol | `liquidity/PublicLiquidityPool.sol/PublicLiquidityPool.json` |
| TreasuryLiquidityAllocator | TreasuryLiquidityAllocator.sol | `treasury/TreasuryLiquidityAllocator.sol/TreasuryLiquidityAllocator.json` |
| GovernanceTreasury | GovernanceTreasury.sol | `governance/GovernanceTreasury.sol/GovernanceTreasury.json` |
| TokenAllocation | TokenAllocation.sol | `TokenAllocation.sol/TokenAllocation.json` |
| CrossChainPrivacyBridge | CrossChainPrivacyBridge.sol | `CrossChainPrivacyBridge.sol/CrossChainPrivacyBridge.json` |
| GovernanceControlledEmergency | GovernanceControlledEmergency.sol | `GovernanceControlledEmergency.sol/GovernanceControlledEmergency.json` |
| BondingCurve | AutomatedBondingCurve.sol | `tokendistribution/AutomatedBondingCurve.sol/AutomatedBondingCurve.json` |
| DaoDynamicRevenueRouter | DaoDynamicRevenueRouter.sol | `treasury/DaoDynamicRevenueRouter.sol/DaoDynamicRevenueRouter.json` |
| AegisPublicPoolRouter | AegisPublicPoolRouter.sol | `dex/AegisPublicPoolRouter.sol/AegisPublicPoolRouter.json` |
| TransparentEscrowOrders | TransparentEscrowOrders.sol | `dex/TransparentEscrowOrders.sol/TransparentEscrowOrders.json` |

## Crowdfunding (`AegisCrowdShield`)

After pulling contract changes, always **`cd Aegis-contracts && npx hardhat compile`** then **`cd ../frontend && npm run copy-abis`**.

The dapp reads campaigns via **`getCampaign(id)`** (includes `withdrawUnlocksAt` and `config`, including **`minimumContribution`** / **`maximumContribution`**) and submits public contributions as **`contribute(campaignId, amount, nullifierHash, zkProof, zkPublicInputs, { value })`** with **`zkProof`** all zeros and **`zkPublicInputs`** empty when `nullifierHash` is zero. After `npx hardhat compile` in `Aegis-contracts/`, run **`node frontend/scripts/copy-abis.mjs`** from the monorepo root to refresh `Crowdfunding.json`. The first on-chain campaign id is **`2`** (`nextCampaignId` starts at `1` and increments before assign). The Crowdfunding page reflects post-success **creator withdrawal delay** and **dispute** behavior from the latest `AegisCrowdShield` logic.

## File Structure

After running `npm run copy-abis`:

```
frontend/src/abis/
├── Token.json          # PrivateTokenContract ABI
├── Governance.json     # PrivateGovernance ABI
├── Staking.json        # PrivateStakingContract ABI
├── Lending.json        # PrivateLendingContract ABI
├── Insurance.json      # DecentralizedInsurance ABI
├── Crowdfunding.json   # AegisCrowdShield ABI
├── YieldFarming.json   # PrivateYieldFarming ABI
├── VerifierFactory.json # VerifierFactory ABI
├── GovernanceTreasury.json
├── TreasuryLiquidityAllocator.json
├── TokenAllocation.json
├── CrossChainPrivacyBridge.json
├── GovernanceControlledEmergency.json
├── PublicLiquidityPool.json
├── SonicGatewayWrapper.json
├── BondingCurve.json
├── DaoDynamicRevenueRouter.json
├── AegisPublicPoolRouter.json
├── TransparentEscrowOrders.json
└── index.ts            # ABI exports
```

## Troubleshooting

### "Artifact not found" error

**Problem**: Script can't find contract artifacts

**Solution**:
1. Make sure contracts are compiled:
   ```bash
   cd Aegis-contracts
   npx hardhat compile
   ```

2. Check artifact path is correct:
   - Script looks in: `Aegis-contracts/artifacts/contracts/`
   - Verify files exist at expected paths

### "ABI not found" error in frontend

**Problem**: Empty or missing ABI files

**Solution**:
1. Run `npm run copy-abis` again
2. Check `src/abis/` directory has JSON files
3. Verify JSON files contain `abi` array (not empty)

### Script fails silently

**Problem**: Script runs but doesn't copy ABIs

**Solution**:
1. Check console output for errors
2. Verify you're in the frontend directory
3. Check file permissions
4. Try running with `node scripts/copy-abis.mjs` directly

## Manual ABI Setup (Alternative)

If the script doesn't work, you can manually copy ABIs:

1. Open artifact file: `Aegis-contracts/artifacts/contracts/PrivateTokenContract.sol/PrivateTokenContract.json`
2. Copy the `abi` field
3. Create `frontend/src/abis/Token.json`:
   ```json
   {
     "contractName": "PrivateTokenContract",
     "abi": [/* paste ABI array here */]
   }
   ```
4. Repeat for all contracts

## Updating ABIs

After contract changes:

1. Recompile contracts:
   ```bash
   cd Aegis-contracts
   npx hardhat compile
   ```

2. Copy updated ABIs:
   ```bash
   cd ../frontend
   npm run copy-abis
   ```

3. Restart dev server if running

## Verification

To verify ABIs are loaded:

1. Check `src/abis/` directory has JSON files
2. Open a JSON file and verify it has an `abi` array
3. Check browser console for ABI-related errors
4. Try calling a contract function in the UI

## Notes

- Placeholder ABI files exist initially (empty arrays)
- Script will overwrite placeholders with actual ABIs
- ABIs are included in the build, so update them before production build
- TypeScript will type-check ABI usage
- **`AutomatedDutchAuction`** (TGE Dutch sale) is not copied into this app; use **`frontend-token-distribution/`** and its `npm run copy-abis` (or that package’s ABI layout) for the sale microsite.


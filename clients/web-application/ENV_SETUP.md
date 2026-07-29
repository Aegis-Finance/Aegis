# Environment Variables Setup

**Privacy program (phased checklist, mobile IA, disclosure budget):** [docs/AEGIS_HIDDEN_FORT_EXECUTION_PLAN.md](../docs/AEGIS_HIDDEN_FORT_EXECUTION_PLAN.md). **Client defaults (RPC, CSP, fingerprint):** [docs/PRIVACY_DEFAULTS_AND_FINGERPRINTING.md](../docs/PRIVACY_DEFAULTS_AND_FINGERPRINTING.md).

## Quick Start

1. **Copy the example file**:
   ```bash
   cp ENV_EXAMPLE.txt .env
   ```

2. **Update contract addresses** in `.env` after deployment

3. **Verify all addresses** are set correctly

## Required Variables

All **core** contract addresses are required for a full console build. Optional modules omit console warnings when unset (see `CONTRACT_METADATA.optional` in `src/config/contracts.ts`).

> **Token distribution (TGE Dutch):** canonical purchase + claim UX is **`frontend-token-distribution/`** (set `VITE_AUCTION_ADDRESS` there). The **main** `frontend/` is the long-lived ecosystem console **after** the sale window — it does not ship `AutomatedDutchAuction` wiring.

### Core Contracts

- `VITE_TOKEN_ADDRESS` – AEGIS token contract (`PrivateTokenContract`)
- `VITE_GOVERNANCE_ADDRESS` – Shielded voting + execution (`PrivateGovernance`)
- `VITE_VERIFIER_FACTORY_ADDRESS` – zk-SNARK verifier registry

### Treasury & Liquidity Control

- `VITE_GOVERNANCE_TREASURY_ADDRESS` – Timelocked treasury vault (`GovernanceTreasury`)
- `VITE_TREASURYLIQUIDITYALLOCATOR_ADDRESS` – DAO-owned liquidity allocator
- `VITE_TOKEN_ALLOCATION_ADDRESS` – Streams tranche allocations on-chain

### Economic & Privacy Modules

- `VITE_STAKING_ADDRESS` – Private staking contract
- `VITE_LENDING_ADDRESS` – Private lending contract
- `VITE_INSURANCE_ADDRESS` – Decentralised insurance pool
- `VITE_CROWDFUNDING_ADDRESS` – Aegis Crowd Shield
- `VITE_YIELD_FARMING_ADDRESS` – Private yield farming engine
- `VITE_LEADERBOARD_ADDRESS` – On-chain privacy leaderboard
- `VITE_PRIVATEAMMCONTRACT_ADDRESS` – Shielded AMM mirror

### Interop & Safety

- `VITE_SONIC_GATEWAY_WRAPPER_ADDRESS` – Gateway wrapper for Sonic bridge exits
- `VITE_CROSS_CHAIN_BRIDGE_ADDRESS` – Cross-chain privacy bridge
- `VITE_GOVERNANCE_EMERGENCY_ADDRESS` – Governance-controlled emergency circuit breaker

### Public Liquidity Pools (Optional)

Define pools using the prefix `VITE_POOL_<POOL_KEY>_*`. Example:

```env
VITE_POOL_AGS_SONIC_ADDRESS=0x...
VITE_POOL_AGS_SONIC_TOKEN_SYMBOL=AGS/S
VITE_POOL_AGS_SONIC_USE_NATIVE=true
```

## Address Format

All addresses must be valid Ethereum addresses:
- Format: `0x` followed by 40 hexadecimal characters
- Example: `0x1234567890123456789012345678901234567890`
- Case-insensitive, but checksum format recommended

## Getting Contract Addresses

After deploying contracts:

1. **Check deployment logs** in `Aegis-contracts/deployments/`
2. **Verify on SonicScan**: https://sonicscan.org
3. **Update `.env`** with actual addresses
4. **Test connection** in the frontend

## Validation

The frontend will:
- Show warnings if addresses are not set (0x0...)
- Throw errors if invalid addresses are used
- Display contract addresses in the UI for verification

## Example .env File

```env
# Core Contracts
VITE_TOKEN_ADDRESS=0xYourTokenAddressHere
VITE_GOVERNANCE_ADDRESS=0xYourGovernanceAddressHere
VITE_VERIFIER_FACTORY_ADDRESS=0xYourVerifierFactoryAddressHere

# Treasury & Liquidity
VITE_GOVERNANCE_TREASURY_ADDRESS=0xYourGovernanceTreasuryAddressHere
VITE_TREASURYLIQUIDITYALLOCATOR_ADDRESS=0xYourTreasuryAllocatorAddressHere
VITE_TOKEN_ALLOCATION_ADDRESS=0xYourTokenAllocationAddressHere

# Module Contracts
VITE_STAKING_ADDRESS=0xYourStakingAddressHere
VITE_LENDING_ADDRESS=0xYourLendingAddressHere
VITE_INSURANCE_ADDRESS=0xYourInsuranceAddressHere
VITE_CROWDFUNDING_ADDRESS=0xYourCrowdfundingAddressHere
VITE_YIELD_FARMING_ADDRESS=0xYourYieldFarmingAddressHere
VITE_LEADERBOARD_ADDRESS=0xYourLeaderboardAddressHere
VITE_PRIVATEAMMCONTRACT_ADDRESS=0xYourPrivateAmmAddressHere

# Interop & Safety
VITE_SONIC_GATEWAY_WRAPPER_ADDRESS=0xYourGatewayWrapperAddressHere
VITE_CROSS_CHAIN_BRIDGE_ADDRESS=0xYourBridgeAddressHere
VITE_GOVERNANCE_EMERGENCY_ADDRESS=0xYourEmergencyCircuitAddressHere
```

## Troubleshooting

**"Contract address not set" error:**
- Check `.env` file exists
- Verify variable names match exactly (case-sensitive)
- Ensure addresses are not `0x0000...`

**"ABI not found" error:**
- Run `npm run copy-abis` to copy ABIs from artifacts
- Verify contracts are compiled in Aegis-contracts

**Contract calls failing:**
- Verify addresses on SonicScan
- Check network is correct (Sonic Testnet/Mainnet)
- Ensure contracts are deployed and verified


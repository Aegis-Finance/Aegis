# Aegis DAO Frontend - Setup Summary

## ✅ What's Been Set Up

### 1. Environment Configuration

- **ENV_EXAMPLE.txt**: Template file with all required environment variables
- **Documentation**: See `ENV_SETUP.md` for detailed variable documentation
- **Validation**: Contract addresses are validated with helpful error messages

**Required Variables:**
- `VITE_TOKEN_ADDRESS` – PrivateTokenContract
- `VITE_GOVERNANCE_ADDRESS` – PrivateGovernance
- `VITE_VERIFIER_FACTORY_ADDRESS` – VerifierFactory
- `VITE_GOVERNANCE_TREASURY_ADDRESS` – GovernanceTreasury
- `VITE_TREASURYLIQUIDITYALLOCATOR_ADDRESS` – TreasuryLiquidityAllocator
- `VITE_TOKEN_ALLOCATION_ADDRESS` – TokenAllocation
- `VITE_STAKING_ADDRESS` – PrivateStakingContract
- `VITE_LENDING_ADDRESS` – PrivateLendingContract
- `VITE_INSURANCE_ADDRESS` – DecentralizedInsurance
- `VITE_CROWDFUNDING_ADDRESS` – AegisCrowdShield
- `VITE_YIELD_FARMING_ADDRESS` – PrivateYieldFarming
- `VITE_LEADERBOARD_ADDRESS` – OnChainPrivacyLeaderboard
- `VITE_PRIVATEAMMCONTRACT_ADDRESS` – PrivateAMMContract
- `VITE_SONIC_GATEWAY_WRAPPER_ADDRESS` – SonicGatewayWrapper
- `VITE_CROSS_CHAIN_BRIDGE_ADDRESS` – CrossChainPrivacyBridge
- `VITE_GOVERNANCE_EMERGENCY_ADDRESS` – GovernanceControlledEmergency
- `VITE_SONIC_GATEWAY_WRAPPER_ADDRESS` – Wrapper for Sonic Gateway exits

**Optional (per pool):** `VITE_POOL_<KEY>_ADDRESS`, `VITE_POOL_<KEY>_TOKEN_ADDRESS`, `VITE_POOL_<KEY>_TOKEN_SYMBOL`, `VITE_POOL_<KEY>_LP_SYMBOL`, `VITE_POOL_<KEY>_USE_NATIVE`

### 2. Contract ABI Integration

- **Copy Script**: `npm run copy-abis` automatically copies ABIs from artifacts
- **ABI Directory**: `src/abis/` with placeholder files ready for population
- **Helper Functions**: `src/utils/contracts.ts` provides type-safe contract getters
- **Auto-Import**: ABIs are automatically imported through `src/abis/index.ts`

**Setup Steps:**
1. Compile contracts: `cd Aegis-contracts && npx hardhat compile`
2. Copy ABIs: `cd ../frontend && npm run copy-abis`
3. ABIs are now available for use

## 📋 Setup Checklist

### Initial Setup
- [ ] Install dependencies: `npm install`
- [ ] Create `.env` from `ENV_EXAMPLE.txt`
- [ ] Update `.env` with deployed contract addresses
- [ ] Compile contracts: `cd ../Aegis-contracts && npx hardhat compile`
- [ ] Copy ABIs: `npm run copy-abis`
- [ ] Build once to generate hash manifest: `npm run build`
- [ ] Start dev server: `npm run dev`

### Verification
- [ ] All contract addresses set in `.env`
- [ ] All ABI files exist in `src/abis/` (not empty)
- [ ] No console warnings about missing addresses
- [ ] Wallet connection works
- [ ] Can view contract data in UI

## 🚀 Quick Start

```bash
# 1. Install
npm install

# 2. Setup environment
cp ENV_EXAMPLE.txt .env
# Edit .env with your contract addresses

# 3. Setup ABIs
cd ../Aegis-contracts && npx hardhat compile
cd ../frontend && npm run copy-abis

# 4. Run
npm run dev
```

## 📚 Documentation Files

- **README.md** - Main documentation
- **QUICK_START.md** - 5-minute setup guide
- **SETUP.md** - Detailed setup instructions
- **ENV_SETUP.md** - Environment variable documentation
- **ABI_SETUP.md** - ABI setup and troubleshooting
- **DEPLOYMENT.md** - Arweave deployment guide
- **ARCHITECTURE.md** - Technical architecture
- **ENV_EXAMPLE.txt** - Environment variable template

## 🔧 Key Files

### Configuration
- `src/config/contracts.ts` - Contract addresses and network config
- `.env` - Your environment variables (create from ENV_EXAMPLE.txt)
- `src/vite-env.d.ts` - TypeScript environment variable types

### ABIs
- `src/abis/` - Contract ABIs (populated by copy-abis script)
- `src/abis/index.ts` - ABI exports
- `scripts/copy-abis.mjs` - ABI copy script

### Utilities
- `src/utils/contracts.ts` - Contract instance helpers
- `src/utils/format.ts` - Formatting utilities

## ⚠️ Important Notes

1. **Environment Variables**: All contract addresses must be set in `.env`
2. **ABIs**: Must run `npm run copy-abis` after compiling contracts
3. **One-Time Release**: Frontend is immutable once deployed to Arweave
4. **ZK Proofs**: Proof generation not implemented in frontend (requires service)

## 🐛 Common Issues

**"Contract address not set"**
- Solution: Update `.env` file with actual addresses

**"ABI not found"**
- Solution: Run `npm run copy-abis` after compiling contracts

**Module not found errors**
- Solution: Run `npm install` to install dependencies

**TypeScript errors**
- Solution: These are expected until `npm install` is run

## 📞 Next Steps

1. Deploy contracts to Sonic network
2. Update `.env` with deployed addresses
3. Copy ABIs from artifacts
4. Test all modules
5. Deploy frontend to Arweave

See individual documentation files for detailed instructions.


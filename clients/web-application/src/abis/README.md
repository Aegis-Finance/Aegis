# Contract ABIs

This directory contains the contract ABIs imported from the compiled artifacts.

## Setup

1. **Compile contracts** (in Aegis-contracts directory):
   ```bash
   cd ../Aegis-contracts
   npx hardhat compile
   ```

2. **Copy ABIs to frontend**:
   ```bash
   cd ../frontend
   npm run copy-abis
   ```

## Files

After running `npm run copy-abis`, you should have:

- `Token.json` - PrivateTokenContract ABI
- `Governance.json` - PrivateGovernance ABI
- `Staking.json` - PrivateStakingContract ABI
- `Lending.json` - PrivateLendingContract ABI
- `Insurance.json` - DecentralizedInsurance ABI
- `Crowdfunding.json` - AegisCrowdShield ABI
- `YieldFarming.json` - PrivateYieldFarming ABI
- `VerifierFactory.json` - VerifierFactory ABI

## Usage

Import ABIs through the index file:

```typescript
import { ABIS, GovernanceABI } from '@/abis'
import { getGovernanceContract } from '@/utils/contracts'

// Use ABI directly
const contract = new Contract(address, ABIS.Governance, provider)

// Or use helper function
const contract = getGovernanceContract(provider)
```

## Note

If ABIs are missing, the copy script will show warnings. Make sure:
1. Contracts are compiled in Aegis-contracts
2. Artifact paths are correct
3. Script has read access to artifacts directory


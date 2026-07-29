# Aegis DAO Frontend - Setup Guide

Complete setup instructions for the Aegis DAO frontend application.

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env with your contract addresses

# 3. Start development server
npm run dev

# 4. Build for production
npm run build
```

## Detailed Setup

### 1. Environment Configuration

1. **Create environment file**:
   ```bash
   # Copy the example template
   cp ENV_EXAMPLE.txt .env
   # Or manually create .env based on ENV_EXAMPLE.txt
   ```

2. **Update contract addresses** in `.env` after deployment:
   ```env
   VITE_TOKEN_ADDRESS=0xYourTokenAddress
   VITE_GOVERNANCE_ADDRESS=0xYourGovernanceAddress
   VITE_GOVERNANCE_TREASURY_ADDRESS=0xYourGovernanceTreasuryAddress
   VITE_TREASURYLIQUIDITYALLOCATOR_ADDRESS=0xYourTreasuryAllocatorAddress
   VITE_TOKEN_ALLOCATION_ADDRESS=0xYourTokenAllocationAddress
   VITE_STAKING_ADDRESS=0xYourStakingAddress
   VITE_LENDING_ADDRESS=0xYourLendingAddress
   VITE_INSURANCE_ADDRESS=0xYourInsuranceAddress
   VITE_CROWDFUNDING_ADDRESS=0xYourCrowdfundingAddress
   VITE_YIELD_FARMING_ADDRESS=0xYourYieldFarmingAddress
   VITE_VERIFIER_FACTORY_ADDRESS=0xYourVerifierFactoryAddress
   VITE_LEADERBOARD_ADDRESS=0xYourLeaderboardAddress
   VITE_PRIVATEAMMCONTRACT_ADDRESS=0xYourPrivateAmmAddress
   VITE_SONIC_GATEWAY_WRAPPER_ADDRESS=0xYourGatewayWrapperAddress
   VITE_CROSS_CHAIN_BRIDGE_ADDRESS=0xYourBridgeAddress
   VITE_GOVERNANCE_EMERGENCY_ADDRESS=0xYourEmergencyCircuitAddress
   ```

3. **(Optional) Configure public pools** using `VITE_POOL_<POOL_KEY>_...` variables (see `ENV_EXAMPLE.txt` for format) so liquidity dashboards mirror on-chain manifests.

See `ENV_EXAMPLE.txt` for all required variables and `ENV_SETUP.md` for detailed documentation.

### 2. Contract ABIs

The frontend uses a script to automatically copy ABIs from compiled artifacts:

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

This will copy all contract ABIs from `Aegis-contracts/artifacts/contracts/` to `frontend/src/abis/`.

The ABIs are then imported automatically through `src/abis/index.ts` and used via helper functions in `src/utils/contracts.ts`.

**Note**: Placeholder ABI files exist initially. They will be populated after running `npm run copy-abis`.

### 3. Network Configuration

Default network is Sonic Testnet. To change:

1. Edit `src/config/contracts.ts`
2. Update `DEFAULT_NETWORK` constant
3. Update RPC URLs if needed

### 4. ZK Proof Integration

**Important**: ZK proof generation is not implemented in the frontend. For production:

1. Integrate with your ZK proof generation service
2. Update contract interaction functions to include proofs
3. Handle proof generation before submitting transactions

Example integration point:
```typescript
// In contract interaction functions
const zkProof = await generateZKProof(params)
await contract.functionName(zkProof, ...otherParams)
```

## Development

### Available Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run preview` - Preview production build
- `npm run lint` - Run ESLint

### Development Tips

1. **Hot Reload**: Changes automatically reload in browser
2. **Console Logs**: Check browser console for debugging
3. **Network Tab**: Monitor RPC calls in browser DevTools
4. **React Query DevTools**: Install for data fetching debugging

## Testing

### Manual Testing Checklist

- [ ] Wallet connection (MetaMask)
- [ ] RPC node selection
- [ ] All module pages load
- [ ] Contract interactions work
- [ ] Event explorer functions
- [ ] Responsive design on mobile

### Testing with Local Node

1. Start local Hardhat node:
   ```bash
   cd Aegis-contracts
   npx hardhat node
   ```

2. Deploy contracts to local node:
   ```bash
   npx hardhat run scripts/deploy.js --network localhost
   ```

3. Update `.env` with local contract addresses

4. Set RPC to `http://127.0.0.1:8545` in frontend

## Production Build

### Build Optimization

The build is optimized for:
- Minimal bundle size
- Fast loading
- Tree shaking
- Code splitting

### Build Output

After `npm run build`:
- `dist/` contains all production files
- Ready for static hosting
- No server required

### Deployment Size

Expected build size:
- Initial bundle: ~200-300 KB (gzipped)
- Total assets: ~500 KB - 1 MB

## Troubleshooting

### Common Issues

**Wallet not connecting:**
- Check MetaMask is installed
- Verify network is correct
- Check RPC endpoint is accessible

**Contract calls failing:**
- Verify contract addresses in `.env`
- Check contract ABIs are correct
- Ensure wallet has sufficient balance

**Events not loading:**
- Verify RPC node supports `eth_getLogs`
- Check block range is reasonable
- Ensure contract address is correct

**Build errors:**
- Clear `node_modules` and reinstall
- Check TypeScript version compatibility
- Verify all dependencies are installed

## Architecture Notes

### State Management

- **Zustand**: Wallet and global state
- **React Query**: Blockchain data fetching and caching
- **Local State**: Component-specific state with `useState`

### Data Flow

1. User action → Zustand store update
2. React Query fetches from blockchain
3. UI updates with fresh data
4. Optimistic updates for better UX

### Security

- No private keys stored
- All signing via wallet
- RPC selection for user control
- On-chain verification only

## Next Steps

1. **Deploy Contracts**: Deploy all contracts to Sonic network
2. **Update Addresses**: Update `.env` with deployed addresses
3. **Test Thoroughly**: Test all functionality
4. **Deploy Frontend**: Deploy to Arweave
5. **Configure Domain**: Point `.sonic` domain to Arweave

## Support

For issues:
1. Check contract documentation
2. Review on-chain events
3. Verify governance proposals
4. Check browser console for errors


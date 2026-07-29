# Local Testing Guide

## Current Status

✅ **Dependencies**: Installed
✅ **ABIs**: Copied from artifacts (18 contracts)
✅ **TypeScript**: All errors fixed
✅ **Environment**: `.env` file created from template

## Running the Dev Server

```bash
cd frontend
npm run dev
```

The server will start on `http://localhost:3000` and automatically open in your browser.

## What to Test

### 1. Basic UI
- [ ] Home page loads
- [ ] Navigation works (all pages accessible)
- [ ] Dark theme displays correctly
- [ ] Terminal aesthetic is visible

### 2. Wallet Connection
- [ ] Wallet button appears
- [ ] Can connect MetaMask (if installed)
- [ ] Can connect via RPC selector
- [ ] Wallet address displays when connected

### 3. Contract Integration
- [ ] No console errors about missing contract addresses
- [ ] Contract address warnings appear (expected - addresses are placeholders)
- [ ] ABI errors don't appear (ABIs are loaded)

### 4. Module Pages
- [ ] Governance page loads
- [ ] Treasury + Allocation components render (Governance Treasury & Token Allocation widgets)
- [ ] Staking page loads
- [ ] Lending page loads
- [ ] Insurance page loads
- [ ] Crowdfunding page loads
- [ ] Yield Farming page loads
- [ ] Bridge (Sonic Gateway / Cross-Chain) components render
- [ ] Explorer page loads
- [ ] Wallet page loads

### 5. Functionality (Requires Deployed Contracts)
- [ ] Can view proposals (if any exist)
- [ ] Can view timelock queue / governance treasury events
- [ ] Can view staking pools
- [ ] Can view lending pools
- [ ] Can view insurance policies
- [ ] Can view crowdfunding campaigns
- [ ] Can review bridge validator parameters and queued transfers
- [ ] Can view treasury liquidity allocator positions (requires `VITE_POOL_*` entries)

## Expected Warnings

These are **normal** and expected:

1. **Contract Address Warnings**: 
   ```
   ⚠️ VITE_TOKEN_ADDRESS not set. Update .env file...
   ```
   - This is expected until you deploy contracts and update `.env`

2. **Network Connection Errors**:
   - If contracts aren't deployed, you'll see connection errors
   - This is normal for local testing without deployed contracts

## Troubleshooting

### Server won't start
- Check if port 3000 is already in use
- Try: `npm run dev -- --port 3001`

### TypeScript errors
- Run: `npm run build` to see all errors
- Most should be fixed, but check console

### Module not found errors
- Make sure `npm install` completed successfully
- Check `node_modules` directory exists

### ABIs not loading
- Run: `npm run copy-abis` again
- Check `src/abis/` has JSON files with non-empty `abi` arrays

## Next Steps After Testing

1. **Deploy Contracts**: Deploy to Sonic testnet
2. **Update .env**: Add actual contract addresses
3. **Test Interactions**: Try actual contract calls
4. **Deploy Frontend**: Deploy to Arweave for permanent hosting

## Notes

- The frontend is designed to work **without** a backend
- All data comes directly from blockchain
- ZK proof generation requires a separate service (not in frontend)
- Some features require deployed contracts to test fully


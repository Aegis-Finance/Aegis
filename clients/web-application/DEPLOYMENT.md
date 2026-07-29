# Aegis DAO Frontend Deployment Guide

This guide covers deploying the Aegis DAO frontend to Arweave for permanent, decentralized hosting.

## Prerequisites

1. **Arweave Wallet**: Create or import an Arweave wallet
2. **Funds**: Ensure your wallet has sufficient AR tokens for deployment
3. **Build**: Complete frontend build (`npm run build`)

## Deployment Methods

### Method 1: Using Arweave CLI

1. Install Arweave CLI:
   ```bash
   npm install -g arweave-cli
   ```

2. Build the frontend (generates `dist/manifest.hash.json` automatically):
   ```bash
   npm run build
   ```

3. Deploy to Arweave:
   ```bash
   arweave deploy dist --wallet path/to/wallet.json
   ```

4. Note the transaction ID returned

### Method 2: Using Bundlr Network

1. Install Bundlr CLI:
   ```bash
   npm install -g @bundlr-network/client
   ```

2. Build the frontend:
   ```bash
   npm run build
   ```

3. Deploy:
   ```bash
   bundlr upload dist -w path/to/wallet.json
   ```

### Method 3: Using ArDrive

1. Install ArDrive:
   ```bash
   npm install -g ardrive-cli
   ```

2. Build and upload:
   ```bash
   npm run build
   ardrive upload-file -F dist -w path/to/wallet.json
   ```

## Post-Deployment

### 1. Update `.sonic` Domain

Point the DAO-owned domain (`https://aegiscoin.sonic`) to the new Arweave transaction ID and mirror the same content hash in the sovereign-node bundle manifests:

```javascript
// Example domain update
await sonicDomain.setContentHash(arweaveTxId)
```

### 2. Verify Deployment

1. Access your frontend via the Arweave gateway:
   ```
   https://arweave.net/{transaction-id}
   ```

2. Or via your `.sonic` domain:
   ```
  https://aegiscoin.sonic
   ```

3. Retrieve `dist/manifest.hash.json` from Arweave and compare against a local build:
   ```bash
   npm run build
   node scripts/hash-dist.js # already executed during build, ensures manifest exists
   diff <(jq -S . dist/manifest.hash.json) <(curl -s https://arweave.net/{transaction-id}/manifest.hash.json | jq -S .)
   ```

### 3. Update Contract Addresses

Ensure all contract addresses in the frontend configuration match your deployed contracts and the manifests referenced in governance proposals (treasury allocator, token allocation, bridge, etc.).

## Gateway Options

Users can access your frontend through:

1. **Arweave Gateway**: `https://arweave.net/{tx-id}`
2. **.sonic Domain**: `https://your-domain.sonic`
3. **IPFS Mirror** (optional): Mirror to IPFS for additional redundancy

## Security Checklist

- [ ] All contract addresses are correct
- [ ] No sensitive data in build output
- [ ] RPC endpoints are properly configured
- [ ] Wallet connection flow tested
- [ ] All modules accessible and functional

## Troubleshooting

### Build Errors

- Ensure all dependencies are installed: `npm install`
- Check TypeScript errors: `npm run lint`
- Verify environment variables are set

### Deployment Errors

- Check wallet has sufficient AR balance
- Verify network connectivity
- Try alternative deployment method

### Runtime Errors

- Check browser console for errors
- Verify RPC node is accessible
- Ensure contract addresses are correct

## Maintenance

Since this is a one-time release:

1. **No Updates**: The frontend is immutable once deployed
2. **Contract Updates**: Only contract upgrades via governance affect functionality
3. **User Forks**: Users can fork and redeploy if needed

## Support

For issues or questions:
- Check contract documentation
- Review on-chain events via Explorer
- Verify governance proposals for protocol changes


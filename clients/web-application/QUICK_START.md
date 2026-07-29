# Quick Start Guide

Get the Aegis DAO frontend running in 5 minutes.

## Step 1: Install Dependencies

```bash
cd frontend
npm install
```

## Step 2: Set Up Environment

1. **Create `.env` file**:
   ```bash
   # Copy the example
   cp ENV_EXAMPLE.txt .env
   ```

2. **Update `.env`** with your deployed contract addresses:
   ```env
   VITE_TOKEN_ADDRESS=0xYourActualTokenAddress
   VITE_GOVERNANCE_ADDRESS=0xYourActualGovernanceAddress
   # ... etc (see ENV_EXAMPLE.txt for all variables)
   ```

## Step 3: Copy Contract ABIs

```bash
# First, compile contracts (if not already compiled)
cd ../Aegis-contracts
npx hardhat compile

# Then copy ABIs to frontend
cd ../frontend
npm run copy-abis
```

## Step 4: Start Development Server

```bash
npm run dev
```

The app will open at `http://localhost:3000`

## What You Need

### Required
- ✅ Node.js 18+
- ✅ Contract addresses (after deployment)
- ✅ Compiled contracts (for ABIs)

### Optional
- MetaMask wallet (for wallet connection)
- Local Sonic node (for testing)

## Troubleshooting

**"Contract address not set" warning:**
- Update `.env` file with actual addresses
- Restart dev server after changing `.env`

**"ABI not found" error:**
- Run `npm run copy-abis` to copy ABIs
- Make sure contracts are compiled first

**Module not found errors:**
- Run `npm install` to install dependencies
- Check Node.js version (18+ required)

## Next Steps

- Connect wallet to interact with contracts
- Explore modules via sidebar navigation
- Check Explorer for on-chain events
- Review `SETUP.md` for detailed configuration


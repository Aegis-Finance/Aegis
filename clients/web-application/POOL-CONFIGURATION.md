# Pool Configuration Guide

## Overview

The frontend now supports loading pools from two sources:
1. **Environment Variables** (`VITE_POOL_*`) - Pool addresses after deployment
2. **JSON Config** (`liquidity-pools.json`) - Token information from blockchain config

## How It Works

### Current State (Before Deployment)

Right now, you'll only see pools that have `VITE_POOL_<TOKEN>_ADDRESS` set in your `.env` file. For example, if you only have:

```env
VITE_POOL_WETH_ADDRESS=0x...
```

Then only WETH pool will show up in the swap interface.

### After Deployment

Once pools are deployed and addresses are known, you can add them to `.env`:

```env
# Native Sonic pool
VITE_POOL_SONIC_ADDRESS=0x...
VITE_POOL_SONIC_TOKEN_SYMBOL=S (native)
VITE_POOL_SONIC_USE_NATIVE=true

# Wrapped Sonic pool
VITE_POOL_WS_ADDRESS=0x...
VITE_POOL_WS_TOKEN_SYMBOL=wS (wrapped)
VITE_POOL_WS_TOKEN_ADDRESS=0x039e2fB66102314Ce7b64Ce5Ce3E5183bc94aD38
VITE_POOL_WS_USE_NATIVE=false

# USDC pool
VITE_POOL_USDC_ADDRESS=0x...
VITE_POOL_USDC_TOKEN_SYMBOL=USDC
VITE_POOL_USDC_TOKEN_ADDRESS=0x0BA304580ee7c9a980CF72e55f5Ed2E9fd30Bc51
VITE_POOL_USDC_USE_NATIVE=false

# USDT pool
VITE_POOL_USDT_ADDRESS=0x...
VITE_POOL_USDT_TOKEN_SYMBOL=USDT
VITE_POOL_USDT_TOKEN_ADDRESS=0x6047828dc181963ba44974801FF68e538dA5eaF9
VITE_POOL_USDT_USE_NATIVE=false

# WETH pool
VITE_POOL_WETH_ADDRESS=0x...
VITE_POOL_WETH_TOKEN_SYMBOL=WETH
VITE_POOL_WETH_TOKEN_ADDRESS=0x50c42dEAcD8Fc9773493ED674b675bE577f2634b
VITE_POOL_WETH_USE_NATIVE=false
```

## Supported Tokens

The system supports these tokens (from `liquidity-pools.json`):
- **S (native)** - Native Sonic token
- **wS (wrapped)** - Wrapped Sonic token
- **USDC** - USD Coin
- **USDT** - Tether USD
- **WETH** - Wrapped Ethereum

## Token Addresses

### Testnet
- S/wS: `0x039e2fB66102314Ce7b64Ce5Ce3E5183bc94aD38`
- USDC: `0x0BA304580ee7c9a980CF72e55f5Ed2E9fd30Bc51`
- USDT: `0x6047828dc181963ba44974801FF68e538dA5eaF9`
- WETH: `0x50c42dEAcD8Fc9773493ED674b675bE577f2634b`

### Mainnet
- S/wS: `0x039e2fB66102314Ce7b64Ce5Ce3E5183bc94aD38`
- USDC: `0x29219dd400f2Bf60E5a23d13Be72B486D4038894`
- USDT: `0x6047828dc181963ba44974801FF68e538dA5eaF9`
- WETH: `0x50c42dEAcD8Fc9773493ED674b675bE577f2634b`

## Automatic Configuration

The frontend will:
1. Load pool addresses from `.env` (required - these come after deployment)
2. Fill in token information from `liquidity-pools.json` automatically
3. Match pools by token symbol or address
4. Show all configured pools in the swap interface

## Next Steps

1. **Deploy pools** using the contracts deployment scripts
2. **Get pool addresses** from deployment manifests
3. **Add to `.env`** using the format above
4. **Refresh frontend** - all pools will appear automatically

The JSON config (`liquidity-pools.json`) provides the token metadata, so you only need to add pool addresses to `.env` after deployment.


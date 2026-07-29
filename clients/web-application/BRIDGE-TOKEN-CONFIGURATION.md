# Bridge Token Configuration Guide

## Overview

The Bridge tab loads the token list from `public/config/sonic-chain-pack.json` (synced from `Aegis-contracts` via `npm run sync:chain-pack` / `gen:frontend-env`), with a fallback to `bridge-tokens.json`. Each row can include **`settlementRail`** (also auto-filled in the chain pack when missing: USDC → `circle-cctp-v2`, other non-AGS → `sonic-gateway-native`).

**Sonic Gateway infra (bridge + L1 deposit):** canonical addresses live in `Aegis-contracts/config/sonic-infrastructure.json`. Run `node Aegis-contracts/scripts/generate-frontend-env.js` so `VITE_SONIC_*` / `VITE_ETH_GATEWAY_*` are written and the same JSON is copied to `frontend/public/config/sonic-infrastructure.json` for static reads.

## How It Works

### Current State

1. **Token Config File**: `frontend/src/config/bridge-tokens.json` defines all potentially bridgeable tokens
2. **Bridge Config Module**: `frontend/src/config/bridge.ts` loads tokens from JSON
3. **Component**: `SonicGatewayConverter` displays a token selector and queries wrapper contract for support status

Optional **`settlementRail`** on a token row drives UI copy (e.g. `circle-cctp-v2` for USDC per [Sonic Gateway](https://docs.soniclabs.com/sonic/sonic-gateway) — CCTP). It does **not** automate Circle or Gateway transactions; it only labels the correct off-chain/on-official-app steps before using `convertToPrivate`.

Bridge → Swap handoff: `setBridgeSwapIntent` in `src/utils/bridgeSwapIntent.ts` (sessionStorage) pre-fills amount and can resolve the pool from `tokenSymbol` / `tokenAddress` when the URL omits `pool`. Swap applies URL params first, then consumes intent once.

### Token Selection

The Bridge tab now includes:
- **Token Selector Dropdown**: Shows all tokens from `bridge-tokens.json`
- **Support Status**: Queries `SonicGatewayWrapper.getConversionInfo()` for each token to verify if it's actually supported
- **Dynamic Balance**: Shows balance for the selected token
- **Proper Decimals**: Handles token decimals correctly (18 for most, configurable per token)

## Configuration Files

### `Aegis-contracts/config/bridge-tokens.json`

Defines which tokens can potentially be bridged:

```json
{
  "sonicTestnet": [
    {
      "tokenSymbol": "AGS",
      "tokenAddress": "0x0000000000000000000000000000000000000000",
      "enabled": true,
      "description": "Aegis native token"
    },
    {
      "tokenSymbol": "USDC",
      "tokenAddress": "0x0BA304580ee7c9a980CF72e55f5Ed2E9fd30Bc51",
      "enabled": true,
      "description": "USD Coin - bridged from Ethereum"
    },
    // ... more tokens
  ]
}
```

**Note**: AGS uses `0x0000000000000000000000000000000000000000` as placeholder. The frontend resolves this to the actual AGS contract address from `CONTRACT_ADDRESSES.TOKEN`.

### `frontend/src/config/bridge-tokens.json`

Mirror of the contracts config file for frontend use.

### `frontend/src/config/bridge.ts`

TypeScript module that:
- Loads tokens from JSON config
- Normalizes token IDs
- Provides helper functions to get tokens by symbol/address

## Frontend Integration

### `SonicGatewayConverter` Component

The component now:
1. Loads all bridge tokens from config on mount
2. Defaults to AGS token (or first token if AGS not available)
3. Allows user to select any token from dropdown
4. Queries wrapper contract to verify support status
5. Shows appropriate balance and decimals for selected token
6. Handles approval and conversion for any supported token

### Key Features

- **Token Selector**: Dropdown showing all configured tokens
- **Support Verification**: Automatically checks if token is supported by wrapper contract
- **Dynamic Decimals**: Handles tokens with different decimal places
- **Balance Display**: Shows balance for selected token
- **Error Handling**: Warns if token is not supported by wrapper

## Environment Generation

The `generate-frontend-env.js` script now also generates bridge token entries:

```env
# Bridge Tokens (for Sonic Gateway Wrapper)
VITE_BRIDGE_TOKEN_AGS_ADDRESS=0x...
VITE_BRIDGE_TOKEN_AGS_SYMBOL=AGS
VITE_BRIDGE_TOKEN_AGS_DESCRIPTION=Aegis native token

VITE_BRIDGE_TOKEN_USDC_ADDRESS=0x...
VITE_BRIDGE_TOKEN_USDC_SYMBOL=USDC
# ... etc
```

**Note**: These env vars are currently informational. The frontend loads tokens from the JSON config file directly.

## Supported Tokens

### Testnet
- **AGS**: Aegis native token (uses `CONTRACT_ADDRESSES.TOKEN`)
- **USDC**: `0x0BA304580ee7c9a980CF72e55f5Ed2E9fd30Bc51`
- **USDT**: `0x6047828dc181963ba44974801FF68e538dA5eaF9`
- **WETH**: `0x50c42dEAcD8Fc9773493ED674b675bE577f2634b`

### Mainnet
- **AGS**: Aegis native token
- **USDC**: `0x29219dd400f2Bf60E5a23d13Be72B486D4038894`
- **USDT**: `0x6047828dc181963ba44974801FF68e538dA5eaF9`
- **WETH**: `0x50c42dEAcD8Fc9773493ED674b675bE577f2634b`

## Adding New Tokens

To add a new bridge token:

1. **Add to Config**: Edit `Aegis-contracts/config/bridge-tokens.json`:
   ```json
   {
     "tokenSymbol": "NEWTOKEN",
     "tokenAddress": "0x...",
     "enabled": true,
     "description": "New token description"
   }
   ```

2. **Copy to Frontend**: Copy the same entry to `frontend/src/config/bridge-tokens.json`

3. **Add Token Mapping** (optional): Update `TOKEN_ID_MAP` in `frontend/src/config/bridge.ts` if needed

4. **Deploy Support**: Ensure `SonicGatewayWrapper.addSupportedToken()` is called via governance to enable the token in the wrapper contract

## How Tokens Are Verified

The component queries `SonicGatewayWrapper.getConversionInfo(tokenAddress)` for each selected token:
- Returns: `(supported: bool, rate: uint256, feeBps: uint256)`
- If `supported` is `false`, shows a warning to the user
- If `supported` is `true`, allows conversion

**Note**: Just because a token is in the config doesn't mean it's supported by the wrapper contract. The config lists *potential* tokens, while the contract determines which are *actually* supported.

## Next Steps

After deployment:
1. Run `node scripts/generate-frontend-env.js` to regenerate `.env` with bridge token addresses
2. Ensure `SonicGatewayWrapper` has tokens added via governance: `addSupportedToken(tokenAddress, conversionRate)`
3. The frontend will automatically show supported tokens and verify support status


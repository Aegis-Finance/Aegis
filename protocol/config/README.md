# Aegis contract config (JSON)

## `sonic-chain-pack.json`

**Generated file** — do not edit by hand. Run `npm run sync:chain-pack` (or `npm run gen:frontend-env`, which runs it first). It merges `bridge-tokens.json`, `sonic-infrastructure.json`, and `uniswap-v3-sonic.json` plus Sonic “build on Sonic” doc links ([programmatic Gateway](https://docs.soniclabs.com/sonic/build-on-sonic/programmatic-gateway), [staking / SFC](https://docs.soniclabs.com/sonic/build-on-sonic/integrating-staking), [network parameters](https://docs.soniclabs.com/sonic/build-on-sonic/network-parameters), [verify](https://docs.soniclabs.com/sonic/build-on-sonic/verify-contracts), [deploy](https://docs.soniclabs.com/sonic/build-on-sonic/deploy-contracts)).

Copied to both frontends’ `public/config/` when running `generate-frontend-env.js`.

## `bridge-tokens.json`

Used by `scripts/generate-frontend-env.js` to emit `VITE_BRIDGE_TOKEN_*` keys for the privacy bridge UI.

- **`sonic`** / **`sonicTestnet`** rows should match [Sonic contract addresses](https://docs.soniclabs.com/sonic/build-on-sonic/contract-addresses) for listed assets (wS, USDC, EURC, USDT, WETH, …).
- **`enabled: false`** means the row is not emitted into `.env` until you turn it on (optional assets only).
- **AGS:** both networks ship `tokenAddress` `0x0` until deploy. After `PrivateTokenContract` is deployed, set the real address in this file **and** `frontend/src/config/bridge-tokens.json`, then run `scripts/generate-frontend-env.js`. See `meta.requiredAfterDeploy` in `bridge-tokens.json`.

## `uniswap-v3-sonic.json`

Addresses for **Uniswap v3 on Sonic mainnet** (factory, position manager, routers). Pass these into `AutomatedLiquidityDeployer` / treasury scripts at deploy time. Source: Uniswap governance / incentive package references in the JSON file.

## `sonic-infrastructure.json`

Machine-readable **Sonic Labs canonical infra** from [Contract addresses](https://docs.soniclabs.com/sonic/build-on-sonic/contract-addresses): Multicall3, SFC, FTM→S portal, **Gateway on Sonic** (bridge, token pairs, oracles, …), **Gateway on Ethereum** (TokenDeposit, TokenPairs, …). Testnet tab only lists Multicall3 here; extend when Sonic publishes more.

- Consumed by `scripts/generate-frontend-env.js` (emits `VITE_SONIC_*` into `.env` and copies this file to `frontend/public/config/` and `frontend-token-distribution/public/config/` for static reads).
- Solidity constants in `contracts/wrappers/SonicGatewayWrapper.sol` should stay in sync with `gatewaySonic` / `gatewayEthereum` subsets.

## Cross-links

- Full Sonic token + FeeM + Gateway tables: [`../docs/SONIC_CANONICAL_DATA.md`](../docs/SONIC_CANONICAL_DATA.md)
- Product map (what Aegis modules consume which assets): [`../docs/SONIC_DEFI_AND_SUPPORTED_ASSETS.md`](../docs/SONIC_DEFI_AND_SUPPORTED_ASSETS.md)

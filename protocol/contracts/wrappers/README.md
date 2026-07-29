# Wrappers

## `SonicGatewayWrapper`

Post-bridge helper: users bring **standard** ERC-20 (e.g. AGS already on Sonic) and opt into Aegis **shield** flow. It does **not** submit Sonic Gateway `claim` transactions or Merkle proofs; bridging itself follows [Sonic Gateway](https://docs.soniclabs.com/sonic/sonic-gateway) and [Programmatic Gateway](https://docs.soniclabs.com/sonic/build-on-sonic/programmatic-gateway).

**Canonical Sonic mainnet addresses** baked into the contract match the official **Contract addresses** table:

https://docs.soniclabs.com/sonic/build-on-sonic/contract-addresses  

Machine-readable mirrors: [`config/sonic-infrastructure.json`](../../config/sonic-infrastructure.json) and merged [`config/sonic-chain-pack.json`](../../config/sonic-chain-pack.json) (`npm run sync:chain-pack`) — keep in lockstep with Solidity constants here. `convertToPrivate` validates **AGS-only** before any token pull so mis-listed tokens cannot get stuck in this contract.

**Who may call `addSupportedToken` / admin:** the address stored as `governanceContract` (typically `PrivateGovernance`), **or** the `owner()` of that contract (deployer until ownership is transferred to timelock/DAO). This lets the deployment orchestrator bootstrap AGS support without a prior governance proposal.

If Sonic publishes an address change, update this contract **after** verifying on [SonicScan](https://sonicscan.org/) and the doc above.

See also: [`docs/SONIC_CANONICAL_DATA.md`](../../docs/SONIC_CANONICAL_DATA.md).

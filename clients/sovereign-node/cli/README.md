# CLI (internal engine)

Headless **engine** for the Aegis desktop app — not a user-facing product. Downloads Sonic binaries, runs the loopback RPC proxy and circuits server. Desktop starts this automatically; operators may still use commands for debugging.

## Current Features

- `aegis-node install` – download & verify platform-specific Sonic binary based on `shared/binaries.json`.
- `aegis-node start` – launch the node with RPC on `127.0.0.1:8545`, WS on `8546`, P2P on `30303`.
- `aegis-node stop` – gracefully terminate the managed process.
- `aegis-node status` – show process state plus RPC health (`eth_syncing`, `eth_blockNumber`, `net_peerCount`).
- `aegis-node update` – force re-installation when a newer manifest entry exists.

## Usage

```
cd sovereign-node-app/cli
npm install
npx tsx src/index.ts install --network sonic-testnet
npx tsx src/index.ts start --network sonic-testnet
```

By default binaries are stored under `~/.aegis/sonic-node`. The manifest is shared with other companion apps.

## Local RPC + circuit static server

`src/server.ts` exposes:

- **POST /** — JSON-RPC proxy to upstreams listed in `shared/config.json` (or `config.example.json`). Only standard `eth_*` / `net_*` / `web3_clientVersion` methods are forwarded (no open HTTP proxy).
- **GET /circuits/** — static files under the configured `circuits.root`, with `..` traversal blocked and optional SHA-256 integrity checks.

```bash
npm run dev:proxy   # tsx src/server.ts
npm run start:proxy # node dist/server.js (after npm run build)
```


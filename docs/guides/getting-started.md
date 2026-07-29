# Getting started

## Users

1. Add Sonic mainnet to your wallet (chain ID **146**, RPC `https://rpc.soniclabs.com`).
2. Import AGS: `0x5125bF734a95F2Df0ddEf99934dc33fb1d175E3d` (18 decimals).
3. Open the published app URLs in [RELEASES.md](../../RELEASES.md), or install the **sovereign node** for a native desktop build.

## Auditors

```bash
cd protocol
npm ci
npm run compile
npm test
```

Circom sources: `protocol/circuits/`. Review policy: [circuits-open-source.md](../circuits-open-source.md).

## Building clients (same repository)

All clients live under `clients/`. They are **not** separate repositories.

| Client | Directory |
|--------|-----------|
| Web application | `clients/web-application/` |
| Token sale | `clients/token-sale/` |
| Sovereign node | `clients/sovereign-node/` |
| Sonic extension | `clients/sonic-extension/` |

For each web client:

```bash
cd clients/web-application   # or clients/token-sale
cp env.example .env          # mainnet addresses are pre-filled in env.example
npm ci
npm run build
```

**Sovereign node** — build the web application first, then:

```bash
cd clients/web-application && npm run build
cd ../sovereign-node/desktop
npm ci && npm run bundle && npm run build
```

**Sonic extension** — Chrome → Extensions → Developer mode → Load unpacked → select `clients/sonic-extension/`.

Never commit `.env` files.

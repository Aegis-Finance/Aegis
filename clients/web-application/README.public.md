# Aegis Web Application

Official static client for **Aegis** — private, verifiable finance on [Sonic](https://docs.soniclabs.com/).

React + Vite + TypeScript. Wallet flows, governance, lending, insurance, bridge, and ZK surfaces where verifiers are deployed on-chain. No backend — reads and writes go through your wallet and RPC.

| | |
|--|--|
| Protocol (contracts, circuits, tests) | [github.com/Aegis-Finance/Aegis](https://github.com/Aegis-Finance/Aegis) |
| Token sale client | [aegis-token-sale](https://github.com/Aegis-Finance/aegis-token-sale) |
| Documentation | [docs/](docs/) |
| Releases | [GitHub Releases](https://github.com/Aegis-Finance/aegis-web-application/releases) |

## Quick start

```bash
npm ci
cp ENV_EXAMPLE.txt .env
npm run dev
```

See [docs/getting-started.md](docs/getting-started.md) for full setup.

## Build

```bash
npm run build
```

Output: `dist/` (includes `manifest.hash.json` for integrity checks).

## License

MIT

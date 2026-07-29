# Aegis

**Private finance on [Sonic](https://docs.soniclabs.com/) — verifiable, open for audit, built to be used.**

Organization home: **[github.com/Aegis-Finance](https://github.com/Aegis-Finance)** · Releases: [RELEASES.md](RELEASES.md)

One repository. Everything you need to review the protocol and run the official clients.

| Component | Path |
|-----------|------|
| **Protocol** (Solidity + Circom + tests) | [`protocol/`](protocol/) |
| **Web application** | [`clients/web-application/`](clients/web-application/) |
| **Token sale** | [`clients/token-sale/`](clients/token-sale/) |
| **Landing site** | [`clients/landing/`](clients/landing/) |
| **Documentation site** | [`clients/docs/`](clients/docs/) |
| **Sovereign node** (desktop app) | [`clients/sovereign-node/`](clients/sovereign-node/) |
| **Sonic extension** (`.sonic` resolver) | [`clients/sonic-extension/`](clients/sonic-extension/) |
| **Documentation** | [`docs/`](docs/) |

---

## Sonic mainnet

| | |
|--|--|
| Chain ID | **146** |
| RPC | `https://rpc.soniclabs.com` |
| Explorer | [sonicscan.org](https://sonicscan.org) |
| **AGS** | `0x5125bF734a95F2Df0ddEf99934dc33fb1d175E3d` |

More addresses: [`docs/network.md`](docs/network.md).

---

## Quick start

**Users** — use the published web apps or install the sovereign node (URLs in [RELEASES.md](RELEASES.md)).

**Auditors & developers:**

```bash
cd protocol
npm ci
npm run compile
npm test
```

**Build a client locally** — see [`docs/guides/getting-started.md`](docs/guides/getting-started.md). Each client ships `env.example`; copy to `.env` before building.

---

## Architecture

![System overview](protocol/architecture/system_overview.png)

---

## License

[Business Source License 1.1](LICENSE) — source is public for audit and self-hosting; **commercial forks and competing branded products are not permitted** until the change date (then GPLv3+). See [SECURITY.md](SECURITY.md) for vulnerability reporting.

**Whitepaper:** [`docs/whitepaper/whitepaper.pdf`](docs/whitepaper/whitepaper.pdf) · **Roadmap:** [`docs/ROADMAP.md`](docs/ROADMAP.md)

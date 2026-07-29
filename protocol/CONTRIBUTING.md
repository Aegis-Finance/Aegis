# Contributing to Aegis contracts

This tree (`Aegis-contracts/`) is the **canonical** Solidity, Circom, and automation workspace for the monorepo. Do not duplicate “health” work under sibling placeholder trees (see root `REPO_STRUCTURE.md`).

## Before you open a PR

1. **Install & check Node** — `engines.node` in `package.json` (see `scripts/check-node-version.js`).
2. **Compile** — `npm run compile`
3. **Merged Sonic JSON** — If you changed `config/bridge-tokens.json`, `config/sonic-infrastructure.json`, or `config/uniswap-v3-sonic.json`: run `npm run sync:chain-pack` and commit `config/sonic-chain-pack.json` (or rely on CI to show the diff). See `config/README.md`.
4. **Lint** — `npm run lint` (Solhint; config in `.solhint.json`).
5. **Circuit list** — `npm run circuits:validate` (must match ceremony / deploy expectations)
6. **Tests** — `npm test` (full Hardhat suite; pre-commit may run this). For DEX + ZK sale + auction math only: `npm run test:trading`. For LM gauge + bond auction: `npm run test:incentives`.
7. **Cross-app alignment (when ZK artifacts or deployments change)** — follow **[`../docs/STACK_ALIGNMENT.md`](../docs/STACK_ALIGNMENT.md) §7**: `npm run gen:verifier-manifest`, then `NETWORK=sonic npm run gen:frontend-env` (or testnet). With **`circom`** on PATH, also `npm run circuits:zk-release-check` before release claims.

## Where to look

| Topic | Entry |
|--------|--------|
| **Documentation portal** | [`docs/README.md`](docs/README.md) |
| Scripts & npm | [`scripts/INDEX.md`](scripts/INDEX.md) |
| Layout | [`docs/ENGINEERING_OVERVIEW.md`](docs/ENGINEERING_OVERVIEW.md) |
| ZK / ceremony | [`docs/CIRCUITS_AND_CEREMONY.md`](docs/CIRCUITS_AND_CEREMONY.md) |
| Slither | [`docs/SLITHER.md`](docs/SLITHER.md), [`docs/SLITHER_TRIAGE.md`](docs/SLITHER_TRIAGE.md) |
| Sonic addresses | [`docs/SONIC_CANONICAL_DATA.md`](docs/SONIC_CANONICAL_DATA.md) |
| Monorepo stack alignment | [`../docs/STACK_ALIGNMENT.md`](../docs/STACK_ALIGNMENT.md) §7 |

## Security

- Never commit keys, `.env`, or production zkeys you treat as toxic.
- Prefer small, reviewable PRs: one concern (e.g. one module + tests + docs) when possible.

## License

Repository license applies to contributions; see `LICENSE` in this folder or parent as applicable.

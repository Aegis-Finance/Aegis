# Aegis Token Sale

> **Monorepo path:** `frontend-token-distribution/` · **Public standalone repo:** [aegis-token-sale](https://github.com/Aegis-Finance/aegis-token-sale) — publish overlay in `README.public.md`.

Small static app for the **on-chain Dutch auction** (`AutomatedDutchAuction`): **primary issuance** over the sale window — not a promo campaign, not a long-run AGS oracle after the window closes. Copy matches **`docs/DAO_TRUST_CONTRACT.md`** — no returns narrative beyond bytecode.

**Same roots as the main dApp:** Groth16 **ZK** on the private purchase path where the verifier is wired, **stealth-oriented** only in the sense the contract supports that mode, and **DAO** governance for protocol changes — **no secret admin UI** here. **Sonic** executes the sale; **Ethereum** is how users bridge value in via the official **Sonic Gateway** when they choose that route.

Header branding is **text-only** (no logo image). **No favicon** in `index.html`.

**Circuits:** `public/circuits/**/*.wasm` and `*.zkey` are Groth16 prover bundles — intentionally under `public/` for static hosting (see `public/circuits/README.md`). They are not raster images; keep them unless you move URLs to a CDN via env.

## Goals

- **Minimal surface** — narrow UI during the distribution window.
- **Deterministic integrity** — bundle hash matches the sovereign-node manifest when you wire that flow (`tests/security/scripts/verify-sovereign-node.sh`).
- **Operational clarity** — live auction metrics, allowances, public vs private (ZK) purchase paths.
- **Wallets** – [Sonic-listed](https://docs.soniclabs.com/sonic/wallets) EIP-1193 wallets via EIP-6963 when multiple extensions are installed; `wallet_addEthereumChain` includes your selected read RPC when it passes trust rules.
- **Bridge to Sonic** – a dedicated **Bridge to Sonic** tab opens the official [Sonic Gateway](https://gateway.soniclabs.com), summarizes deposit → heartbeat → claim, and lists `sonic-chain-pack` tokens on Sonic (no in-app AGS swap; the auction still clears in native **S**).
- **Privacy entry (optional)** – when `VITE_PRIVACY_ENTRY_ROUTER_ADDRESS` is set, a **Privacy entry** tab signs EIP-712 intents and submits `PrivacyEntryRouter` relay calls (proof JSON is pasted from your prover or tooling).
- **Staged capital (optional)** – **`VITE_STAGED_CAPITAL_VAULT_ADDRESS`** enables the **Staged capital** tab for `StagedCapitalVault` (milestone rounds, Merkle allowlist, EIP-712 committee flow). You can also open the microsite with **`?vault=0x…`** to target a vault without changing env. See `Aegis-contracts/docs/crowdfunding/STAGED_CAPITAL_VAULT.md`.
- **TGE Dutch display (USD pegs)** – `meta.dutchAuctionDisplay` in `public/config/sonic-chain-pack.json` (from `Aegis-contracts` after `build-sonic-chain-pack`) drives wallet balance hints. **`src/config/bridge-tokens.json`** mirrors the main app and contracts for the same rows and `dutchAuctionDisplay`; keep all three in sync when you change token addresses or TGE reference USD.

Product and DAO ethics for **all** Aegis modules (including this sale UI) follow the monorepo **[DAO trust contract](../docs/DAO_TRUST_CONTRACT.md)** — same honesty standard as the main dApp. **Client privacy defaults** (RPC banner, fingerprinting): **[PRIVACY_DEFAULTS_AND_FINGERPRINTING.md](../docs/PRIVACY_DEFAULTS_AND_FINGERPRINTING.md)**. **Phased maximum-privacy program:** **[AEGIS_HIDDEN_FORT_EXECUTION_PLAN.md](../docs/AEGIS_HIDDEN_FORT_EXECUTION_PLAN.md)**.

## Getting Started

```bash
cd frontend-token-distribution
npm install
cp env.example .env # populate addresses
npm run dev
```

### Build & Integrity Manifest

```bash
npm run build
node ../frontend/scripts/hash-dist.js # reuse existing hash generator if desired
```

> The microsite reuses the security tooling from the primary frontend (Playwright, ZAP, k6). Point the scripts at port `4175` when running scans.

## Environment Variables

| Variable | Description |
| --- | --- |
| `VITE_RPC_URL` | Sonic RPC endpoint used for read queries. |
| `VITE_CHAIN_ID` | Numeric chain id. Default `14601` (Sonic testnet). |
| `VITE_AUCTION_ADDRESS` | `AutomatedDutchAuction` contract address. |
| `VITE_EXPLORER_URL` | Optional block explorer base URL for deep links. |
| `VITE_PROVER_URL` | ZK purchase / claim prover (HTTPS). When set, the sale UI defaults to the **ZK (recommended)** tab unless `VITE_TGE_DEFAULT_PURCHASE_MODE=legacy`. |
| `VITE_SALE_DOCS_URL` | Optional HTTPS link for sale / claim / economics (hero “sale documentation”). |
| `VITE_REPO_DOCS_BASE_URL` | Optional HTTPS **base** of `Aegis-contracts/docs` (no trailing slash), e.g. `https://github.com/org/repo/blob/main/Aegis-contracts/docs` — makes the footer **Open protocol documentation** list **clickable** (economics framing, market risk note, FLOW-M5 specs). |
| `VITE_TGE_DEFAULT_PURCHASE_MODE` | Optional: `legacy` forces the transparent purchase tab even if `VITE_PROVER_URL` is set. Omit (or `zk`) when a prover exists to open on ZK. |
| `VITE_PRIVACY_ENTRY_ROUTER_ADDRESS` | Optional — when set, shows **Privacy entry** tab: EIP-712 sign + `relayShield` / `relayUnshield` (transparent exit) / `relayShieldedTransfer` on deployed `PrivacyEntryRouter` (see `Aegis-contracts/contracts/privacy/PrivacyEntryRouter.sol`). Proof JSON is not generated in-browser; paste prover output. |
| `VITE_STAGED_CAPITAL_VAULT_ADDRESS` | Optional — `StagedCapitalVault` for the **Staged capital** tab (same semantics as main app `/staged-capital`). URL `?vault=0x…` overrides the env address for a session. |
| `VITE_LIQUIDITY_MINING_GAUGE_ADDRESS` | Optional — filled by `Aegis-contracts` `gen:frontend-env` when deployed; reserved for future sale-era links to the gauge. |
| `VITE_TREASURY_BOND_AUCTION_ADDRESS` | Optional — same as above for treasury bond auction. |

## Deployment Checklist

1. Build the bundle and generate a SHA-256 manifest.
2. Pin the bundle to Arweave and record the transaction id.
3. Update `sovereign-node-app/shared/binaries.json` with the new frontend hash.
4. Run:
   - `tests/security/scripts/run-playwright.sh`
   - `tests/security/scripts/run-zap-baseline.sh http://host.docker.internal:4175`
   - `tests/security/scripts/run-k6-frontend.sh http://host.docker.internal:4175 127.0.0.1:4175`
   - `tests/security/scripts/verify-sovereign-node.sh`
5. Announce hash + integrity proof to the DAO.

## Sunset Plan

At `T+30` days (or earlier via governance), retire this microsite and redirect the Arweave pointer to the full Aegis interface. Update the sovereign-node manifest accordingly and record the transition in the decision ledger.

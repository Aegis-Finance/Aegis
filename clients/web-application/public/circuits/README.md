Circuit artifacts for in-browser Groth16 proving

### Why `.wasm` / `.zkey` stay under `public/circuits/`

They are **large prover binaries**, not images. Vite exposes `public/` at fixed URLs without packing them into the JS bundle — faster builds, browser caching, and the usual pattern for static ZK UIs (Arweave / IPFS / nginx). To host elsewhere, set the `VITE_*_WASM` / `VITE_*_ZKEY` URLs to your CDN. **No logo or diagram PNGs** live under `public/`; those were removed in favor of repo `Aegis-contracts/architecture/*.dot` sources.

### Split lending (`lending-tenor`, … `lending-liquidate`)

From repo root:

1. **Build** dev wasm + zkey in `Aegis-contracts` (needs [circom](https://docs.circom.io/getting-started/installation/) on `PATH` or `Aegis-contracts/circom.exe`):

   ```bash
   cd Aegis-contracts && npm run circuits:build-lending-split-dev
   ```

2. **Copy** into this folder (defaults expect these paths — see `src/utils/prover.ts`):

   ```bash
   cd frontend && npm run copy-circuits
   ```

   To copy **only** split lending bundles: `COPY_CIRCUITS_FILTER=lending- npm run copy-circuits`

3. Optional: set `AEGIS_CONTRACTS_ROOT` if your `Aegis-contracts` checkout is not `../Aegis-contracts` relative to `frontend/`.

---

Place WASM + final zkey under `public/circuits/<subdir>/`. Defaults match `frontend/ENV_EXAMPLE.txt` and `src/utils/prover.ts`.

**TGE Dutch auction circuits** (`auction/`, `auction-claim/`) are consumed by **`frontend-token-distribution/`**, not this bundle.

**Private AMM (also used by the Swap UI prover):** factory type `private-amm` — no separate `swap` circuit.

Env keys (examples):

- `VITE_BRIDGE_TRANSFER_WASM` / `VITE_BRIDGE_TRANSFER_ZKEY`
- `VITE_PRIVATE_AMM_WASM` / `VITE_PRIVATE_AMM_ZKEY`
- `VITE_TOKENDISTRIBUTION_WASM` / `VITE_TOKENDISTRIBUTION_ZKEY` (when you wire allowlist distribution proofs)
- `VITE_CROWD_WASM` / `VITE_CROWD_ZKEY`
- **Private lending** (`PrivateLendingContract` / `VerifierFactory`): `VITE_LENDING_TENOR_*`, `VITE_LENDING_LIQUIDITY_*`, `VITE_LENDING_REPAY_*`, `VITE_LENDING_WITHDRAW_*`, `VITE_LENDING_LIQUIDATE_*` — default paths under `lending-tenor/`, `lending-liquidity/`, etc. (see `frontend/src/utils/prover.ts`)

Folders:

- `bridge/` — `bridge_transfer.wasm`, `bridge_transfer_final.zkey` (names may match your build)
- `private-amm/` — `private-amm.wasm`, `private-amm_final.zkey`
- `tokendistribution/` — `tokendistribution.wasm`, `tokendistribution_final.zkey`
- `crowd/` — optional crowdfunding bundle
- `lending-tenor/` — `lending_tenor.wasm`, `lending_tenor_final.zkey` (borrow)
- `lending-liquidity/` — `lending_liquidity.wasm`, `lending_liquidity_final.zkey`
- `lending-repay/` — `lending_repay.wasm`, `lending_repay_final.zkey`
- `lending-withdraw/` — `lending_withdraw.wasm`, `lending_withdraw_final.zkey`
- `lending-liquidate/` — `lending_liquidate.wasm`, `lending_liquidate_final.zkey`
- `lending/` — legacy `lending.circom` build only (not wired to current lending contract)

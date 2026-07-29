# Circom circuits (Aegis)

**These `.circom` sources are meant to be public** alongside Solidity. Groth16 security depends on correct constraints **and** a defensible trusted setup — not on hiding source.

### `PrivateTokenContract` — shield-first rail (factory ↔ `circuits/`)

| Factory `circuitType` | Source | Public vector |
|----------------------|--------|-----------------|
| `mint-optimized` | `circuits/mint-optimized.circom` | 4 signals — `shield` (note `Poseidon(secret, amount, depositor)`) |
| `transfer-unshield` | `circuits/transfer-unshield.circom` | 4 signals — transparent exit / on-chain `unshield` (same 3-wire note shape; third limb = `recipient`) |
| `shielded-transfer` | `circuits/shielded-transfer.circom` | 11 signals — `shieldedTransfer` (join-split; contract overwrites balance public slots before verify; input note third limb is **private** for composability with mint / prior outputs) |
| `transfer-to-pool` | `circuits/transfer-to-pool.circom` | 4 signals — `transferToPool` (third limb = pool address) |
| `transfer-commitment-internal` | `circuits/transfer-commitment-internal.circom` | 4 signals — `transferFromCollateral`, `transferBetweenCommitments` |
| `transfer-commitment-action` | `circuits/transfer-commitment-action.circom` | 4 signals — `lockCollateral` / `unlockCollateral` (`domainTag` = small constants on-chain) |
| `transfer-optimized` | `circuits/transfer-optimized.circom` | Legacy 5-public Merkle template — **not** EOA unshield; **not** interchangeable with dedicated 4/11-public token rails (`PrivateTokenContract` reverts if those verifiers are unset, rather than substituting this slot). |

**Note:** `mint-optimized` and `transfer-unshield` share the same **Poseidon(3)** note commitment shape (`noteSecret`, `amount`, address-like third limb) so shielded notes can be spent out transparently with the matching circuit.

## Read this first

| Document | Purpose |
|----------|---------|
| [`../../docs/AGS_MAXIMUM_STEALTH_MASTER_PLAN.md`](../../docs/AGS_MAXIMUM_STEALTH_MASTER_PLAN.md) | **ZK-native charter** — stealth intent, indexing boundaries, deployment posture (monorepo root). |
| [`../../docs/STACK_ALIGNMENT.md`](../../docs/STACK_ALIGNMENT.md) | **Monorepo operator map:** `NETWORK`, `gen:frontend-env`, `VITE_*` preservation, sovereign node ↔ extension ↔ CSP. |
| [`../docs/CIRCUITS_AND_CEREMONY.md`](../docs/CIRCUITS_AND_CEREMONY.md) | **Contract ↔ circuit ↔ factory** matrix; `private-amm` only for AMM; **`tokendistribution`** allowlist circuit; **`batch`** / **`recursive`**. |
| [`../docs/CIRCUIT_TO_CONTRACT_MAP.md`](../docs/CIRCUIT_TO_CONTRACT_MAP.md) | **Per-type consumer list** — which contracts touch which `circuitType` (factory `verifyProof`, `getVerifier`, or dedicated `Groth16Verifier`). |
| [`../../docs/CIRCUITS_OPEN_SOURCE.md`](../../docs/CIRCUITS_OPEN_SOURCE.md) | What to publish vs keep secret, **audit priorities** (auction ↔ `AuctionPriceLib`, public I/O, underflows). |
| [`../../docs/ZK_AND_VERIFIER_RELEASE_CHECKLIST.md`](../../docs/ZK_AND_VERIFIER_RELEASE_CHECKLIST.md) | **Pre-release discipline:** never ship dev `build/` keys; ceremony ↔ verifier ↔ factory; on-chain smoke. |
| `contracts/tokendistribution/libs/AuctionPriceLib.sol` | Canonical on-chain Dutch schedule; any `"auction"` circuit must match it **including WAD** semantics. |
| [`../docs/DAO_TIMELOCK_ZK_RELEASE_MASTER_PLAN.md`](../docs/DAO_TIMELOCK_ZK_RELEASE_MASTER_PLAN.md) | End-to-end: deploy → `verifier-artifact-manifest.json` → frontend `.env`. |
| [`../scripts/generate-verifier-artifact-manifest.js`](../scripts/generate-verifier-artifact-manifest.js) | Emits manifest with **per-circuit** vkHash + local wasm/zkey SHA-256 (`npm run gen:verifier-manifest`). |

### Groth16 e2e smoke (requires `circom` on PATH or `./circom.exe`)

| npm script | Circuit |
|------------|---------|
| `npm run circuits:private-token-circom-compile-smoke` | **Private token rail** — compiles `mint-optimized`, `transfer-unshield`, `shielded-transfer`, `transfer-to-pool`, `transfer-commitment-internal`, `transfer-commitment-action` (R1CS+WASM only) |
| `npm run circuits:aggregator-check` | `aggregator` |
| `npm run circuits:private-amm-check` | `private-amm` |
| `npm run circuits:sybil-check` | `sybil-protection` (4 public signals ↔ `TimeLockPurchaseLimits`) |
| `npm run circuits:tokendistribution-check` | `tokendistribution` (8 public signals — allowlist + caps + `purchaseAmount`) |
| `npm run circuits:build-lending-split-dev` | **Split lending** — compiles `lending_tenor`, `lending_liquidity`, `lending_repay`, `lending_withdraw`, `lending_liquidate` + dev zkeys under `build/circuits/<dir>/` (then `npm run circuits:export-lending-vkeys` for `prePhase5Bootstrap`, `frontend/npm run copy-circuits` for UI) |

**Release bundle:** `npm run circuits:zk-release-check` runs `circuits:validate` plus all checks above (needs `circom` where applicable).

### Auction circuit ↔ `AuctionPriceLib` (requires `circom`)

From **`Aegis-contracts/`**:

```bash
npm run circuits:auction-check
```

This runs **`circuits:auction-alignment`** (math ↔ Solidity) then **`circuits:auction-snark-e2e`** (compile + `fullProve` / `verify`). Use **`circom`** on `PATH` or **`circom.exe`** at the package root.

### Other Groth16 smoke scripts

The **`auction-snark-e2e`** pattern is mirrored by **`npm run circuits:aggregator-snark-e2e`** (aggregator) and **`npm run circuits:private-amm-snark-e2e`** (`private-amm` ↔ `PrivateAMMContract`). Add similar e2e coverage when a new on-chain `verifyProof` consumer ships.

### If the terminal does not return after `OK`

Witness / wasm (`ffjavascript`) can leave handles open. The **`auction-snark-e2e`** script calls **`process.exit(0)`** on success; if the shell still hangs, check Node / `snarkjs` versions.

## Build & validate (developer)

1. **File existence / orchestrator map + Solidity alignment**

   ```bash
   npm run circuits:validate
   ```

   This checks `.circom` paths, stray top-level files, and that **`VerifierFactory.sol`** `supportedVerifierTypes` **order and strings** match `factory-circuits.js` and `resolve-groth16-artifacts.js`.

2. **Math ↔ Solidity (fast, no circom)**

   ```bash
   npm run circuits:auction-alignment
   ```

3. **Groth16 e2e (circom + snarkjs)** — compiles `auction.circom`, caches dev `ptau`/`zkey` under `build/auction-e2e/`, runs `fullProve` + `verify`:

   ```bash
   npm run circuits:auction-snark-e2e
   ```

   **`aggregator.circom`** (same pattern, separate cache under `build/aggregator-e2e/`):

   ```bash
   npm run circuits:aggregator-snark-e2e
   ```

4. **Dev keygen (other circuits)** — `auction-claim` + `sybil-protection` (see `scripts/circuits/build-keys.js`). Requires `circom` in PATH or `circom.exe` at repo root. Writes zkeys under `AEGIS_SECRETS_DIR` or `./.secrets/` (**gitignored**):

   ```bash
   npm run circuits:build-keys
   ```

5. **Analytics forwarder** (when used): compiled `analytics` artifacts + Merkle path — see historical notes below.

6. **Spartan-ECDSA staging** (if enabled in your tree):

   ```bash
   node scripts/circuits/prepare-spartan.js
   ```

## What must **not** be committed (default `.gitignore`)

- `*.zkey` (phase-2 material), toxic waste, `ceremony/` secrets  
- `*.r1cs`, `*.wasm`, `*.sym` **if** your policy treats them as build-only (this repo often ignores r1cs/zkey; wasm may ship to `public/circuits/` for apps — follow release process).

## Public review etiquette

- Open **issues** for questions; use **private disclosure** for exploitable soundness bugs (see repo root `SECURITY.md`).
- When citing a finding, reference **file + template + line** and, if possible, a **failing test** or `snarkjs` witness contradiction.

---

### Legacy: analytics forwarder (optional)

Analytics forwarder jobs expect compiled circuit assets under `build/circuits/analytics.wasm` and `build/circuits/analytics.zkey`.

```bash
node scripts/circuits/prepare-analytics.js
```

Update the Merkle path used by the forwarder (`config/analytics-merkle-path.json`). The sample file may ship with zeroes — replace with the actual witness path from production state when operating that subsystem.

Once these steps are complete, the forwarder can produce proofs using the paths configured in `.env` (`ANALYTICS_WASM_PATH`, `ANALYTICS_ZKEY_PATH`, `ANALYTICS_MERKLE_PATH_FILE`).

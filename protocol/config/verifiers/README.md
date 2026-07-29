# Groth16 verification keys (`*.verifying_key.json`)

SnarkJS-format verification keys exported from **final** phase-2 zkeys (`snarkjs zkey export verificationkey …`).

**Naming:** `<circuitType>.verifying_key.json` where `circuitType` matches `VerifierFactory` / `VERIFIER_FACTORY_CIRCUIT_BUILD_SPECS` (for example `lending-tenor.verifying_key.json`).

**Lending split stack:** from `Aegis-contracts/` after you have `build/circuits/lending-*/…_final.zkey`:

```bash
npm run circuits:export-lending-vkeys
```

Use **ceremony-backed final zkeys** for production mainnet; dev `contribute` zkeys are for CI, local, and testnet bootstrap only. See [`docs/ops/LENDING_VERIFIERS_DEPLOY_RUNBOOK.md`](../docs/ops/LENDING_VERIFIERS_DEPLOY_RUNBOOK.md).

**Git:** `*.verifying_key.json` under this directory is listed in `Aegis-contracts/.gitignore` so dev exports are not committed by mistake. To **intentionally** version a testnet VK bundle, use `git add -f config/verifiers/<name>.verifying_key.json` and document the zkey hash in release notes.

Do **not** commit toxic waste or phase-2 secrets — only the public VK JSON and (separately) published zkey/wasm artifacts belong in release bundles.

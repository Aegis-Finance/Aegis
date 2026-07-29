# Scripts

Auditor- and developer-facing tooling shipped with the protocol package. Deploy and operator runbooks are not published here.

| Area | Purpose |
|------|---------|
| `check-node-version.js` | Node engine guard (`npm ci`, `npm test`) |
| `ceremony/validate-circuits.js` | ZK factory ↔ contracts ↔ `.circom` drift gate (`npm run circuits:validate`) |
| `circuits/*` | Groth16 compile/smoke/e2e helpers for reproducing proofs locally |
| `security/slither-gate.mjs` | Slither static-analysis gate (`npm run audit:slither:gate`) |
| `fuzz/` | Optional property/fuzz test runner |

Run the test suite from `protocol/`:

```bash
npm ci
npm run compile
npm test
```

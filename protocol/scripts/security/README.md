# Static analysis (Slither)

`slither-gate.mjs` compiles the **current** `contracts/` tree via Hardhat and writes `slither-report.json`, then summarizes with `analyze_slither.py` at the protocol root.

```bash
npm run audit:slither:gate
```

`.slither.config.json` scans all production contracts; mocks under `contracts/test/` are excluded.

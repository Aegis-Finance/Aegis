# Fuzz / property tests

`run-fuzz.ts` runs the **fast-check** property suite in `test/property/` against the Solidity tree in `contracts/`.

```bash
npm run test:fuzz
# or
npx hardhat run scripts/fuzz/run-fuzz.ts
```

Coverage includes liquidity pools, treasury, governance, bridge, token allocation, **TGE Dutch pricing (`AuctionPriceLib`)**, and related modules. Set `FUZZ_RUNS` (default 60) for iteration depth.

Unit tests for `AutomatedDutchAuction` and `TimeLockPurchaseLimits` live under `test/tokendistribution/` — run via `npm test`.

Circuit artifacts location for Token Distribution app

### Why artifacts stay under `public/circuits/`

`auction.wasm` / `auction_final.zkey` (and claim bundles) are **large binaries** served as static files — same rationale as the main app (`frontend/public/circuits/README.md`). Point env vars at a CDN if you do not want them in the deploy bundle.

Place Groth16 artifacts here for in-browser proving:

- auction/
  - auction.wasm
  - auction_final.zkey
- auction-claim/
  - claim.wasm
  - claim_final.zkey

These paths match env.example defaults:
- VITE_AUCTION_CIRCUIT_WASM=/circuits/auction/auction.wasm
- VITE_AUCTION_CIRCUIT_ZKEY=/circuits/auction/auction_final.zkey
- VITE_AUCTION_CLAIM_WASM=/circuits/auction-claim/claim.wasm
- VITE_AUCTION_CLAIM_ZKEY=/circuits/auction-claim/claim_final.zkey

Private **lending** Groth16 artifacts (`lending-tenor`, `lending-liquidity`, etc.) are documented in the main app: `frontend/public/circuits/README.md` and `frontend/ENV_EXAMPLE.txt`. This app focuses on auction / distribution flows.


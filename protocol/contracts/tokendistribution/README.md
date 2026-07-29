# Token distribution (ZK + Dutch price binding)

## Contracts

| File | Role |
|------|------|
| `TokenDistributionSale.sol` | Calls `VerifierFactory.verifyProof("tokendistribution", …)`, decodes public signals via `TokenDistributionVerifierLib`, enforces nullifier replay protection, binds `merkleRoot` / caps / `supplyRemaining` / spot Dutch price, forwards ETH to `ETH_RECIPIENT`, mints sale tokens. |
| `libraries/TokenDistributionVerifierLib.sol` | **Public signal order** (must match Circom / snarkjs): `valid`, `commitment`, `nullifier`, `auctionPrice`, `maxPurchaseLimit`, `totalSupplyRemaining`, `merkleRoot`, `purchaseAmount`. |
| `libs/AuctionPriceLib.sol` | Linear Dutch schedule + `tokensForEthAtPrice`; shared with tests via `AuctionPriceLibHarness`. |
| `AutomatedLiquidityDeployer.sol` | Wraps native → **wS/WETH9**, calls canonical Uniswap v3 **NPM** `createAndInitializePoolIfNecessary` + `mint`; optional `notifyAuctionPayout` from trusted auction; `previewProportionalPairing` view for mean-price math. See `REDEPLOYMENT_PLAN.md` Step C2. |
| `AutomatedDutchAuction.sol` | ZK-bound linear Dutch sale: **`owner`** calls **`activate()`** to start the clock (no purchases before then). Constructor sets immutable **`ecosystemProceedsSink`** for unsold AGS + excess native after liquidity/vesting rules; deploy with a sink that **accepts native** (e.g. `receive`) if you use `withdrawProceeds`. |

## Ecosystem tranche (6.3M) + rewards accounting

After `TokenAllocation.allocateEcosystemTokens()` (or `allocateAllTokens`), `DecentralizedPrivacyRewards` holds the ERC20 balance but **pool counters** stay unchanged unless you either **`fundRewardPools`** (pull from caller) or **`creditRewardPoolsFromBalance`** (governance; splits existing balance into `privacyMiningPool` / `zkProofRewardPool` / `airdropPool` without `transferFrom`). For the canonical 6.3M inbound tranche, **`creditDefaultEcosystemTrancheFromBalance()`** applies the default **2.1M / 2.1M / 2.1M** split in one call; governance can use **`creditRewardPoolsFromBalance`** instead if a proposal defines another split.

**10.5M public vs Uniswap:** allocation sends **10.5M** to the auction; the auction’s **`totalTokens`** is typically **9.5M** (sellable). The other **1M** stays unsold-by-design on the auction and is routed to **`AutomatedLiquidityDeployer`** with native via **`checkAndSendLiquidityFunds`**. A full sellout of the 9.5M does **not** consume that 1M.

`circuits/tokendistribution.circom` — **declare public inputs after private inputs** so snarkjs `publicSignals` order matches the table above (Circom orders public wires by template declaration order).

Dev smoke: `npm run circuits:tokendistribution-check`.

**Operator runbook (token redeploy + optional ZK sale):** [`REDEPLOYMENT_PLAN.md`](./REDEPLOYMENT_PLAN.md).

1. Register a production Groth16 verifier for `"tokendistribution"` on `VerifierFactory` (governance).
2. Deploy `TokenDistributionSale(owner, verifierFactory, saleToken, ethRecipient)` — or use **`npm run deploy:trading-stack`** from `Aegis-contracts/` (merges into `deployments/<network>/latest.json`; see `scripts/deploy/deployTradingAndZkSale.js` for env).
3. Owner: `setSaleWindow`, `setMerkleRoot`, `setSaleParameters`.
4. Regenerate app env: `npm run gen:frontend-env`.
5. Frontend: build proofs with the **current** on-chain `supplyRemaining`, `merkleRoot`, `maxPurchaseLimitGlobal`, and `spotAuctionPrice()` (or fixed reserve if `saleCompleted`).

## Uniswap v3 vs this sale

The sale binds proofs to the **on-chain Dutch spot** (`AuctionPriceLib`), not to a Uniswap curve. For **DEX chart price** and router compatibility after listing, use the **canonical Sonic mainnet Uniswap v3** addresses in `Aegis-contracts/config/uniswap-v3-sonic.json` (merged into `sonic-chain-pack.json`). How that coexists with post-TGE v3 liquidity seeding is spelled out in **`docs/defi/UNISWAP_V3_TGE_ALIGNMENT.md`**.

## Security notes

- The circuit enforces `previousPurchases + purchaseAmount <= maxPurchaseLimit` inside the proof; `TokenDistributionSale` does **not** re-check `previousPurchases` on-chain (it is private). **Nullifier replay** is prevented (`nullifier` one-shot). For strict lifetime caps per identity without multiple allowlist leaves, extend the circuit with an on-chain–bindable tag or extra public fields and update `TokenDistributionVerifierLib`.

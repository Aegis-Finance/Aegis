# Token & distribution redeployment runbook

**Audience:** operators cutting a new **`PrivateTokenContract` + `TokenAllocation`** flow, and optionally wiring **ZK allowlist distribution** (`TokenDistributionSale` + `tokendistribution` verifier).

**Scope:** This doc is **not** tied to a single network or historical address list. Replace placeholders with values from *your* `deployments/<network>/latest.json` and SonicScan.

---

## 1. Core allocation (on-chain math)

`TokenAllocation` mints **21M** tokens (max supply) to itself and splits:

| Bucket | Share | Amount (wei scale) | Typical recipient |
|--------|-------|---------------------|-------------------|
| Public sale | 50% | **10.5M** | `AutomatedDutchAuction` (or successor sale contract) |
| Ecosystem | 30% | **6.3M** | `DecentralizedPrivacyRewards` (or successor rewards sink) |
| Treasury | 20% | **4.2M** | DAO treasury — **any address** (Safe multisig or EOA); set via `setTreasuryWallet` |

**How the 10.5M public tranche is used (important):** `TokenAllocation` sends **all 10.5M** to the auction contract. The auction is normally configured with **`totalTokens` = 9.5M** — only that amount can be **sold**. The remaining **1M** stays on the auction balance as a **liquidity reserve** (see `AutomatedDutchAuction.LIQUIDITY_TOKEN_AMOUNT`). After the sale window + delays, **`checkAndSendLiquidityFunds`** sends **1M AGS** plus **native** (paired from proceeds using the mean sale price) to **`AutomatedLiquidityDeployer`**, which wraps and mints the Uniswap v3 position. So **Uniswap seed liquidity is not extra inflation**: it is the unsellable **1M** slice of the same 10.5M public bucket, plus quote from buyers.

**If the auction “sells out”:** buyers can exhaust the full **9.5M** sale cap. The **1M** was never inside `totalTokens`, so it **remains on the auction** for the liquidity path. You still need enough **native** on the auction after sales for the mean-price pairing; if the sale is huge, proceeds should cover it — if not, `checkAndSendLiquidityFunds` returns false until balances suffice.

**Ecosystem 6.3M — balance vs claimable pools:** the rewards contract receives tokens from `allocateEcosystemTokens`, but **claims** draw from **pool counters**. After allocation, governance (or timelock executing governance) should call **`creditDefaultEcosystemTrancheFromBalance()`** (equal **2.1M / 2.1M / 2.1M** default split) or **`creditRewardPoolsFromBalance(...)`** for a custom split. Without that step, tokens sit in the contract but pools stay low. If governance later votes a different split, use `creditRewardPoolsFromBalance` with new weights (subject to solvency checks).

Canonical constants live in **`contracts/TokenAllocation.sol`** (`TOTAL_ALLOCATION`, public-sale comments).

---

## 2. Redeployment sequence (core)

### Step A — `PrivateTokenContract`

Constructor pattern (parameter names from Solidity):

- `_verifierFactory` — from `latest.json` → `VerifierFactory`
- `_tokenAllocation` — `TokenAllocation` address (prefer **existing** deployment unless you intentionally rotate allocation logic)

After deploy: confirm **21M** minted to `TokenAllocation` (per contract rules).

### Step B — `TokenAllocation` wiring

- `setPublicSaleContract(auctionAddress)`
- `setEcosystemRewardsContract(rewardsAddress)`
- `setTreasuryWallet(safeAddress)`

Use **governance / timelock** paths if ownership has already been transferred.

### Step C — Allocate

- `allocatePublicTokens()` then ecosystem/treasury **or** `allocateAllTokens()` if your build exposes it and permissions match.
- After **`allocateEcosystemTokens`** (or the ecosystem leg of `allocateAllTokens`): from governance/timelock, call **`DecentralizedPrivacyRewards.creditDefaultEcosystemTrancheFromBalance()`** (default equal thirds of 6.3M) or **`creditRewardPoolsFromBalance`** with your voted split.

### Step C2 — `AutomatedLiquidityDeployer` (Uniswap v3 seed)

After the primary sale / auction has delivered the **liquidity tranche** (AGS + native quote) to the deployer contract (see product flow in `Aegiscoin/contracts/tokendistribution/plan.md`):

1. Deploy with canonical Sonic **NonfungiblePositionManager** + **wS/WETH9** + **AGS** addresses (`npm run deploy:liquidity-deployer -- --network <net>` — see `scripts/deploy/deployAutomatedLiquidityDeployer.js` for `AGS_TOKEN`, `WETH9`, `UNISWAP_V3_NPM`, optional `UNISWAP_POOL_FEE`, `LIQUIDITY_EXCESS_SINK`, `LIQUIDITY_POSITION_RECIPIENT`).
2. Owner: `setTrustedAuction(auction)` if using `notifyAuctionPayout` pull-from-auction.
3. When balances are ready: `mintInitialLiquidity(sqrtPriceX96, tickLower, tickUpper, amount0Min, amount1Min, deadline)` — `sqrtPriceX96` must match Uniswap **token1/token0** ordering for the pool (sorted addresses). Use full-range ticks aligned to the pool’s `tickSpacing` for your fee tier (e.g. `-887220` / `887220` for fee `3000`).
4. Sweep leftovers: `rescueDustToSink()` or `sweepToken` / `unwrapAndSweepNative` as needed.

`previewProportionalPairing(meanPriceWad, maxAgs, nativeAvailable)` is a **view** helper for the mean-price scaling story; it does not move funds.

### Step D — Verification checklist

- [ ] `PrivateTokenContract.totalSupply()` matches expected max (21M × decimals).
- [ ] `TokenAllocation` balance of AGS → **0** after all allocations.
- [ ] Public sale recipient balance = **10.5M** (or your configured public tranche).
- [ ] Ecosystem + treasury balances match configured recipients.
- [ ] Auction / liquidity wiring matches **your** `totalTokens` vs liquidity reserve (no drift vs `TokenAllocation`).

---

## 3. Optional: ZK allowlist sale (`TokenDistributionSale`)

This path is **orthogonal** to the Dutch auction + `TokenAllocation` flow unless you explicitly design it to be the same asset.

| Component | Role |
|-----------|------|
| `VerifierFactory` + `"tokendistribution"` verifier | Groth16 verify for purchases |
| **`TokenDistributionSale`** | Binds public signals, nullifiers, Dutch **spot** price (`AuctionPriceLib`), forwards ETH to `ETH_RECIPIENT`, **mints the configured sale token** |
| `circuits/tokendistribution.circom` | 8 public signals — see `TokenDistributionVerifierLib` |

**Important:** `TokenDistributionSale` requires a **mintable** ERC20 as `saleToken` (interface `mint(address,uint256)`). That is often a **dedicated sale / receipt token**, not `PrivateTokenContract` unless your token contract intentionally exposes unrestricted mint to this sale contract.

**Deploy helper:** from `Aegis-contracts/`, `npm run deploy:trading-stack -- --network <net>` merges `SignedLimitOrderRegistry`, `RFQIntentSettlement`, and **optionally** `TokenDistributionSale` into `deployments/<net>/latest.json`. See `scripts/deploy/deployTradingAndZkSale.js` for:

- `TOKEN_DISTRIBUTION_SALE_TOKEN`
- `TOKEN_DISTRIBUTION_DEPLOY_MINTABLE_SALE=1` (testnet convenience)
- `TOKEN_DISTRIBUTION_ETH_RECIPIENT`

**After keys exist:** register production verifier for `"tokendistribution"` (governance), run `npm run circuits:tokendistribution-check` on the **same** Circom commit, then `npm run gen:frontend-env` and refresh distribution app env + wasm/zkey paths.

---

## 4. Post-deploy hygiene (all paths)

1. Update / commit `deployments/<network>/latest.json` per org policy.
2. `npm run gen:frontend-env` from `Aegis-contracts/` (syncs `frontend/` + `frontend-token-distribution/` env contract keys).
3. `cd ../frontend && npm run copy-abis` after any `hardhat compile` that changes ABIs.
4. Pin verifier artifact hashes in release notes (`docs/ZK_AND_VERIFIER_RELEASE_CHECKLIST.md`).

---

## 5. What not to do

- Do **not** redeploy `TokenAllocation` unless you accept re-wiring all recipients and migration risk.
- Do **not** change auction `totalTokens` / liquidity constants without reconciling against `TokenAllocation`’s **10.5M** public tranche and product spec.
- Do **not** point production UI at new addresses until SonicScan + manifest + env all agree.

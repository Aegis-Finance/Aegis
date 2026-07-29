# Modern sale mechanics vs this repo’s Dutch auction

## What traders expect in 2024–2026

Several designs improve on a **naive** fixed-schedule Dutch auction:

| Mechanism | Idea | Strengths | Typical friction |
|-----------|------|-----------|-------------------|
| **LBP (Balancer-style)** | Weights shift over time; early price high, later stabilizes | Familiar for DeFi launches; flexible path | Oracle / pool manipulation surface; more moving parts |
| **GDA / VRGDA (Paradigm-style)** | Price is a function of **time** and/or **cumulative sales** | Smooth supply–time coordination; good for NFTs / staged releases | Needs a **new on-chain law** and usually new off-chain UX |
| **Uniform / batch clearing** | Bidders commit; everyone clears at one **clearing price** | Perceived fairness (“same price”) | Requires batching, privacy, or a second phase; heavier UX |
| **Bonding curve tail** | Continuous `f(supply)` after initial sale | Ongoing discovery without a hard window | Slippage, MEV, curve parameter risk |

## What Aegis implements today

1. **Primary sale — `AutomatedDutchAuction`**  
   - **Time-linear** price from `startPrice` → `reservePrice` over `[startTime, endTime]`.  
   - Buyers pay the **marginal spot price at transaction time** (standard Dutch).  
   - **Optional `deferredSettlement`**: balances are recorded on purchase; **AGS is transferred after** finalization + delay — this is **not** a uniform clearing price, but it **separates payment from delivery** (better operational security, clearer “claim” UX, closer to how some regulated sales batch settlement).

2. **Post-sale — `AutomatedBondingCurve`**  
   - Supply-based curve **after** the auction window, with optional **oracle band** validation — this is where “continuous” modern discovery lives in this stack.

3. **Liquidity — `AutomatedLiquidityDeployer` + mean price**  
   - A slice of supply and raised native asset is routed using **VWAP-style mean** from the auction — useful for **DEX listing** without trusting a single last-tick price.

## Why we did not silently switch to VRGDA / GDA on-chain

The ZK path `purchaseTokens` verifies a Groth16 proof against **six public inputs** that encode this **exact** linear schedule (including a **constant per-second decay rate in WAD**). Changing the price law (e.g. exponential time decay, sales-dependent VRGDA) **breaks proof verification** unless you:

- redesign the Circom circuit,
- regenerate trusted setup artifacts,
- deploy/register a new verifier,
- update prover services and both frontends.

`AUCTION_PRICE_CURVE_ID == 1` labels this binding for integrators. `getAuctionVerifierPublicInputs(uint256)` exposes the template so provers and auditors stay aligned with Solidity.

## Practical “upgrade” path for the product

- **Short term (no verifier fork):** marketing + UX around **deferred claims**, transparent **mean price** for liquidity, and **bonding curve + oracle** for the tail — already in-repo.  
- **Medium term (v2 sale):** deploy a **new** auction contract + new circuit if you want VRGDA/GDA or piecewise schedules; keep v1 for historical compatibility.

## References (external)

- Paradigm — Gradual Dutch Auctions / VRGDA (conceptual).  
- Balancer — Liquidity Bootstrapping Pools (LBP).  
- Classic Dutch vs uniform price auctions — any microeconomics text on multi-unit auctions.

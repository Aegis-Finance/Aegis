# DEX / trading stack (Solidity)

This folder is the **on-chain home** for milestones **M2+** in [`docs/DEX_AND_PRIVATE_TRADING_ROADMAP.md`](../../../docs/DEX_AND_PRIVATE_TRADING_ROADMAP.md).

## Current state

- **AMM (public + private)** lives alongside other DeFi modules (e.g. `PrivateAMMContract.sol` at repo root under `contracts/`), not necessarily under `contracts/dex/`.
- **M0–M1** are primarily **deployment + ceremony + frontend** work.
- **M2 (starter):** `AegisPublicPoolRouter.sol` — governance-owned allowlist of pools sharing one `(AGS, quote)` shape; `bestQuote` and `swapExactInputOnBest`. Optional TWAP/oracle guardrails are backlog.
- **M3 (starter):** `TransparentEscrowOrders.sol` — fixed-price transparent P2P sells of AGS for ERC20 or native quote; not a full limit book.

## Shipped artifacts (this folder)

| File | Role |
|------|------|
| `interfaces/IPublicLiquidityPoolMinimal.sol` | Minimal pool surface for routing |
| `AegisPublicPoolRouter.sol` | M2 router |
| `AegisCanonicalSwapRouter.sol` | **Canonical AGS/S policy** — v3 after TGE; ERC20 pools otherwise |
| `TransparentEscrowOrders.sol` | M3 escrow starter (fixed-price AGS sells) |
| `SignedLimitOrderRegistry.sol` | **M3+** — EIP-712 resting ERC20↔ERC20 limits (escrow + cancel + reclaim expired + fill). After `expiry`, `cancel` / `fill` revert with `OrderExpired()`; maker uses `reclaimExpired`. |
| `RFQIntentSettlement.sol` | **M4 v1** — EIP-712 one-shot RFQ (allowance-based atomic fill) |

**AMM honesty (public vs proof-backed PrivateAMM):** [`../docs/liquidity/PUBLIC_VS_PRIVATE_AMM.md`](../docs/liquidity/PUBLIC_VS_PRIVATE_AMM.md) — Phase C messaging + roadmap fork.

**Deploy:** from `Aegis-contracts/`, `npm run deploy:trading-stack -- --network <net>` (merges into `deployments/<net>/latest.json`; optional `TokenDistributionSale` — see script header).

## Planned modules (extend here)

| Milestone | Suggested artifact | Notes |
|-----------|-------------------|--------|
| **M2+** | Oracle / TWAP guards, split routes | Parameterize under governance + timelock |
| **M3+** | ~~`LimitOrderRegistry.sol`~~ → use `SignedLimitOrderRegistry.sol` | Partial fills, hybrid relayer book, gasless batch still backlog |
| **M4** | `SolverRegistry.sol` + monitoring | RFQ v1 shipped without solver competition |
| **M5** | Per-feature verifier + wrapper | Same release discipline as token circuits |

## Rules

- **Governance + timelock** for fee switches, allowlists, and upgrades — see `GovernanceAccessLib` patterns elsewhere.
- **Never** label a contract “private CLOB” until the threat model and circuits are published and deployed.
- Update **`docs/DEX_AND_PRIVATE_TRADING_ROADMAP.md`** and **`frontend/src/config/dexRoadmap.ts`** when a milestone moves from planned → in progress → shipped.

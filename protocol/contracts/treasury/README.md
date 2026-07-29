# Treasury utilities

## `TreasuryBondAuction`

Dutch-style **primary** of fixed-term **AGS notes** paid for in a **quote token** (e.g. wrapped native / stable).

- **No mint**: DAO **pre-deposits AGS** on the contract, then `openAuction` with capacity and `AuctionPriceLib` Dutch schedule (`startPriceQuotePerAgsWad` → `reservePriceQuotePerAgsWad` over `[auctionStart, auctionEnd]`).
- **Liability accounting**: `agsLiability` tracks unredeemed note principal so a new `openAuction` cannot over-allocate AGS already promised on outstanding notes.
- **Notes**: each purchase mints an internal `noteId` (see `notes`, `noteOwner`); `redeem` after `maturity` pays `agsFace` to the **note holder** (the address recorded at purchase).
- **Phase-B routing**: `purchaseTo(noteHolder, quoteMax, minAgsFace)` — `msg.sender` pays `QUOTE_TOKEN` while the redeemable note is owned by `noteHolder` (hot payer / cold holder split). Emits `BondPurchaseRouted` when payer ≠ holder. **Quote amounts and Dutch timing stay public**; true bid privacy still needs a later ZK/commit layer (see repo `docs/AGS_MAXIMUM_STEALTH_MASTER_PLAN.md`).
- **Proceeds**: `QUOTE_TOKEN` accumulates here; governance `sweepQuote` to treasury / sinks.
- **Governance-only**: `openAuction`, `sweepQuote`, `setTimelockController`.

### Relationship to liquidity mining

Use **`LiquidityMiningGauge`** ([`../incentives/README.md`](../incentives/README.md)) for recurring LP competitions; use **`TreasuryBondAuction`** for discrete **bond-like** funding windows. Both consume **existing AGS** from the DAO budget — they do not increase `MAX_SUPPLY`.

## Deploy

```bash
# From Aegis-contracts/ — see script header for env
LIQUIDITY_MINING_LP_TOKEN=0x... TREASURY_BOND_QUOTE_TOKEN=0x... npm run deploy:incentives-bonds -- --network sonic
```

Pre-fund **AGS** on the auction contract before `openAuction`. Use `npm run gen:frontend-env` after updating `latest.json`.

## `DaoDynamicRevenueRouter`

Pulls a configured **payment token** (typically AGS) from a user and forwards it to three sinks:

1. **Governance treasury** — protocol runway, governance flywheel, or timelock-controlled budgets  
2. **Insurance sink** — vault / pool backing parametric coverage  
3. **Ecosystem flywheel** — rewards, grants, liquidity programs, or `PraxeologicalRewards`-style sinks  

### Live split (no external oracle)

The router starts from a **base BPS split** (must sum to `10_000`). Before each payment it calls `effectiveSplitBps()`, which may **tilt** the split using only:

- `IERC20(paymentToken).balanceOf(insuranceSink)`  
- Governance-set **low / high watermarks** and **`maxTiltBps`**

- If the insurance sink balance is **below** the low watermark, up to `maxTiltBps` is moved from the **governance** slice into **insurance** (capped by available governance BPS).  
- If the balance is **above** the high watermark, up to `maxTiltBps` moves from **insurance** into the **ecosystem** slice.

Governance (facade, core, or timelock per `GovernanceAccessLib`) can update sinks, base split, watermarks, tilt cap, and governance pointer.

### On-chain analytics subscription (future gated backends)

Governance sets:

- `analyticsMinPriceWei` — `payAndRoute` must receive **≥ this amount** (in `paymentToken` wei) to extend access.
- `analyticsSubscriptionDurationSeconds` — seconds added to `analyticsAccessUntil[payer]` (stacked from `max(now, currentUntil)`).

Views:

- `hasAnalyticsSubscription(address)` — `true` iff `analyticsAccessUntil[address] > block.timestamp`.
- `analyticsAccessUntil(address)` — unix seconds.

A **future** indexer or partner API can use `hasAnalyticsSubscription` to gate **signed** requests with higher daily limits. The repo no longer ships a first-party Etherscan proxy in `services/`.

### Frontend

The main app’s **Analytics** module calls `payAndRoute` after `approve`. Configure `VITE_DAO_REVENUE_ROUTER_ADDRESS` and `VITE_ANALYTICS_SUB_PRICE_WEI` (must be **≥** on-chain `analyticsMinPriceWei` when the latter is non-zero). See `docs/ONCHAIN_ANALYTICS.md`.

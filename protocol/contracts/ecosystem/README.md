# Shielded ecosystem extensions

Local-only modules that complete the **selective-privacy financial ecosystem** spec (see repo root [`log.md`](../../../log.md)).

All modules:

- Consume **`PrivateTokenContract`** commitments as the unified shielded state
- Verify proofs via **`VerifierFactory`** (new circuit types `stealth-address` … `treasury-shield`)
- Must be **`authorizeContract`** on the token before mainnet stealth tightening

| Contract | Circuit | Purpose |
|----------|---------|---------|
| `StealthAddressHub` | `stealth-address` | Unique payment tags → shielded claim |
| `RelayerMarketplace` | — | AGS stake, slash, gas relayer registry; optional **DAO allowlist** |
| `SelectiveDisclosureHub` | `selective-disclosure` | Prove net worth / age / ownership / repayment |
| `PrivacySavingsVault` | `savings` | Term deposits in commitments |
| `ShieldedYieldVault` | `savings` + `farming` | Unified term lock + farm stake record rail |
| `ShieldedIncentiveClaims` | `farming` + `private-bond` | Gauge rewards / bond redemptions → shielded state |
| `AnonymousPayroll` | `payroll` | Private employer → employee payouts |
| `ShieldedTreasuryManager` | `treasury-shield` | Delayed aggregate treasury moves |
| `PrivateBondMarket` | `private-bond` | ZK bond notes |
| `PrivatePredictionMarket` | `prediction-market` | Shielded outcome shares |
| `PrivateStableVault` | `private-stable` | Collateral-backed stable commitments |
| `PrivateCreditProfile` | `credit-profile` | Anonymous credit scores; optional **`CreatorReputationTracker`** sync |
| `ShieldedGovernanceTally` | `governance` | Hidden votes until finalization |
| `ShieldedEcosystemRouter` | — | DAO-governed module address registry |

## `ShieldedEcosystemRouter` module IDs

Register via `registerModule(bytes32 moduleId, address)` (governance only):

| `moduleId` | `keccak256` input |
|------------|-------------------|
| Stealth | `STEALTH_ADDRESS_HUB` |
| Relayer market | `RELAYER_MARKETPLACE` |
| Disclosure | `SELECTIVE_DISCLOSURE_HUB` |
| Savings | `PRIVACY_SAVINGS_VAULT` |
| Payroll | `ANONYMOUS_PAYROLL` |
| Treasury shield | `SHIELDED_TREASURY_MANAGER` |
| Private bonds | `PRIVATE_BOND_MARKET` |
| Prediction | `PRIVATE_PREDICTION_MARKET` |
| Stable vault | `PRIVATE_STABLE_VAULT` |
| Credit profile | `PRIVATE_CREDIT_PROFILE` |
| Governance tally | `SHIELDED_GOVERNANCE_TALLY` |
| Yield vault | `SHIELDED_YIELD_VAULT` |
| Incentive claims | `SHIELDED_INCENTIVE_CLAIMS` |

Frontend resolves optional addresses via `VITE_*` env keys (see `frontend/src/config/contracts.ts`).

## Shielded-path event audit (§2.1)

Ecosystem modules intentionally emit **hashes and aggregates only** on ZK paths — no plaintext amounts, addresses, or balance graphs:

| Module | Safe events | Avoid on shielded paths |
|--------|-------------|-------------------------|
| All `EcosystemZkBase` | `GovernanceUpdated`, pause/unpause | — |
| `StealthAddressHub` | `StealthMetaRegistered(paymentTag, viewTag)` | Plain recipient address |
| `PrivacySavingsVault` / `ShieldedYieldVault` | `LockedYieldOpened(depositId, commitment)` | Token amounts in events |
| `PrivateCreditProfile` | `CreditScoreUpdated(profileCommitment, score)` | Wallet ↔ commitment link in same tx batch |
| `ShieldedGovernanceTally` | `ProposalRegistered`, `VoteRecorded(nullifier)` | Vote choice before finalization |
| `ShieldedTreasuryManager` | `MoveScheduled`, aggregate counters | Per-recipient disbursement amounts |
| `RelayerMarketplace` | `RelayerRegistered`, `RelayRecorded` | User calldata payloads |

Core token shield/unshield events remain minimal by design (`ProofVerified`, nullifier spent).

## Economic flywheel — `DaoDynamicRevenueRouter` defaults

Local tests (`test/treasury/DaoDynamicRevenueRouter.spec.js`) document bootstrap params:

| Param | Default | Notes |
|-------|---------|-------|
| Base split (gov / insurance / ecosystem) | 5000 / 3000 / 2000 bps | Tilts when sinks cross watermarks |
| Insurance low watermark | 100 AGS | Shifts +1000 bps from gov → insurance |
| Insurance high watermark | 1_000_000 AGS | Shifts +1000 bps from insurance → ecosystem |
| Min payment | 1000 wei | Dust guard |

Treasury **shielded disbursement**: governance schedules moves on `ShieldedTreasuryManager` (`scheduleMove` → delayed `executeMove` with `treasury-shield` proof). Aggregate `aggregateScheduled` is public; recipient graph stays in commitments.

## Credit ↔ crowdfunding bridge

`PrivateCreditProfile.syncCreditFromCreatorReputation(profileCommitment, creator)` copies a **public** `CreatorReputationTracker` score into an anonymous commitment when the user opts in. `PrivateLendingContract.borrowWithCollateralAndCreditProfile` gates borrows via `verifyCreditForLending`.

## Governance tally wiring

1. Deploy `ShieldedGovernanceTally`, `setGovernance(PrivateGovernance)`.
2. `PrivateGovernance.setShieldedGovernanceTally(tally)`.
3. Owner calls `registerShieldedTallyProposal(proposalId, votingEnds)` per proposal.

## Relayer operator (local)

- HTTP daemon: `scripts/ops/privacy-entry-relayer-http.mjs` — optional `RELAYER_API_KEY`, rate limit, `RELAYER_MARKETPLACE_ADDRESS` for `recordRelay`
- Frontend gasless default: `VITE_PRIVACY_RELAY_HTTP_URL` + `VITE_PRIVACY_ENTRY_ROUTER_ADDRESS` (disable with `VITE_DEFAULT_GASLESS_RELAY=0`)

## Local deploy

```bash
cd Aegis-contracts
npm run deploy:ecosystem:local
npm run gen:frontend-env
cd ../frontend && npm run copy-abis && npm run dev
```

**Local verify:** `npm run compile && npm run circuits:validate && npm test`

Browser witness field names: `frontend/src/config/circuitWitnessSchemas.ts`.

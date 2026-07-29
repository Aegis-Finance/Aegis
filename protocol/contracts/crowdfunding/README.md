# Crowdfunding (`AegisCrowdShield`)

## What this layer is for

`AegisCrowdShield` is the **canonical on-chain settlement** for voluntary campaigns: contributions, success/failure, contributor refunds, optional market disputes, and creator withdrawal. DAO governance (and optional timelock) can **pause** the contract and update governance references; day-to-day campaign rules are chosen **per campaign** via `IndividualSovereigntyConfig`.

## Trust model (what users should expect)

### Backers — failed or under-funded campaigns

If the goal is not met by the deadline, contributors can **`requestRefund`** and recover their principal from the contract balance (subject to correct accounting in the app layer).

### Backers — successful campaigns

When `totalRaised >= targetAmount`, the campaign becomes **`Successful`**. Funds stay in the contract until the creator withdraws. To reduce “goal met → instant rug” dynamics:

1. **Withdrawal lock** — On first success the contract sets  
   `withdrawUnlocksAt = max(block.timestamp, deadline) + DISPUTE_RESOLUTION_PERIOD`  
   (same length as the dispute voting window: **14 days**). The creator **cannot** call `withdrawFunds` before that time. UIs should read **`getCreatorWithdrawUnlock(campaignId)`** and show a clear countdown.

2. **Disputes while funds are in the contract** — If `enableMarketDrivenDisputes` is on, a contributor may **`initiateDispute`** only once the campaign is **economically successful** (successful, or past deadline with goal met). While status is **`Disputed`**, **creator withdrawal is blocked** even after the unlock timestamp, until **`resolveDispute`** runs.

3. **No duplicate disputes** — A second `initiateDispute` for the same campaign reverts while a dispute is already open.

### Creators

Creators receive the full raised balance **after** the unlock time and **only if** the campaign is not `Disputed` / `Refunding`, and the contract is **not paused**.

### Optional modules

`SoundMoneyEscrow`, `RefundVerifier`, `MilestoneVerifier`, and reputation/analytics contracts can add **milestone-based release**, **ZK refund flows**, and **reputation** on top of this core. Product positioning should say explicitly which path a campaign uses (plain CrowdShield vs escrow/milestones).

`StagedCapitalVault` adds a **VC / syndicate-style** path: ERC20 commits, optional **Merkle allowlisted** investors, **min raise / hard cap**, **sequential milestone payouts** to a founder multisig, and **M-of-N committee attestations** (EIP-712), with optional `stealthCommitment` labels for off-chain cap-table privacy. See `docs/crowdfunding/STAGED_CAPITAL_VAULT.md`. **Reference UIs:** main dApp **`/staged-capital`** and TGE **`frontend-token-distribution`** **Staged capital** tab — both use **`VITE_STAGED_CAPITAL_VAULT_ADDRESS`** (or **`?vault=0x…`** override on the URL).

## Operational notes for a DAO

- **Parameter changes** that affect everyone belong in governance + timelock (e.g. future changes to `DISPUTE_RESOLUTION_PERIOD` would require a contract upgrade or new deployment — the constant is fixed today).
- **Per-campaign** toggles (`enableMarketDrivenDisputes`, private contributions, etc.) are set by the **creator at creation**; communicate risks in the frontend when disputes are off.
- **ZK private contributions** — `contribute` accepts an optional Groth16 proof and **10** public signals aligned with `circuits/crowdfunding.circom` / snarkjs (see `docs/CIRCUITS_AND_CEREMONY.md`). `IndividualSovereigntyConfig` includes **`minimumContribution`** and **`maximumContribution`** (must satisfy `0 < min ≤ max ≤ targetAmount`) so public inputs bind to on-chain limits. Private campaigns need **`setCampaignContributorMerkleRoot`** so proofs can bind `merkleRoot`.
- **Emergency pause** stops **new disputes / votes / resolution / creator withdraw** on gated functions; design whether refunds should remain available (today `requestRefund` is not wrapped in `whenNotPaused` so contributors are not blocked from exiting failed states by pause alone — verify this matches operational policy).

## Campaign IDs

`createCampaign` assigns `campaignId = ++nextCampaignId` while `nextCampaignId` starts at `1`, so the **first** campaign id is **`2`**. Integrations should use the **return value** of `createCampaign` (or the `CampaignCreated` event / `nextCampaignId` after the tx) instead of assuming id `1`.
- `DisputeInitiated`, `DisputeResolved` — dispute lifecycle
- `FundsWithdrawn`, `RefundIssued` — final money movement

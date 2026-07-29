# Timelock (`AegisTimelockController`)

OpenZeppelin **`TimelockController`** (v5) wrapped as **`AegisTimelockController`** for a stable artifact name and clear deployment records.

## Why it exists

- **Delay sensitive admin actions** (`schedule` → wait `minDelay` → `execute`).
- **Reduce EOA panic control**: optional `Ownable.transferOwnership(timelock)` on contracts that use OpenZeppelin `Ownable` (see deploy script).

## Deploy + role bootstrap

From `Aegis-contracts/` (with `deployments/<network>/latest.json` containing `PrivateGovernance`):

```bash
npx hardhat run scripts/deploy/phaseTimelockDeployAndWire.js --network sonic
```

Environment:

| Variable | Default | Meaning |
|----------|---------|---------|
| `TIMELOCK_MIN_DELAY_SECONDS` | `172800` (48h) | Initial minimum delay for queued operations. |
| `SKIP_TIMELOCK_REVOKE_DEPLOYER_PROPOSER` | unset | Set to `1` to keep deployer as proposer/canceller (not recommended). |
| `EXECUTE_OWNERSHIP_TRANSFERS` | unset / `false` | Set to `true` to `transferOwnership(timelock)` on **AutomatedDutchAuction**, **AutomatedBondingCurve**, and **AutomatedLiquidityDeployer** when current `owner()` is the deployer. **Danger:** governance execution paths that call `onlyOwner` targets with `msg.sender` equal to the governance contract will **fail** after transfer unless calls are routed through the timelock. |

After deploy: `npm run gen:frontend-env` and `npm run report:deployed-admins`.

## Governance integration note

`GovernanceCore` uses a **custom** `owner` field (not OZ `Ownable`) and has **no** `transferOwnership` — changing that owner requires a **contract upgrade**, not this timelock alone.

### Protocol contracts: `timelockController`

After deploying `AegisTimelockController`, register its address on each module that enforces **`onlyGovernance`** (or equivalent) so **`TimelockController.execute`** is recognized as `msg.sender`:

- **`VerifierFactory`** / **`CeremonyVerifier`**: `setTimelockController(timelock)` — callable by existing governance auth (facade, `GovernanceCore`, or timelock once bootstrapped).
- **`PrivateTokenContract`**, **`TokenAllocation`**, **`CrossChainPrivacyBridge`**, DeFi modules (**`PrivateStakingContract`**, **`PrivateLendingContract`**, **`PrivateYieldFarming`**, **`PrivateAMMContract`**, **`RecursiveProofAggregator`**, **`PrivateDerivatives`**, **`HyperOptimizedAggregator`**, **`DecentralizedPrivacyRewards`**), crowdfunding (**`AegisCrowdShield`**, **`RefundVerifier`**, **`MilestoneVerifier`**, **`AustrianAnalytics`**, **`PraxeologicalRewards`**, **`CreatorReputationTracker`**), **`SonicGatewayWrapper`**: each exposes **`setTimelockController`** with the same auth model as that contract’s governance wiring (typically owner for one-time bootstrap contracts, or governance-only).

Shared helper: **`GovernanceAccessLib.isGovernanceTimelockOrCore`** (`contracts/libraries/GovernanceAccessLib.sol`) treats callers as authorized when they are the **`PrivateGovernance`** facade, **`GovernanceCore`** (via `GOVERNANCE_CORE()`), or the configured **timelock** address.

End-to-end checklist: [`../docs/DAO_TIMELOCK_ZK_RELEASE_MASTER_PLAN.md`](../docs/DAO_TIMELOCK_ZK_RELEASE_MASTER_PLAN.md).

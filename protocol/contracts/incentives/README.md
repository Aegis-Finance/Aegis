# DAO incentives (liquidity mining)

## `LiquidityMiningGauge`

Single-pool **gauge** over an LP (`STAKE_TOKEN`) paying **pre-funded** `REWARD_TOKEN` (typically **AGS**).

- **No minting**: rewards are whatever the DAO / `DaoDynamicRevenueRouter` **ecosystem flywheel** transfers in — consistent with the **21M fixed supply** policy on `PrivateTokenContract`.
- **“Competition” framing**: each governance call to `notifyRewardAmount(reward, duration)` bumps `competitionId` and sets a new emission window (e.g. **7 days** or **30 days**). LPs earn **proportionally to stake × time** inside the window (standard `rewardPerToken` math).
- **Governance** (`PrivateGovernance` facade / core / timelock via `GovernanceAccessLib`): `notifyRewardAmount`, `setPaused`, `setTimelockController`, `recoverERC20` (cannot withdraw the stake token).
- **Bootstrap**: deployer `Ownable` sets `governanceContract` once; wire `timelockController` after timelock deploy (same pattern as other modules).

### Phase-B stealth routing (wallet separation)

LP amounts and emissions remain **on-chain visible**; these entrypoints only reduce **EOA linkage** when users choose separate hot/cold or deposit addresses:

- `withdrawTo(recipient, amount)` — return LP to `recipient`.
- `getRewardTo(recipient)` — pay accrued `REWARD_TOKEN` to `recipient` (e.g. cold wallet or a deposit helper toward shielded AGS).
- `exitTo(stakeRecipient, rewardRecipient)` — combined exit with split destinations.

Default `withdraw` / `getReward` / `exit` unchanged (everything returns to `msg.sender`).

### Deploy (merge `latest.json`)

From `Aegis-contracts/` (requires **`PrivateTokenContract`** in `deployments/<net>/latest.json`):

```bash
LIQUIDITY_MINING_LP_TOKEN=0x... TREASURY_BOND_QUOTE_TOKEN=0x... npx hardhat run scripts/deploy/deployIncentivesAndBonds.js --network sonic
```

Optional: `INCENTIVES_WIRE_GOVERNANCE=1` to call `setGovernance(PrivateGovernance)` on both contracts. Then `npm run gen:frontend-env`.

See also: [`../../scripts/deploy/deployIncentivesAndBonds.js`](../../scripts/deploy/deployIncentivesAndBonds.js).

### Operational flow

1. Run [`deployIncentivesAndBonds.js`](../../scripts/deploy/deployIncentivesAndBonds.js) once: it deploys **this gauge** and **`TreasuryBondAuction`** (same `latest.json` merge). Use the canonical LP token address and quote token for bonds.
2. DAO approves and `transfer`s reward budget to the gauge (or uses `recoverERC20` only for stray tokens).
3. `notifyRewardAmount(reward, duration)` — weekly/monthly cadence is off-chain policy; on-chain only `duration` seconds.
4. LPs `stake` / `withdraw` / `getReward` / `exit`, or the **routing** variants above for stronger wallet hygiene.

### Future extensions

- Off-chain **leaderboard** (top APY contributors) from events + indexer; optional **Merkle bonus** tier on top of this gauge.
- **Private** claims: wrap payouts in ZK-shield flow (treasury sends to shield pipeline).

See also: [`../treasury/README.md`](../treasury/README.md) for bond auctions.

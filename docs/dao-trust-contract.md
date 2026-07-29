# DAO trust contract — how Aegis is shaped for real users

This document is the **product and ethics spine** for the whole protocol: every module (lending, insurance, liquidity, swap, bridge, staking, yield, crowdfunding, token distribution, governance) should read compatible with it. It extends [FOUNDING_PRINCIPLES.md](./FOUNDING_PRINCIPLES.md) with **DAO-specific** commitments and **plain-language boundaries** so marketing, UI copy, and bytecode do not diverge.

**Aegis is a DAO.** Authority for parameter changes and protocol evolution is meant to flow through **on-chain governance** (with the rules actually enforced by `PrivateGovernance` / `GovernanceCore` and related contracts), not through a hidden back channel. **Anyone who holds voting power under those rules—including early allocation recipients at launch—has the same governance mechanics as everyone else:** one user, one set of contract rules. Narrative must not imply “insiders vote, public decorates.”

---

## 1. One psychological contract (all modules)

We optimize for **calm money**: users should quickly understand **what they get, what they give up, worst case, and who can surprise them**. Across every surface:

- **Same honesty architecture:** if a flow is on-chain insurance, say exactly **what event pays, caps, treasury/backstop limits**, and what happens when funds are insufficient. If it is lending, say **LTV, liquidation, oracle dependence, and time-to-liquidation** in human terms. If it is yield or liquidity, say **where return comes from** (fees, emissions, counterparty risk)—not “passive income” as a black box.
- **Privacy as dignity, not magic:** shielded flows hide what the **deployed circuits and contracts** say they hide, from whom, under which assumptions. Default L1 transparency remains the baseline unless the user explicitly chooses a private path. The **engineering north star** for pushing AGS-related activity toward maximum practical stealth (without outrunning what bytecode proves) lives in **[AGS_MAXIMUM_STEALTH_MASTER_PLAN.md](./AGS_MAXIMUM_STEALTH_MASTER_PLAN.md)**; **Phase-A client defaults** (RPC warnings, optional third parties, fingerprinting policy) are in **[PRIVACY_DEFAULTS_AND_FINGERPRINTING.md](./PRIVACY_DEFAULTS_AND_FINGERPRINTING.md)**. Public copy must still match those docs phase-by-phase.
- **Governance as user protection, not theatre:** if an admin path exists in any deployment, documentation and UI must say so. If only votes can change a parameter, point to the **governance contracts** and the **timelock/delay** that gives users time to react.

Violating this spine in any single module undermines trust in **all** modules—because users correctly treat the brand as one wallet surface.

---

## 2. Module map — what “real” means here

These are **category boundaries**, not legal advice. Wording in the app must never promise bank regulation, deposit insurance, or life coverage unless you have obtained that status and wired it off-chain.

### Token distribution (auction, bonding curve, allocation)

**Real** means published price rules, caps, and settlement match **deployed** sale contracts; ZK proves only what those circuits encode. The **initial sale UI** (`frontend-token-distribution/`) must present the Dutch auction as **market price discovery** (a specific on-chain mechanism), not as promotional “deals” or guaranteed discounts. **Lovable** means users can answer “why this price?” in one breath: *the contract lowers the ask over time; I paid the rule when I bought.*

### Swap & liquidity

**Real** means explicit AMM / pool risk: impermanent loss, MEV, oracle or TWAP assumptions where relevant, and that **RPC/UI are not execution guarantees**. **Lovable** means predictable fees and no surprise “you received 0” without a clear revert reason path.

### Lending

**Real** means collateral, liquidation threshold, penalty, and **oracle source** are visible before borrow; insolvency of a pool is a documented scenario. **Lovable** means the first screen states **max loss** in the user’s own words, not only APY.

### Insurance (on-chain)

**Real** means **parametric scope**: which verifiable conditions pay, to what cap, from which vault, and what happens if the vault is drained. Never use “insurance” to mean “you cannot lose money” unless the contract literally enforces that (it almost never does). **Lovable** means a user can repeat the coverage story in one sentence to a friend.

### Staking & yield farming

**Real** means lockups, slashing or lack thereof, reward source (inflation vs fees), and governance control over emissions are clear. **Lovable** means no APY bait without **duration and risk** next to it.

### Crowdfunding

**Real** means refund rules, milestone or nullifier semantics, and fee paths match the deployed crowdfunding contracts. **Lovable** means backers know **when** money is irrevocable.

### Bridge

**Real** means trust model of validators/relayers, delay/finality, and **censorship or revert** scenarios are stated. **Lovable** means expected time bounds and “your funds are here / there” state is obvious.

### Governance (DAO)

**Real** means proposal, quorum, execution delay, and **execution majority** thresholds are visible (see `getGovernanceConfig()` in the UI and on-chain reads). Early token recipients participate under the **same** rules as later buyers: the contracts do not have a “founder bypass” unless one is explicitly deployed and disclosed. **Lovable** means a non-expert believes **surprise upgrades are costly and slow**, not impossible—honesty beats “trust us, it’s decentralized.”

---

## 3. Relationship to other docs

| Document | Role |
|----------|------|
| [FOUNDING_PRINCIPLES.md](./FOUNDING_PRINCIPLES.md) | Verify-first ethos, ZK scope, sovereignty |
| This file | DAO + cross-module trust and language |
| [TOKEN_SUPPLY_GOVERNANCE_AND_DEPLOYMENT.md](./TOKEN_SUPPLY_GOVERNANCE_AND_DEPLOYMENT.md) | Supply split, governance timing, UI pointers |
| [SONIC_MAINNET_LAUNCH.md](./SONIC_MAINNET_LAUNCH.md) | Operator steps for chain 146 |
| [OMNICHAIN_PRIVACY_AND_RPC.md](./OMNICHAIN_PRIVACY_AND_RPC.md) | RPC and privacy semantics |
| [CIRCUITS_OPEN_SOURCE.md](./CIRCUITS_OPEN_SOURCE.md) | Publishing Circom sources, audit priorities, auction↔Solidity alignment |
| [Aegis-contracts/docs/DAO_CONFLICTS_OF_INTEREST_AND_ROLE_SEPARATION.md](../Aegis-contracts/docs/DAO_CONFLICTS_OF_INTEREST_AND_ROLE_SEPARATION.md) | Mishkin-style **conflicts of interest** and role separation (timelock, emergency vs routine, disclosure) |

## 4. Maintainer rule

Any new feature or copy change should ask: **does this sentence remain true if the user reads the contract next?** If not, rewrite the sentence or the contract—never ship the gap.

## 5. Frontend alignment

The main dApp embeds a shared **`DaoModuleNotice`** on each financial module page (`frontend/src/components/DaoModuleNotice.tsx`) so in-app copy tracks this document; keep new routes consistent when adding products.

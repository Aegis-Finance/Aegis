# Founding principles (Aegis)

This is **not** the Bitcoin whitepaper. Aegis is a separate system on **Sonic** and other EVM deployments. The ethos below is deliberately aligned with what made early [Bitcoin](https://bitcoin.org/) documentation compelling: **plain language**, **verify don’t trust**, and **no reliance on a central storyteller**.

## 1. Root of trust

- **The chain is the source of truth.** Balances, rules, and upgrades live in contracts anyone can read.
- **The UI is not the protocol.** A website on Arweave is convenience; if it lies, you reject it and call the contracts directly.
- **ZK proves what the circuit encodes—nothing more.** Marketing must never outrun the verifier. Public review of `Aegis-contracts/circuits/` is encouraged; see **[`docs/CIRCUITS_OPEN_SOURCE.md`](./CIRCUITS_OPEN_SOURCE.md)** for disclosure policy and high-risk review targets.

## 2. Privacy is an engineering claim, not a vibe

- **Aegis = shielded by intent:** the name carries the product posture—**native AGS** and **in-ecosystem** value should default to **commitments / ZK-backed paths** (circuits + verifiers + authorized privacy entry), not “transparent mode” habits. Third-party assets (ETH, USDC, external DEX pools) remain **externally observable**; we do not market them as Aegis privacy.
- **Inside the protocol, ZK-first:** value and state that belong *inside* Aegis should move through **shielded / proof-backed** UI and contracts, not shortcuts—except where governance explicitly keeps a **labeled** legacy rail for interoperability.
- **Sonic L1 and public explorers stay observable:** anyone can still see native transfers and contract calls on the host chain when users touch public contracts or bridges. Marketing must separate **“private inside Aegis rails”** from **“invisible on Sonicscan”** (usually false).
- **Privacy and “stealth”** are threat-model statements: say what is hidden, from whom, and on what assumptions.

## 3. Sovereignty means your hardware

- **Connecting a browser wallet is not running a full node.** Sovereignty is running **your own JSON-RPC** (or trusting a URL you chose), not re-branding MetaMask.
- **Ship tools, not slogans:** sovereign-node-app, RPC selector, documented ports.

## 4. Governance without mystique

- **If a key can override the contracts, say so.** If only votes can change parameters, say that—and point to the `Governance` entry points.
- **No “autonomous” theatre:** autonomy is what the bytecode actually enforces.
- **DAO flywheel is on-chain math, not vibes:** fees, splits, insurance watermarks, and incentives only compound if the deployed contracts actually move value that way—and if voters keep parameters aligned with reality.

## 4b. ZK lessons we import (and mistakes we refuse)

The field has paid for **trusted-setup leaks**, **circuit/marketing mismatch**, **bridge semantics**, and **UX that promised “private” while leaking metadata**. Aegis treats ceremony hygiene, verifier scope honesty, and RPC/indexer reality as **first-class engineering**, not marketing garnish. The longer write-up lives in **[`ZK_DAO_GOVERNANCE_LESSONS.md`](./ZK_DAO_GOVERNANCE_LESSONS.md)**.

## 5. Open source as accountability

- Source lives in the repository; releases should publish **hashes** of binaries and circuit artifacts when applicable.
- **We do not ask you to believe.** We ask you to compile, test, and diff.

## 6. DAO shape — one wallet, one promise

Aegis is governed as a **DAO**: protocol evolution is intended to run through **on-chain votes** under the rules the contracts enforce. **Voting power follows the token and governance rules for every holder**—including allocation received at launch; there is no separate “narrative layer” of democracy. Product copy across **all** modules (lending, insurance, liquidity, bridge, etc.) must stay aligned with what the bytecode can guarantee. The cross-module spine for that alignment lives in **[DAO_TRUST_CONTRACT.md](./DAO_TRUST_CONTRACT.md)**.

## 7. One sentence for busy people

**Aegis is open-source financial software on Sonic: the name assumes a shielded-default for native AGS and in-ecosystem flows; verify the contracts, run your own node if you care about RPC observers, default to ZK-backed paths for in-protocol activity, and treat ZK as cryptography with a scope—not magic.**

For deployment discipline, see [SONIC_MAINNET_LAUNCH.md](./SONIC_MAINNET_LAUNCH.md). For **production readiness** (ZK gates, prover, known circuit gaps), see [PRODUCTION_READINESS.md](./PRODUCTION_READINESS.md). For privacy and RPC semantics, see [OMNICHAIN_PRIVACY_AND_RPC.md](./OMNICHAIN_PRIVACY_AND_RPC.md). For early **DeFi + privacy vision** vs what is implemented today (and Sonic Gateway positioning), see **[DEFI_PRIVACY_VISION_STATUS.md](./DEFI_PRIVACY_VISION_STATUS.md)**. For **DAO + ZK operating discipline** (ceremony scope, governance levers like `publicEntryEnabled`, flywheel honesty), see **[ZK_DAO_GOVERNANCE_LESSONS.md](./ZK_DAO_GOVERNANCE_LESSONS.md)**. For **DEX scope** (AMM → limits/RFQ → private order-flow), see **[DEX_AND_PRIVATE_TRADING_ROADMAP.md](./DEX_AND_PRIVATE_TRADING_ROADMAP.md)**. Diagram sources: `Aegis-contracts/architecture/*.dot` — run `npm run architecture:render` in `Aegis-contracts/` (or `npm run contracts:architecture` from the monorepo root) after edits.

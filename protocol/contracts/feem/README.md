# Fee Monetization (FeeM) — Aegis (`AGSFeeMonetization`)

This folder implements the **on-chain treasury and splitter** that sits **after** Sonic’s official [Fee Monetization](https://docs.soniclabs.com/funding/fee-monetization) program. It is **not** a replacement for Sonic’s FeeM contracts oracles; it is where the protocol chooses to **receive S fee proceeds** and **route them under DAO control**.

**Canonical Sonic tables (RPC, wS, Gateway, FeeM registrar addresses):** [`docs/SONIC_CANONICAL_DATA.md`](../../docs/SONIC_CANONICAL_DATA.md).

## What Sonic FeeM does (off-chain + Sonic contracts)

Per Sonic’s documentation ([Fee Monetization](https://docs.soniclabs.com/funding/fee-monetization)):

1. Users pay gas in **S**; **~10%** goes to validators and **~90%** is attributed to FeeM.
2. **Oracles** track gas usage per **registered** app (including sub-calls) so rewards are not double-counted.
3. When an app **claims**, oracles confirm usage and **S is released** to the app’s configured rewards recipient (see also the [FeeM dashboard](https://feem.soniclabs.com/)).

Aegis does **not** implement oracle quorum or the FeeM claim transaction itself inside `AGSFeeMonetization`; those live in Sonic’s infrastructure.

On Sonic, contract registration uses the **Projects’ Contracts Registrar** and your **FeeM Project ID** in `selfRegister(uint256)` — see [Apply — Fee Monetization](https://docs.soniclabs.com/funding/fee-monetization/apply). In this repo the constructor/storage field is still named `feemCategory` for bytecode compatibility, but the value is that **project id**.

## End-to-end: from Sonic FeeM to voter-controlled splits

1. **Attribution (Sonic):** Oracles + registered **proxy** addresses determine how much of the 90% FeeM slice belongs to your app ([FAQ](https://docs.soniclabs.com/funding/fee-monetization)).
2. **Claim (Sonic):** You (or ops) run the **FeeM claim** flow so **S** lands in the **rewards recipient** you configured in the FeeM dashboard (still Sonic-side economics).
3. **Treasury rail (Aegis):** The recipient wallet (often a multisig) must get **S** into `AGSFeeMonetization` — typically by **`approve` + `collectFees(amount)`** on the **same ERC-20** you passed as `S_TOKEN` in the constructor (on mainnet this is usually **wS**, [`0x039e…d38`](https://docs.soniclabs.com/sonic/build-on-sonic/contract-addresses)).
4. **Distribution (Aegis / voters):** Governance sets **where** basis points go (`updateRewardContracts`, `updateDistributionConfig`, …) and may call `distributeFees` / rely on internal distribution logic; future changes go through your **governance / timelock** so **voters** control the policy.

## How Aegis uses it (deployment phases)

Typical lifecycle (“core first, FeeM splitter when Sonic is ready”):

1. **Core protocol deploy** — staking, governance, token, etc. go live **without** depending on `AGSFeeMonetization`.
2. **Sonic review** — project is approved for FeeM; you register the **correct contract addresses** (usually **proxies**, not every user copy) per Sonic’s FAQ in the same doc.
3. **Deploy `AGSFeeMonetization`** on the target chain with constructor args: `agsToken`, `sToken`, `governance`, **`feemRegistry`**, **`feemCategory`** (see `deploy.example.env`).
4. **Wire recipients** — governance calls `updateRewardContracts` / `updateDistributionConfig` so splits point at live staking, yield, privacy rewards, treasury, etc.
5. **Register on-chain** — when Sonic has given you the **canonical registry + category for that chain**, either they were already passed in the constructor, or governance calls **`setFeeMRegistrationTarget(registry, category)`** once (only if the constructor used `feemRegistry = address(0)` as a placeholder). Then call **`registerWithFeeM()`** (`selfRegister` on that registry).
6. **Inflow of S** — after FeeM releases rewards to your **collector**, the address with `FEE_COLLECTOR_ROLE` calls **`collectFees(amount)`** to pull S into this contract (and optionally trigger `_distributeFees` when thresholds are met).
7. **Governance control** — basis-point splits and destinations are governance-owned; the governance slice accrues in **`governanceIncentivesReserved`** and can be moved via **`withdrawGovernanceIncentives`**.

So: **Sonic decides attribution and claimability of the 90% slice**; **Aegis governance decides how S is allocated** once it is in `AGSFeeMonetization`.

## Fast path after Sonic approval (minimal steps)

Assuming the splitter was already deployed with **`feemRegistry = address(0)`** to avoid wrong-network constants:

1. Governance **`setFeeMRegistrationTarget(SonicRegistry, SonicCategory)`** — one transaction.
2. Governance **`registerWithFeeM()`** — one transaction (idempotent guard: cannot run twice).
3. Wire **`updateRewardContracts`** if not done yet; configure **`collectFees`** operator / approvals from the FeeM payout wallet.

If you deployed with **correct `feemRegistry` + `feemCategory` from day one**, skip step 1 and only run **`registerWithFeeM()`** after Sonic says you are cleared to register.

## Contract reference

| Item | Role |
|------|------|
| **Constructor** `(_agsToken, _sToken, _governance, _feemRegistry, _feemCategory)` | Binds tokens and governance; if `_feemRegistry != 0`, stores registry + category and emits `FeeMRegistrationTargetSet`. |
| **`setFeeMRegistrationTarget`** | One-time fill when constructor used `address(0)` placeholder. |
| **`registerWithFeeM`** | Calls `selfRegister(feemCategory)` on `feemRegistry` — argument is Sonic **FeeM Project ID**. Reverts if registry not set. |
| **`collectFees`** | `transferFrom` S into this contract; does **not** perform Sonic’s FeeM claim. |
| **`_distributeFees` / `distributeFees`** | Splits balance per `DistributionConfig`; increments `governanceIncentivesReserved` for the governance bps. |
| **`withdrawGovernanceIncentives`** | Transfers out of the tracked governance reserve. |

## Env template

Copy **`deploy.example.env`** to your deployer env file and fill addresses. **Always re-verify** `FEEM_REGISTRY` and **`FEEM_PROJECT_ID`** (or legacy `FEEM_CATEGORY`) for the exact chain — see [Apply](https://docs.soniclabs.com/funding/fee-monetization/apply) and [`docs/SONIC_CANONICAL_DATA.md`](../../docs/SONIC_CANONICAL_DATA.md).

**Automated orchestrator** (`scripts/automation/deployment-orchestrator.js`) reads **`FEEM_REGISTRY`** / **`FEEM_CATEGORY`** for the **`AGSFeeMonetization`** constructor only. With **`AUTO_FEEM_REGISTRATION=true`**, phase 6 **does not** call Sonic’s registry from the deployer; it logs next steps and writes **`feeMRegistration`** metadata into the deployment report (real registration stays **`registerWithFeeM()`** on the splitter via governance, or **`scripts/feem/deploy-feem.js`** with the right signer).

## Operational checklist

- [ ] `FEEM_REGISTRY` and **FeeM Project ID** (`FEEM_PROJECT_ID` / `FEEM_CATEGORY`) match **this chain’s** Sonic FeeM deployment (not copied blindly from another network).
- [ ] `S_TOKEN` matches the token you use for **`collectFees`** (mainnet wS per [contract addresses](https://docs.soniclabs.com/sonic/build-on-sonic/contract-addresses) unless Sonic documents otherwise).
- [ ] FeeM **payout / claim recipient** plan matches how `collectFees` will be funded (collector multisig approves `S` spend to this contract, etc.).
- [ ] `minimumDistributionAmount` and `distributionInterval` match ops expectations.
- [ ] Document who holds `FEE_COLLECTOR_ROLE` and `DISTRIBUTION_MANAGER_ROLE`.

## Further reading

- Sonic: [Contract addresses](https://docs.soniclabs.com/sonic/build-on-sonic/contract-addresses) (wS, Gateway, …)  
- Sonic: [Fee Monetization documentation](https://docs.soniclabs.com/funding/fee-monetization)  
- Sonic: [Apply to Fee Monetization](https://docs.soniclabs.com/funding/fee-monetization/apply)  
- Product: [FeeM dashboard](https://feem.soniclabs.com/)

---

**خلاصه (فارسی):** فی‌مونیتیزیشن سونیک همان مدل ۹۰٪ و claim است ([مستند](https://docs.soniclabs.com/funding/fee-monetization)). `AGSFeeMonetization` **آدرس Registrar و شناسهٔ پروژهٔ FeeM (`selfRegister`) را per-network می‌گیرد** (فیلد ذخیره‌سازی هنوز `feemCategory` نام دارد ولی مقدارش **Project ID** سونیک است). بعد از claim، **S/wS** باید به قرارداد برسد (`approve` + **`collectFees`**)؛ **تقسیم و مقصدها** با توابع حاکمیتی تنظیم می‌شود و رأی‌دهندگان از مسیر گاورننس/تایم‌لاک آن را عوض می‌کنند. جدول آدرس‌های رسمی و wS: **`docs/SONIC_CANONICAL_DATA.md`**.

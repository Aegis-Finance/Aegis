# Open-sourcing Aegis Circom circuits — what to publish, what to protect, what reviewers should attack

The **`.circom` sources** under `Aegis-contracts/circuits/` are intended to live **in public version control** next to Solidity. Security comes from **auditable math + ceremony discipline**, not from hiding source. This document sets expectations for maintainers and external reviewers.

**Before any production verifier / factory wiring change**, follow **[`ZK_AND_VERIFIER_RELEASE_CHECKLIST.md`](ZK_AND_VERIFIER_RELEASE_CHECKLIST.md)** (pinning, ceremony, on-chain smoke, and what must never ship).

## What is already “public” in a healthy repo

| Artifact | Typical policy |
|----------|------------------|
| `*.circom` | **Commit** — primary review surface. |
| `circuits/README.md`, this file | **Commit** — how to build, validate, and report issues. |
| `build/circuits/*.wasm` (optional CI) | **Commit or CI artifact** — wasm is not toxic; still verify hashes match releases. |
| `*.r1cs`, `*.sym` | Often **CI-only** or release artifacts — large; regenerate from source. |
| Phase-2 `*.zkey` (contributions), toxic waste | **Never commit** production secrets — see `.gitignore` and `docs/CIRCUITS_AND_CEREMONY.md` (if present) / internal ceremony runbook. |
| `verification_key.json` derived from final zkey | **Safe to publish** for client-side proving; the **trusted setup** integrity is the ceremony, not hiding the vk. |

Groth16 soundness for users **does** require that the **verifier contract on-chain** was deployed from a **transcript** you stand behind (multi-party or audited process), not from a single machine’s `zkey contribute` in silence.

## What independent review must verify (high leverage)

These are **code-review questions**, not a substitute for a professional cryptography audit.

### 1. Public I/O layout ↔ on-chain verifier

For each `VerifierFactory` circuit id (e.g. `"auction"`, `"auction-claim"`), the **order and semantics of public signals** must match what Solidity passes to `verifyProof`. Any drift → proofs fail **or** (worse) unintended acceptance if the contract is wrong.

**Concrete pointer:** `AutomatedDutchAuction.getAuctionVerifierPublicInputs` and `purchaseTokens` use **six** public field elements; the `"auction"` Circom `main` must be compiled with **exactly** that layout.

### 2. Auction price law ↔ `AuctionPriceLib`

On-chain price uses `AuctionPriceLib.linearDutchPrice` with **integer floor**:

`priceDecay = (startPrice - reservePrice) * elapsed / duration` (Solidity `/` on `uint256`).

Public input `[5]` is `decayRatePerSecondWad = (start - reserve) * WAD / duration` (same floor division).

The in-repo `circuits/auction.circom` enforces the same law via `lib/DivFloor.circom` (witness quotient + remainder) for both decay and WAD rate, and constrains the public rate signal to `floor(delta * WAD / duration)`. **Regression:** `npm run circuits:auction-alignment` (bigint fuzz vs the Solidity formulas).

### 3. Field underflows / window discipline

The auction circuit constrains `currentTime < startTime + duration` and `currentTime >= startTime`, so `elapsed` and `timeRemaining = end - current` stay in the non-negative integer semantics the Solidity sale path uses (`block.timestamp < endTime` on purchase).

### 4. Public I/O surface for Groth16

The `"auction"` `main` exposes **exactly six** public inputs (matching `purchaseTokens`); price / validity are **private** witness signals — economic checks remain in Solidity (`require`, price impact, etc.). Reviewers should still confirm every constraint needed for the claimed privacy story is present in-circuit.

### 5. Minimal circuits (e.g. `auction-claim.circom`)

Small Poseidon templates are easier to read — reviewers should still confirm **domain separation** (no hash collisions across protocols), **public input binding** to `commitment` and `recipient`, and that the contract’s `verifyProof` checks match the `main { public [...] }` declaration.

## How to respond to findings

1. **Acknowledge** in CHANGELOG / security advisory with severity.  
2. **Freeze** deployments that use a broken verifier until a **new ceremony** + **new verifier address** ship.  
3. **Never** “patch narrative only” — bytecode and circuits must move together.

## Maintainer checklist before advertising “circuits open for review”

- [ ] `npm run circuits:validate` (or equivalent) passes on `main`.  
- [ ] `npm run circuits:auction-alignment` passes (math ↔ `AuctionPriceLib`).  
- [ ] `npm run circuits:auction-snark-e2e` passes (circom + dev Groth16 prove/verify; needs `circom` on PATH).  
- [ ] Document the **exact** circom commit hash used for each **production** `.zkey` / verifier.  
- [ ] Publish **verification key** or allow regeneration from published ceremony transcript.  
- [ ] Run at least one **end-to-end** proof: prover → `verifyProof` on testnet with real public inputs from `AutomatedDutchAuction`.  
- [ ] File a **SECURITY.md** at repo root with contact / bug bounty if applicable.  
- [ ] Walk **[`ZK_AND_VERIFIER_RELEASE_CHECKLIST.md`](ZK_AND_VERIFIER_RELEASE_CHECKLIST.md)** for any production verifier / ceremony / factory change.

### Quick smoke test (auction math + dev Groth16)

From the **`Aegis-contracts/`** package root (where `package.json` for contracts lives):

```bash
cd Aegis-contracts
npm run circuits:auction-check
```

Runs `circuits:auction-alignment` then `circuits:auction-snark-e2e` (needs **`circom`** on `PATH` or `./circom.exe` next to that `package.json`).

## خلاصه فارسی

سورس **`circuits/*.circom`** عمدتاً باید **عمومی** باشد؛ امنیت از **مرور جمعی + مراسم قابل حساب Groth16** می‌آید، نه از پنهان کردن کد. برای حراج، از ریشهٔ **`Aegis-contracts`** دستور **`npm run circuits:auction-check`** (ریاضی + snarkjs) را بزنید؛ **`auction.circom`** با **`AuctionPriceLib`** و شش ورودی عمومی هم‌تراز است. قبل از هر تغییر جدی روی verifier یا factory، چک‌لیست **[`ZK_AND_VERIFIER_RELEASE_CHECKLIST.md`](ZK_AND_VERIFIER_RELEASE_CHECKLIST.md)** را طی کنید. برای اعتماد تولید هنوز **proof روی زنجیره** و در نهایت **audit** لازم است. یافتهٔ جدی یعنی **verifier جدید + سرمونی جدید**، نه فقط اصلاح متن سایت.

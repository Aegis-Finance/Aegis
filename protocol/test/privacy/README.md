# Phase F privacy entry (Hardhat)

## Mock scaffold (`MockPrivacyEntryRelay`)

- **Contract:** `contracts/test/MockPrivacyEntryRelay.sol` — governance **`authorizeContract`** on `PrivateTokenContract`, then this relay can forward:
  - **`relayShield(depositor, proof, inputs)`** — checks `publicInputs[3]` matches `depositor` (mint layout).
  - **`relayUnshield(proof, inputs)`** — forwards **transparent exit** (`PrivateTokenContract.unshield`; relayer pays gas).
  - **`relayShieldedTransfer(proof, inputs)`** — forwards `shieldedTransfer` (**11** public inputs; join-split layout per `PrivateTokenContract`).
- **Tests:** `MockPrivacyEntryRelay.test.js` — relayer gas, **`publicEntryEnabled == false`** (user direct calls revert; relay succeeds), shield→transparent-exit cycle, counters. Fixture calls **`token.syncVerifiersFromFactory()`** so `transfer-optimized` resolves without a prior shield.

## Production router (`PrivacyEntryRouter`)

- **Contract:** `contracts/privacy/PrivacyEntryRouter.sol` — same **`authorizeContract`** requirement; **`relayShield` / `relayShieldedTransfer` / `relayUnshield`** (transparent exit) require **EIP-712** signatures binding **`keccak256(abi.encode(publicInputs))`** + **nonce** + **deadline** per principal (`depositor` / `authorizedSigner` / `recipient` for exit). Owner may **`setPaused`**. Optional **native relay fee**: **`setRelayFee(feeWei, recipient)`** — relayers must send **`msg.value >= relayFeeWei`**; fee is taken **after** a successful `TOKEN` call; overpay refunded to `msg.sender`; if fee is zero, accidental **`msg.value`** is refunded.

- **Tests:** `PrivacyEntryRouter.test.js` — digest parity with Solidity, happy paths, `ExpiredIntent` / `BadNonce` / `BadSig` / `Paused`, **`publicEntryEnabled == false`** for shield + shielded transfer, and **relay fee** (forward, refund, `InsufficientRelayFee`).

## Public I/O layout (fast-check)

- **Tests:** `ZkPublicLayoutInvariants.test.js` — property checks that mint / **transparent exit** (`unshield`) **address slots** in `publicInputs` match `uint256(uint160(addr))` (same encoding as `PrivacyEntryRouter` / client `zeroPadValue` paths).

## Run

From `Aegis-contracts/`:

```bash
npm run test:privacy-relay
```

**Doctrine:** “Aegis = shielded” for **native AGS / in-ecosystem** value — see `docs/AEGIS_MAXIMUM_STEALTH_LOCAL_BUILD_SPEC.md` §0.

**Governance:** add the deployed router to **`authorizedContracts`** before **`setPublicEntryEnabled(false)`** — see `docs/PRIVATE_TOKEN_AUTHORIZE_CONTRACT_MATRIX.md`.

**Ops / dev HTTP relayer:** `npm run ops:privacy-entry-relayer --prefix Aegis-contracts` — see `docs/ops/PRIVACY_ENTRY_RELAYER.md`.

Next steps (product / ops): allowlists, monitoring, external audit before mainnet.

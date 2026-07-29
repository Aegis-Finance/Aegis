pragma circom 2.0.0;

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/bitify.circom";

/**
 * @title Sybil protection (TimeLockPurchaseLimits binding)
 * @notice Groth16 public signals **must** match `TimeLockPurchaseLimits.recordPurchaseWithSybilProtection`:
 *   `publicInputs[0] = identityCommitment`, `[1] = identityNullifier`, `[2] = buyer (uint160 as uint256)`,
 *   `[3] = purchase amount`. Verifier `ic` length is `1 + len(publicInputs)` (snarkjs template).
 * @dev Minimal sound binding: prover knows `identitySecret` such that Poseidon commitments match public
 *      values and `(buyerAddress, purchaseAmount)` are included in the commitment. This replaces an
 *      earlier experimental template that did not declare `main { public [...] }` and could not align
 *      with on-chain `Groth16Verifier` layout.
 */
template SybilProtectionLimits() {
    // Private
    signal input identitySecret;
    signal input purchaseNonce;

    // Public (order fixed for snarkjs ↔ Solidity)
    signal input identityCommitment;
    signal input identityNullifier;
    signal input buyerAddress;
    signal input purchaseAmount;

    // purchaseAmount > 0
    component amtPos = GreaterThan(252);
    amtPos.in[0] <== purchaseAmount;
    amtPos.in[1] <== 0;
    amtPos.out === 1;

    // buyer fits in 160 bits (matches `uint160(buyer)` on-chain)
    component buyerBits = Num2Bits(160);
    buyerBits.in <== buyerAddress;

    component nul = Poseidon(2);
    nul.inputs[0] <== identitySecret;
    nul.inputs[1] <== purchaseNonce;
    nul.out === identityNullifier;

    component com = Poseidon(4);
    com.inputs[0] <== identitySecret;
    com.inputs[1] <== buyerAddress;
    com.inputs[2] <== purchaseAmount;
    com.inputs[3] <== purchaseNonce;
    com.out === identityCommitment;
}

component main {public [
    identityCommitment,
    identityNullifier,
    buyerAddress,
    purchaseAmount
]} = SybilProtectionLimits();

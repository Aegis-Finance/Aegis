pragma circom 2.0.0;

include "../node_modules/circomlib/circuits/poseidon.circom";
include "../node_modules/circomlib/circuits/comparators.circom";
include "../node_modules/circomlib/circuits/bitify.circom";

/**
 * @title mint-optimized — transparent → shielded (`PrivateTokenContract.shield`)
 * @notice **Public I/O (4 signals, field order)** MUST match Solidity + `PrivacyEntryRouter`:
 *         `[0] depositNullifier`, `[1] outputCommitment`, `[2] amount`, `[3] depositor`
 *         where `depositor` is the EVM address interpreted as a field element (`< 2^160`).
 * @dev Note opening matches `transfer-unshield.circom`: `Poseidon(noteSecret, amount, depositor)`.
 *      `depositNullifier` is an independent one-time tag: `Poseidon(depositSecret, depositNonce)`.
 *      Any change to this template requires a **new trusted setup** for the `mint-optimized` factory slot.
 */
template MintOptimizedShield() {
    signal input depositSecret;
    signal input depositNonce;
    signal input noteSecret;

    signal input depositNullifier;
    signal input outputCommitment;
    signal input amount;
    signal input depositor;

    component depNull = Poseidon(2);
    depNull.inputs[0] <== depositSecret;
    depNull.inputs[1] <== depositNonce;
    depNull.out === depositNullifier;

    component noteComm = Poseidon(3);
    noteComm.inputs[0] <== noteSecret;
    noteComm.inputs[1] <== amount;
    noteComm.inputs[2] <== depositor;
    noteComm.out === outputCommitment;

    component amtPos = GreaterThan(252);
    amtPos.in[0] <== amount;
    amtPos.in[1] <== 0;
    amtPos.out === 1;

    // EVM address fits in 160 bits (matches `address(uint160(publicInputs[3]))`).
    component depBits = Num2Bits(160);
    depBits.in <== depositor;
}

component main { public [ depositNullifier, outputCommitment, amount, depositor ] } = MintOptimizedShield();

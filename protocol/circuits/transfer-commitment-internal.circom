pragma circom 2.0.0;

include "../node_modules/circomlib/circuits/poseidon.circom";
include "../node_modules/circomlib/circuits/comparators.circom";

/**
 * @title transfer-commitment-internal — `transferFromCollateral` layout on `PrivateTokenContract`
 * @notice Public I/O (4): `[fromCommitment, toCommitment, amount, nullifier]`.
 * @dev Same note secret `s` for input and output note (protocol-internal move): `fromC = Poseidon(s, amount, 0)`,
 *      `toC = Poseidon(s, amount, 1)`, `nullifier = Poseidon(s, nonce)`. Tags 0/1 distinguish from/to leaves.
 */
template TransferCommitmentInternal() {
    signal input noteSecret;
    signal input nonce;

    signal input fromCommitment;
    signal input toCommitment;
    signal input amount;
    signal input nullifier;

    component fromC = Poseidon(3);
    fromC.inputs[0] <== noteSecret;
    fromC.inputs[1] <== amount;
    fromC.inputs[2] <== 0;
    fromC.out === fromCommitment;

    component toC = Poseidon(3);
    toC.inputs[0] <== noteSecret;
    toC.inputs[1] <== amount;
    toC.inputs[2] <== 1;
    toC.out === toCommitment;

    component nl = Poseidon(2);
    nl.inputs[0] <== noteSecret;
    nl.inputs[1] <== nonce;
    nl.out === nullifier;

    component amtPos = GreaterThan(252);
    amtPos.in[0] <== amount;
    amtPos.in[1] <== 0;
    amtPos.out === 1;
}

component main { public [ fromCommitment, toCommitment, amount, nullifier ] } = TransferCommitmentInternal();

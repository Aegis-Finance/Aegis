pragma circom 2.0.0;

include "../node_modules/circomlib/circuits/poseidon.circom";
include "../node_modules/circomlib/circuits/comparators.circom";
include "../node_modules/circomlib/circuits/bitify.circom";

/**
 * @title transfer-unshield — shielded commitment → transparent balance (`PrivateTokenContract.unshield`, transparent-exit rail)
 * @notice **Public I/O (4 signals)** MUST match Solidity:
 *         `[0] nullifier`, `[1] recipient`, `[2] amount`, `[3] inputCommitment`
 *         (`recipient` is EVM address as field element, `< 2^160`).
 * @dev Proves knowledge of a note opening `(noteSecret, amount, recipient)` whose commitment is
 *      `inputCommitment`, and a spend nullifier `Poseidon(noteSecret, nullifierNonce)`.
 *      On-chain, `PrivateTokenContract` checks commitment + balance before calling the verifier.
 *      **Requires new ceremony** for the `transfer-unshield` factory slot.
 */
template TransferUnshield() {
    signal input noteSecret;
    signal input nullifierNonce;

    signal input nullifier;
    signal input recipient;
    signal input amount;
    signal input inputCommitment;

    component nullifierHasher = Poseidon(2);
    nullifierHasher.inputs[0] <== noteSecret;
    nullifierHasher.inputs[1] <== nullifierNonce;
    nullifierHasher.out === nullifier;

    component commitmentHasher = Poseidon(3);
    commitmentHasher.inputs[0] <== noteSecret;
    commitmentHasher.inputs[1] <== amount;
    commitmentHasher.inputs[2] <== recipient;
    commitmentHasher.out === inputCommitment;

    component amtPos = GreaterThan(252);
    amtPos.in[0] <== amount;
    amtPos.in[1] <== 0;
    amtPos.out === 1;

    component recBits = Num2Bits(160);
    recBits.in <== recipient;
}

component main { public [ nullifier, recipient, amount, inputCommitment ] } = TransferUnshield();

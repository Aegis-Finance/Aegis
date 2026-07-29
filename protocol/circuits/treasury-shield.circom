pragma circom 2.0.0;

include "../node_modules/circomlib/circuits/poseidon.circom";

template TreasuryShield() {
    signal input moveId;
    signal input nullifierHash;
    signal input recipientCommitment;
    signal input merkleRoot;
    signal input secret;
    signal input nullifier;
    signal output valid;

    component nh = Poseidon(2);
    nh.inputs[0] <== secret;
    nh.inputs[1] <== nullifier;
    nh.out === nullifierHash;

    component ch = Poseidon(2);
    ch.inputs[0] <== secret;
    ch.inputs[1] <== moveId;
    ch.out === recipientCommitment;

    valid <== 1;
}

component main {public [moveId, nullifierHash, recipientCommitment, merkleRoot]} = TreasuryShield();

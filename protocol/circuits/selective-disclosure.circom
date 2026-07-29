pragma circom 2.0.0;

include "../node_modules/circomlib/circuits/poseidon.circom";
include "../node_modules/circomlib/circuits/comparators.circom";

template SelectiveDisclosure() {
    signal input nullifierHash;
    signal input kind;
    signal input subjectCommitment;
    signal input threshold;
    signal input merkleRoot;
    signal input secret;
    signal input nullifier;
    signal input privateValue;
    signal output valid;

    component nh = Poseidon(2);
    nh.inputs[0] <== secret;
    nh.inputs[1] <== nullifier;
    nh.out === nullifierHash;

    component ch = Poseidon(3);
    ch.inputs[0] <== secret;
    ch.inputs[1] <== privateValue;
    ch.inputs[2] <== kind;
    ch.out === subjectCommitment;

    component gte = GreaterThan(252);
    gte.in[0] <== privateValue;
    gte.in[1] <== threshold;
    gte.out === 1;

    valid <== 1;
}

component main {public [nullifierHash, kind, subjectCommitment, threshold, merkleRoot]} = SelectiveDisclosure();

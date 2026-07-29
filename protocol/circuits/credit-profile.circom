pragma circom 2.0.0;

include "../node_modules/circomlib/circuits/poseidon.circom";
include "../node_modules/circomlib/circuits/comparators.circom";

template CreditProfile() {
    signal input nullifierHash;
    signal input profileCommitment;
    signal input score;
    signal input minScoreRequired;
    signal input secret;
    signal input nullifier;
    signal output valid;

    component nh = Poseidon(2);
    nh.inputs[0] <== secret;
    nh.inputs[1] <== nullifier;
    nh.out === nullifierHash;

    component ch = Poseidon(2);
    ch.inputs[0] <== secret;
    ch.inputs[1] <== score;
    ch.out === profileCommitment;

    component gte = GreaterThan(32);
    gte.in[0] <== score;
    gte.in[1] <== minScoreRequired;
    gte.out === 1;

    valid <== 1;
}

component main {public [nullifierHash, profileCommitment, score, minScoreRequired]} = CreditProfile();

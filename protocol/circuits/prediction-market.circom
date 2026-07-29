pragma circom 2.0.0;

include "../node_modules/circomlib/circuits/poseidon.circom";

template PredictionMarket() {
    signal input marketId;
    signal input outcome;
    signal input nullifierHash;
    signal input commitmentHash;
    signal input secret;
    signal input nullifier;
    signal output valid;

    component nh = Poseidon(2);
    nh.inputs[0] <== secret;
    nh.inputs[1] <== nullifier;
    nh.out === nullifierHash;

    component ch = Poseidon(3);
    ch.inputs[0] <== secret;
    ch.inputs[1] <== marketId;
    ch.inputs[2] <== outcome;
    ch.out === commitmentHash;

    valid <== 1;
}

component main {public [marketId, outcome, nullifierHash, commitmentHash]} = PredictionMarket();

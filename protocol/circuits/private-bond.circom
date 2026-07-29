pragma circom 2.0.0;

include "../node_modules/circomlib/circuits/poseidon.circom";

template PrivateBond() {
    signal input nullifierHash;
    signal input commitmentHash;
    signal input quoteAmount;
    signal input maturity;
    signal input secret;
    signal input nullifier;
    signal output valid;

    component nh = Poseidon(2);
    nh.inputs[0] <== secret;
    nh.inputs[1] <== nullifier;
    nh.out === nullifierHash;

    component ch = Poseidon(3);
    ch.inputs[0] <== secret;
    ch.inputs[1] <== quoteAmount;
    ch.inputs[2] <== maturity;
    ch.out === commitmentHash;

    valid <== 1;
}

component main {public [nullifierHash, commitmentHash, quoteAmount, maturity]} = PrivateBond();

pragma circom 2.0.0;

include "../node_modules/circomlib/circuits/poseidon.circom";

template PrivateStable() {
    signal input nullifierHash;
    signal input stableCommitment;
    signal input collateralCommitment;
    signal input stableAmount;
    signal input collateralAmount;
    signal input secret;
    signal input nullifier;
    signal output valid;

    component nh = Poseidon(2);
    nh.inputs[0] <== secret;
    nh.inputs[1] <== nullifier;
    nh.out === nullifierHash;

    component sc = Poseidon(2);
    sc.inputs[0] <== secret;
    sc.inputs[1] <== stableAmount;
    sc.out === stableCommitment;

    component cc = Poseidon(2);
    cc.inputs[0] <== secret;
    cc.inputs[1] <== collateralAmount;
    cc.out === collateralCommitment;

    valid <== 1;
}

component main {public [nullifierHash, stableCommitment, collateralCommitment, stableAmount, collateralAmount]} = PrivateStable();

pragma circom 2.0.0;

include "../node_modules/circomlib/circuits/poseidon.circom";
include "../node_modules/circomlib/circuits/comparators.circom";

/**
 * @title Lending liquidity withdraw
 * @notice 4 public inputs — `withdrawLiquidity`: `[liquidityNullifier, outputCommitment, shares, amount]`.
 */
template LendingWithdraw() {
    signal input liquidityNullifier;
    signal input outputCommitment;
    signal input shares;
    signal input amount;

    signal input secret;
    signal input nullifier;

    signal output valid;

    component nh = Poseidon(2);
    nh.inputs[0] <== secret;
    nh.inputs[1] <== nullifier;
    nh.out === liquidityNullifier;

    component oc = Poseidon(4);
    oc.inputs[0] <== secret;
    oc.inputs[1] <== shares;
    oc.inputs[2] <== amount;
    oc.inputs[3] <== nullifier;
    oc.out === outputCommitment;

    component gts = GreaterThan(252);
    gts.in[0] <== shares;
    gts.in[1] <== 0;
    gts.out === 1;

    component gta = GreaterThan(252);
    gta.in[0] <== amount;
    gta.in[1] <== 0;
    gta.out === 1;

    valid <== 1;
}

component main {
    public [liquidityNullifier, outputCommitment, shares, amount]
} = LendingWithdraw();

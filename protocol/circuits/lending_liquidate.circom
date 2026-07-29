pragma circom 2.0.0;

include "../node_modules/circomlib/circuits/poseidon.circom";
include "../node_modules/circomlib/circuits/comparators.circom";

/**
 * @title Lending liquidation
 * @notice 4 public inputs — `liquidateLoan`: `[liquidatorNullifier, liquidatorCommitment, loanId, liquidationAmount]`.
 */
template LendingLiquidate() {
    signal input liquidatorNullifier;
    signal input liquidatorCommitment;
    signal input loanId;
    signal input liquidationAmount;

    signal input secret;
    signal input nullifier;

    signal output valid;

    component nh = Poseidon(2);
    nh.inputs[0] <== secret;
    nh.inputs[1] <== nullifier;
    nh.out === liquidatorNullifier;

    component cm = Poseidon(3);
    cm.inputs[0] <== secret;
    cm.inputs[1] <== liquidationAmount;
    cm.inputs[2] <== nullifier;
    cm.out === liquidatorCommitment;

    component gt = GreaterThan(252);
    gt.in[0] <== liquidationAmount;
    gt.in[1] <== 0;
    gt.out === 1;

    valid <== 1;
}

component main {
    public [liquidatorNullifier, liquidatorCommitment, loanId, liquidationAmount]
} = LendingLiquidate();

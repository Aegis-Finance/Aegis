pragma circom 2.0.0;

include "../node_modules/circomlib/circuits/poseidon.circom";
include "../node_modules/circomlib/circuits/comparators.circom";

/**
 * @title Lending repay
 * @notice 5 public inputs — `repayLoan`: `[loanNullifier, repaymentNullifier, collateralOutputCommitment, loanId, repaymentAmount]`.
 *         Binds nullifiers and repayment commitment to the same secret; `loanId` is enforced on-chain.
 */
template LendingRepay() {
    signal input loanNullifier;
    signal input repaymentNullifier;
    signal input collateralOutputCommitment;
    signal input loanId;
    signal input repaymentAmount;

    signal input secret;
    signal input nullifierLoan;
    signal input nullifierRepay;

    signal output valid;

    component h0 = Poseidon(2);
    h0.inputs[0] <== secret;
    h0.inputs[1] <== nullifierLoan;
    h0.out === loanNullifier;

    component h1 = Poseidon(2);
    h1.inputs[0] <== secret;
    h1.inputs[1] <== nullifierRepay;
    h1.out === repaymentNullifier;

    component cm = Poseidon(3);
    cm.inputs[0] <== secret;
    cm.inputs[1] <== repaymentAmount;
    cm.inputs[2] <== nullifierRepay;
    cm.out === collateralOutputCommitment;

    component gt = GreaterThan(252);
    gt.in[0] <== repaymentAmount;
    gt.in[1] <== 0;
    gt.out === 1;

    valid <== 1;
}

component main {
    public [
        loanNullifier,
        repaymentNullifier,
        collateralOutputCommitment,
        loanId,
        repaymentAmount
    ]
} = LendingRepay();

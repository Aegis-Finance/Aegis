pragma circom 2.0.0;

include "../node_modules/circomlib/circuits/poseidon.circom";
include "../node_modules/circomlib/circuits/comparators.circom";

/**
 * @title Lending liquidity provision
 * @notice 3 public inputs — must match `provideLiquidity` on `PrivateLendingContract`:
 *         `[inputNullifier, outputCommitment, amount]`.
 */
template LendingLiquidity() {
    signal input nullifierHash;
    signal input outputCommitment;
    signal input amount;

    signal input secret;
    signal input nullifier;

    signal output valid;

    component nh = Poseidon(2);
    nh.inputs[0] <== secret;
    nh.inputs[1] <== nullifier;
    nh.out === nullifierHash;

    component oc = Poseidon(3);
    oc.inputs[0] <== secret;
    oc.inputs[1] <== amount;
    oc.inputs[2] <== nullifier;
    oc.out === outputCommitment;

    component gt = GreaterThan(252);
    gt.in[0] <== amount;
    gt.in[1] <== 0;
    gt.out === 1;

    valid <== 1;
}

component main { public [nullifierHash, outputCommitment, amount] } = LendingLiquidity();

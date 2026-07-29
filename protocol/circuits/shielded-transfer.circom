pragma circom 2.0.0;

include "../node_modules/circomlib/circuits/poseidon.circom";
include "../node_modules/circomlib/circuits/comparators.circom";

/**
 * @title shielded-transfer — full merge join-split (`PrivateTokenContract.shieldedTransfer`)
 * @notice **11 public signals** (order fixed for verifier IC + Solidity):
 *         `[0]` inputNullifier1, `[1]` inputNullifier2, `[2]` outputCommitment1, `[3]` outputCommitment2,
 *         `[4]` totalAmount, `[5]` inputCommitment1, `[6]` inputCommitment2,
 *         `[7]` balanceIn1 (contract **overwrites** from storage before verify), `[8]` balanceIn2,
 *         `[9]` outputAmount1, `[10]` outputAmount2.
 * @dev On-chain policy: **full consume** of both input notes: `balanceIn1 + balanceIn2 == totalAmount`.
 *      **Input note openings** use `Poseidon(secret, balance, rIn)` where `rIn` is the **same third limb**
 *      baked into the commitment at note creation (e.g. `mint-optimized`: `rIn = depositor` field; prior
 *      join-split outputs: `rIn ∈ {1,2}` matching this template’s output tags). `rIn` is **private**; only
 *      the commitment hashes and balances are constrained against chain state.
 *      **Output** notes use fixed tags **1** and **2** so the next spend can supply those as `rIn`.
 */
template ShieldedTransferJoinSplit() {
    signal input s1;
    signal input nn1;
    signal input rIn1;
    signal input s2;
    signal input nn2;
    signal input rIn2;

    signal input os1;
    signal input oa1;
    signal input os2;
    signal input oa2;

    signal input inputNullifier1;
    signal input inputNullifier2;
    signal input outputCommitment1;
    signal input outputCommitment2;
    signal input totalAmount;
    signal input inputCommitment1;
    signal input inputCommitment2;
    signal input balanceIn1;
    signal input balanceIn2;
    signal input outputAmount1;
    signal input outputAmount2;

    component n1 = Poseidon(2);
    n1.inputs[0] <== s1;
    n1.inputs[1] <== nn1;
    n1.out === inputNullifier1;

    component n2 = Poseidon(2);
    n2.inputs[0] <== s2;
    n2.inputs[1] <== nn2;
    n2.out === inputNullifier2;

    component ic1 = Poseidon(3);
    ic1.inputs[0] <== s1;
    ic1.inputs[1] <== balanceIn1;
    ic1.inputs[2] <== rIn1;
    ic1.out === inputCommitment1;

    component ic2 = Poseidon(3);
    ic2.inputs[0] <== s2;
    ic2.inputs[1] <== balanceIn2;
    ic2.inputs[2] <== rIn2;
    ic2.out === inputCommitment2;

    component o1 = Poseidon(3);
    o1.inputs[0] <== os1;
    o1.inputs[1] <== oa1;
    o1.inputs[2] <== 1;
    o1.out === outputCommitment1;

    component o2 = Poseidon(3);
    o2.inputs[0] <== os2;
    o2.inputs[1] <== oa2;
    o2.inputs[2] <== 2;
    o2.out === outputCommitment2;

    balanceIn1 + balanceIn2 === totalAmount;
    outputAmount1 + outputAmount2 === totalAmount;

    component gt = GreaterThan(252);
    gt.in[0] <== totalAmount;
    gt.in[1] <== 0;
    gt.out === 1;
}

component main { public [
    inputNullifier1,
    inputNullifier2,
    outputCommitment1,
    outputCommitment2,
    totalAmount,
    inputCommitment1,
    inputCommitment2,
    balanceIn1,
    balanceIn2,
    outputAmount1,
    outputAmount2
] } = ShieldedTransferJoinSplit();

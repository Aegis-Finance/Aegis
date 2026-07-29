pragma circom 2.0.0;

include "../node_modules/circomlib/circuits/poseidon.circom";

template Payroll() {
    signal input employerHash;
    signal input periodId;
    signal input nullifierHash;
    signal input employeeCommitment;
    signal input amount;
    signal input secret;
    signal input nullifier;
    signal output valid;

    component nh = Poseidon(2);
    nh.inputs[0] <== secret;
    nh.inputs[1] <== nullifier;
    nh.out === nullifierHash;

    component ch = Poseidon(3);
    ch.inputs[0] <== secret;
    ch.inputs[1] <== periodId;
    ch.inputs[2] <== amount;
    ch.out === employeeCommitment;

    valid <== 1;
}

component main {public [employerHash, periodId, nullifierHash, employeeCommitment, amount]} = Payroll();

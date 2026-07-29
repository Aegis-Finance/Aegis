pragma circom 2.0.0;

include "../node_modules/circomlib/circuits/poseidon.circom";
include "../node_modules/circomlib/circuits/comparators.circom";

/**
 * @title Lending with explicit tenor (term structure)
 * @notice Mishkin **liquidity premium / maturity**: public `tenorSeconds` binds the loan commitment so the prover cannot claim a short tenor while opening a long-liability position.
 *         **6 public inputs:** `[nullifierHash, collateralCommitment, loanCommitment, collateralAmount, loanAmount, tenorSeconds]`.
 *         Allowed tenors (seconds): 30d, 90d, 365d — tune with governance when wiring a v2 lending contract.
 * @dev Register as VerifierFactory type `lending-tenor` (see `factory-circuits.js`). Solidity must use the same commitment layout (Poseidon4) before switching proofs.
 */

template TenorIsAllowed() {
    var TENOR_30D = 2592000;
    var TENOR_90D = 7776000;
    var TENOR_365D = 31536000;

    signal input tenorSeconds;
    signal output ok;

    component is30 = IsEqual();
    is30.in[0] <== tenorSeconds;
    is30.in[1] <== TENOR_30D;

    component is90 = IsEqual();
    is90.in[0] <== tenorSeconds;
    is90.in[1] <== TENOR_90D;

    component is365 = IsEqual();
    is365.in[0] <== tenorSeconds;
    is365.in[1] <== TENOR_365D;

    signal sumFlags;
    sumFlags <== is30.out + is90.out + is365.out;
    sumFlags === 1;

    ok <== 1;
}

template LendingBorrowTenor() {
    var MIN_LOAN_WEI = 1000000000000000000;

    signal input nullifierHash;
    signal input collateralCommitment;
    signal input loanCommitment;
    signal input collateralAmount;
    signal input loanAmount;
    signal input tenorSeconds;

    signal input secret;
    signal input nullifier;

    signal output valid;

    component tenorOk = TenorIsAllowed();
    tenorOk.tenorSeconds <== tenorSeconds;

    component nullifierHasher = Poseidon(2);
    nullifierHasher.inputs[0] <== secret;
    nullifierHasher.inputs[1] <== nullifier;
    nullifierHasher.out === nullifierHash;

    component collateralHasher = Poseidon(3);
    collateralHasher.inputs[0] <== secret;
    collateralHasher.inputs[1] <== collateralAmount;
    collateralHasher.inputs[2] <== nullifier;
    collateralHasher.out === collateralCommitment;

    // Loan commitment binds tenor (Poseidon4) — **different** from `lending.circom` v1 Poseidon3 loan hash.
    component loanHasher = Poseidon(4);
    loanHasher.inputs[0] <== secret;
    loanHasher.inputs[1] <== loanAmount;
    loanHasher.inputs[2] <== nullifier;
    loanHasher.inputs[3] <== tenorSeconds;
    loanHasher.out === loanCommitment;

    component loanPos = GreaterThan(252);
    loanPos.in[0] <== loanAmount;
    loanPos.in[1] <== 0;
    loanPos.out === 1;

    component colPos = GreaterThan(252);
    colPos.in[0] <== collateralAmount;
    colPos.in[1] <== 0;
    colPos.out === 1;

    component minLoanOk = GreaterThan(252);
    minLoanOk.in[0] <== loanAmount;
    minLoanOk.in[1] <== MIN_LOAN_WEI - 1;
    minLoanOk.out === 1;

    component ratio150 = LessEqThan(252);
    ratio150.in[0] <== loanAmount * 150;
    ratio150.in[1] <== collateralAmount * 100;
    ratio150.out === 1;

    component ratioBuf = LessEqThan(252);
    ratioBuf.in[0] <== loanAmount * 18000;
    ratioBuf.in[1] <== collateralAmount * 10000;
    ratioBuf.out === 1;

    valid <== 1;
}

component main {
    public [
        nullifierHash,
        collateralCommitment,
        loanCommitment,
        collateralAmount,
        loanAmount,
        tenorSeconds
    ]
} = LendingBorrowTenor();

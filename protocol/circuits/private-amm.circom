pragma circom 2.0.0;

include "../node_modules/circomlib/circuits/comparators.circom";
include "../node_modules/circomlib/circuits/bitify.circom";

/**
 * @title PrivateAMMStatement
 * @notice Groth16 public I/O aligned with `PrivateAMMContract` + `VerifierFactory` type `private-amm`.
 * @dev **What this proves (v2 statement):**
 *      - `op` is exactly one of {1,2,3,4} and matches the padding rules already enforced on-chain.
 *      - All public slots stay in a conservative bit window (BN254 field safety).
 *      - **Per-op policy** mirrors Solidity **layout / dust / boolean** checks:
 *          * createPool (1): nullifiers s1,s2 non-zero; initial amounts s5,s6 ≥ `MIN_DUST` (1000, same as `MIN_AMOUNT` / initial liq floor).
 *          * addLiquidity (2): s5,s6 ≥ `MIN_DUST`; minLiquidity s7 and deadline s8 non-zero.
 *          * swap (3): amountIn s3 ≥ `MIN_DUST`; minOut s4 ≥ 1; direction s5 ∈ {0,1}; deadline s6 ≥ 1.
 *          * removeLiquidity (4): burned liquidity s4 ≥ `MIN_DUST`.
 *
 *      **Engineering companion:** [`../../docs/liquidity/PUBLIC_VS_PRIVATE_AMM.md`](../../docs/liquidity/PUBLIC_VS_PRIVATE_AMM.md) (Phase C — product messaging vs proof scope).
 *
 *      **What this does *not* prove (yet):**
 *      - `CommitmentLib` uses **keccak256** commitments on-chain. Replicating keccak inside Circom
 *        for full “opening ⇒ commitment” soundness is intentionally out of scope here (constraint blowup).
 *        A future “v3” circuit could switch to Poseidon + on-chain hash alignment, or embed a keccak gadget.
 *
 *      snarkjs `publicSignals` order (Groth16): `[valid, op, s1, ..., s8]` (10 values).
 *      Solidity passes the same 10 values to `IVerifier.verifyProof` (see `Groth16Verifier`).
 *
 *      `op` values (must match `PrivateAMMContract` constants):
 *        1 = createPool       — s1..s6 = nullifierA, nullifierB, commitmentA, commitmentB, amountA, amountB; s7=s8=0
 *        2 = addLiquidity     — s1..s8 = two nullifiers, two commitments, amountA, amountB, minLiquidity, deadline
 *        3 = swap             — s1..s6 = inputNullifier, outputCommitment, amountIn, minAmountOut, isAToB, deadline; s7=s8=0
 *        4 = removeLiquidity  — s1..s6 = liquidityNullifier, outCommitA, outCommitB, liquidity, minA, minB; s7=s8=0
 */
template PrivateAMMStatement() {
    signal input op;
    signal input s1;
    signal input s2;
    signal input s3;
    signal input s4;
    signal input s5;
    signal input s6;
    signal input s7;
    signal input s8;

    signal output valid;

    // --- Match PrivateAMMContract: MIN_AMOUNT == MIN_LIQUIDITY == 1000 (dust / initial liq) ---
    var MIN_DUST = 1000;
    // Bit width for comparators (large enough for on-chain uint256 amounts used in practice)
    var BITS = 252;

    // --- op ∈ {1,2,3,4} (exactly one of op-k is zero) ---
    component iz1 = IsZero();
    component iz2 = IsZero();
    component iz3 = IsZero();
    component iz4 = IsZero();
    iz1.in <== op - 1;
    iz2.in <== op - 2;
    iz3.in <== op - 3;
    iz4.in <== op - 4;
    iz1.out + iz2.out + iz3.out + iz4.out === 1;

    // --- For op 1,3,4: force s7 = s8 = 0 (swap/create/remove padding) ---
    signal needPad;
    needPad <== iz1.out + iz3.out + iz4.out;
    needPad * s7 === 0;
    needPad * s8 === 0;

    // --- Bit-range: keeps public inputs inside a conservative window for BN254 scalars ---
    var RANGE_BITS = 248;
    component b1 = Num2Bits(RANGE_BITS);
    component b2 = Num2Bits(RANGE_BITS);
    component b3 = Num2Bits(RANGE_BITS);
    component b4 = Num2Bits(RANGE_BITS);
    component b5 = Num2Bits(RANGE_BITS);
    component b6 = Num2Bits(RANGE_BITS);
    component b7 = Num2Bits(RANGE_BITS);
    component b8 = Num2Bits(RANGE_BITS);
    b1.in <== s1;
    b2.in <== s2;
    b3.in <== s3;
    b4.in <== s4;
    b5.in <== s5;
    b6.in <== s6;
    b7.in <== s7;
    b8.in <== s8;

    component bOp = Num2Bits(8);
    bOp.in <== op;

    // =====================================================================
    // Per-op policy (multiplicative gating: izK.out is 1 only on that op)
    // =====================================================================

    // --- createPool: non-zero nullifiers; amounts ≥ MIN_DUST ---
    component nzCreateN1 = IsZero();
    component nzCreateN2 = IsZero();
    nzCreateN1.in <== s1;
    nzCreateN2.in <== s2;
    component geCreateA = GreaterEqThan(BITS);
    component geCreateB = GreaterEqThan(BITS);
    geCreateA.in[0] <== s5;
    geCreateA.in[1] <== MIN_DUST;
    geCreateB.in[0] <== s6;
    geCreateB.in[1] <== MIN_DUST;
    iz1.out * nzCreateN1.out === 0;
    iz1.out * nzCreateN2.out === 0;
    iz1.out * (geCreateA.out - 1) === 0;
    iz1.out * (geCreateB.out - 1) === 0;

    // --- addLiquidity: amounts ≥ MIN_DUST; minLiquidity + deadline non-zero ---
    component geAddA = GreaterEqThan(BITS);
    component geAddB = GreaterEqThan(BITS);
    geAddA.in[0] <== s5;
    geAddA.in[1] <== MIN_DUST;
    geAddB.in[0] <== s6;
    geAddB.in[1] <== MIN_DUST;
    component zAddMinLiq = IsZero();
    component zAddDeadline = IsZero();
    zAddMinLiq.in <== s7;
    zAddDeadline.in <== s8;
    iz2.out * (geAddA.out - 1) === 0;
    iz2.out * (geAddB.out - 1) === 0;
    iz2.out * zAddMinLiq.out === 0;
    iz2.out * zAddDeadline.out === 0;

    // --- swap: amountIn ≥ MIN_DUST; minOut ≥ 1; isAToB ∈ {0,1}; deadline ≥ 1 ---
    component geSwapIn = GreaterEqThan(BITS);
    geSwapIn.in[0] <== s3;
    geSwapIn.in[1] <== MIN_DUST;
    component geSwapMinOut = GreaterEqThan(BITS);
    geSwapMinOut.in[0] <== s4;
    geSwapMinOut.in[1] <== 1;
    component geSwapDeadline = GreaterEqThan(BITS);
    geSwapDeadline.in[0] <== s6;
    geSwapDeadline.in[1] <== 1;
    iz3.out * (geSwapIn.out - 1) === 0;
    iz3.out * (geSwapMinOut.out - 1) === 0;
    iz3.out * (geSwapDeadline.out - 1) === 0;
    signal swapDirGate;
    swapDirGate <== iz3.out * s5;
    swapDirGate * (s5 - 1) === 0;

    // --- removeLiquidity: liquidity (s4) ≥ MIN_DUST ---
    component geRemLiq = GreaterEqThan(BITS);
    geRemLiq.in[0] <== s4;
    geRemLiq.in[1] <== MIN_DUST;
    iz4.out * (geRemLiq.out - 1) === 0;

    valid <== 1;
}

component main { public [op, s1, s2, s3, s4, s5, s6, s7, s8] } = PrivateAMMStatement();

/**
 * Build `publicInputs` for `PrivateAMMContract` Groth16 layout:
 * `[valid, op, s1..s8]` (length 10). See `PrivateAMMContract.sol` NatSpec.
 */

function u(x) {
    if (typeof x === "bigint") return x;
    return BigInt(x);
}

function ammCreatePoolPublic(nullifierA, nullifierB, commitmentA, commitmentB, amountA, amountB) {
    return [1n, 1n, u(nullifierA), u(nullifierB), u(commitmentA), u(commitmentB), u(amountA), u(amountB), 0n, 0n];
}

function ammAddLiquidityPublic(nullifierA, nullifierB, commitmentA, commitmentB, amountA, amountB, minLiquidity, deadline) {
    return [1n, 2n, u(nullifierA), u(nullifierB), u(commitmentA), u(commitmentB), u(amountA), u(amountB), u(minLiquidity), u(deadline)];
}

function ammSwapPublic(inputNullifier, outputCommitment, amountIn, minAmountOut, isAToB, deadline) {
    const flag = isAToB === true || isAToB === 1n || isAToB === 1 ? 1n : 0n;
    return [1n, 3n, u(inputNullifier), u(outputCommitment), u(amountIn), u(minAmountOut), flag, u(deadline), 0n, 0n];
}

function ammRemoveLiquidityPublic(liquidityNullifier, outA, outB, liquidity, minA, minB) {
    return [1n, 4n, u(liquidityNullifier), u(outA), u(outB), u(liquidity), u(minA), u(minB), 0n, 0n];
}

module.exports = {
    ammCreatePoolPublic,
    ammAddLiquidityPublic,
    ammSwapPublic,
    ammRemoveLiquidityPublic,
};

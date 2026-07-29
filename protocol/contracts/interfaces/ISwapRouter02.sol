// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/**
 * @notice Minimal Uniswap v3 SwapRouter02 surface for single-hop settlement swaps.
 * @dev Canonical Sonic mainnet router: `0xaa52bB8110fE38D0d2d2AF0B85C3A3eE622CA455`.
 */
interface ISwapRouter02 {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    function exactInputSingle(ExactInputSingleParams calldata params) external payable returns (uint256 amountOut);
}

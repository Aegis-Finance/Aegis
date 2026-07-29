// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title Minimal surface of `PublicLiquidityPool` used by `AegisPublicPoolRouter`
interface IPublicLiquidityPoolMinimal {
    function agsToken() external view returns (address);
    function quoteToken() external view returns (address);
    function quoteIsNative() external view returns (bool);

    function quoteSwap(bool agsToQuote, uint256 amountIn) external view returns (uint256 amountOut);

    function swapExactInput(bool agsToQuote, uint256 amountIn, uint256 minOut, address recipient)
        external
        payable
        returns (uint256 amountOut);
}

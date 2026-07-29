// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.26;
pragma abicoder v2;

/// @notice Minimal NonfungiblePositionManager surface used by `AutomatedLiquidityDeployer`
///         (matches canonical Uniswap v3 NPM ABI; avoids importing full periphery OZ graph).
interface IUniswapV3NpmLike {
    struct MintParams {
        address token0;
        address token1;
        uint24 fee;
        int24 tickLower;
        int24 tickUpper;
        uint256 amount0Desired;
        uint256 amount1Desired;
        uint256 amount0Min;
        uint256 amount1Min;
        address recipient;
        uint256 deadline;
    }

    function mint(MintParams calldata params)
        external
        payable
        returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1);

    function createAndInitializePoolIfNecessary(
        address token0,
        address token1,
        uint24 fee,
        uint160 sqrtPriceX96
    ) external payable returns (address pool);
}

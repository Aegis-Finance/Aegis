// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/**
 * @title UniswapV3PriceLib
 * @notice Derives Uniswap v3 `sqrtPriceX96` from auction mean price (wei quote per 1e18 AGS wei).
 */
library UniswapV3PriceLib {
    /// @dev Uniswap v3 sqrt price bounds (TickMath).
    uint160 internal constant MIN_SQRT_RATIO = 4295128739;
    uint160 internal constant MAX_SQRT_RATIO = 1461446703485210103287273052203988822378723970342;

    error InvalidMeanPrice();
    error SqrtPriceOutOfBounds();

    /**
     * @param meanPriceWad Wei of quote token per 1e18 wei AGS (same units as `AutomatedDutchAuction.getMeanPrice()`).
     * @param token0 Lower-sorted pool token0 (`token0 < token1`).
     * @param ags AGS token address.
     * @param quote Quote token address (wrapped native / wS).
     */
    function sqrtPriceX96FromMeanPrice(
        uint256 meanPriceWad,
        address token0,
        address ags,
        address quote
    ) internal pure returns (uint160 sqrtPriceX96) {
        if (meanPriceWad == 0) revert InvalidMeanPrice();

        uint256 priceX192;
        if (token0 == ags) {
            // token1/token0 = meanPriceWad / 1e18
            priceX192 = (meanPriceWad << 192) / 1e18;
        } else if (token0 == quote) {
            // token1/token0 = 1e18 / meanPriceWad  (AGS wei per quote wei)
            priceX192 = (1e18 << 192) / meanPriceWad;
        } else {
            revert InvalidMeanPrice();
        }

        uint256 sqrtX96 = _sqrt(priceX192);
        if (sqrtX96 < MIN_SQRT_RATIO || sqrtX96 >= MAX_SQRT_RATIO) {
            revert SqrtPriceOutOfBounds();
        }
        return uint160(sqrtX96);
    }

    /// @dev Babylonian integer square root.
    function _sqrt(uint256 x) private pure returns (uint256 z) {
        if (x == 0) return 0;
        uint256 xx = x;
        z = (xx + 1) / 2;
        uint256 y = xx;
        while (z < y) {
            y = z;
            z = (xx / z + z) / 2;
        }
    }
}

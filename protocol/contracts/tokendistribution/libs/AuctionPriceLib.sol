// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/**
 * @title AuctionPriceLib
 * @notice Linear Dutch auction spot price (WAD-priced tokens) and helpers used by ZK distribution sales.
 * @dev Revert strings are stable — Hardhat tests assert exact text.
 */
library AuctionPriceLib {
    uint256 internal constant WAD = 1e18;

    /// @notice Linear interpolation from `startPrice` at `startTime` down to `reserve` at `endTime`.
    /// @param saleCompleted If true, returns `reserve` immediately (sale settled off-schedule).
    function linearDutchPrice(
        uint256 startPrice,
        uint256 reserve,
        uint256 startTime,
        uint256 endTime,
        uint256 nowTs,
        bool saleCompleted
    ) internal pure returns (uint256) {
        if (startPrice <= reserve) revert("AuctionPriceLib: invalid price range");
        if (saleCompleted) {
            return reserve;
        }
        if (nowTs >= endTime) {
            return reserve;
        }
        if (nowTs <= startTime) {
            return startPrice;
        }
        uint256 duration = endTime - startTime;
        uint256 elapsed = nowTs - startTime;
        uint256 drop = ((startPrice - reserve) * elapsed) / duration;
        return startPrice - drop;
    }

    /// @notice Per-second decay `(startPrice - reserve) / duration` scaled by WAD (no rounding guard on tiny spreads).
    function decayRatePerSecondWad(uint256 startPrice, uint256 reserve, uint256 startTime, uint256 endTime)
        internal
        pure
        returns (uint256)
    {
        if (startPrice <= reserve) revert("AuctionPriceLib: invalid price range");
        if (endTime <= startTime) revert("AuctionPriceLib: zero duration");
        return ((startPrice - reserve) * WAD) / (endTime - startTime);
    }

    /// @notice Token amount received for `ethAmount` wei paid at `pricePerToken` (wei per 1e18 tokens).
    function tokensForEthAtPrice(uint256 ethAmount, uint256 pricePerToken) internal pure returns (uint256) {
        if (pricePerToken == 0) revert("AuctionPriceLib: zero price");
        return (ethAmount * WAD) / pricePerToken;
    }
}

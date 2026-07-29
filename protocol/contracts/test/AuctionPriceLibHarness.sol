// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {AuctionPriceLib} from "../tokendistribution/libs/AuctionPriceLib.sol";

/// @notice Thin wrapper so Hardhat exercises `AuctionPriceLib` opcodes.
contract AuctionPriceLibHarness {
    function linearDutchPrice(
        uint256 startPrice,
        uint256 reserve,
        uint256 startTime,
        uint256 endTime,
        uint256 nowTs,
        bool saleCompleted
    ) external pure returns (uint256) {
        return AuctionPriceLib.linearDutchPrice(startPrice, reserve, startTime, endTime, nowTs, saleCompleted);
    }

    function decayRatePerSecondWad(uint256 startPrice, uint256 reserve, uint256 startTime, uint256 endTime)
        external
        pure
        returns (uint256)
    {
        return AuctionPriceLib.decayRatePerSecondWad(startPrice, reserve, startTime, endTime);
    }

    function tokensForEthAtPrice(uint256 ethAmount, uint256 pricePerToken) external pure returns (uint256) {
        return AuctionPriceLib.tokensForEthAtPrice(ethAmount, pricePerToken);
    }
}

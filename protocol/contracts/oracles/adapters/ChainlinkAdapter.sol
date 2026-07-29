// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {AggregatorV3Interface} from "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import "../interfaces/IOracleAdapter.sol";
import "../../interfaces/ICommonErrors.sol";

/**
 * @title ChainlinkAdapter
 * @notice Adapter for Chainlink Data Feeds on Sonic
 * @dev Wraps Chainlink AggregatorV3Interface to conform to IOracleAdapter
 * @author Sentinel CTO
 * @custom:security-contact security@aegisprotocol.com
 */
contract ChainlinkAdapter is IOracleAdapter, ICommonErrors {
    /// @notice Chainlink price feed aggregator
    AggregatorV3Interface public immutable aggregator;

    /// @notice Maximum allowed price staleness (1 hour) - same as PoolPriceValidator
    uint256 public constant MAX_STALENESS = 3600;

    /**
     * @notice Constructor
     * @param _aggregator Address of Chainlink AggregatorV3Interface contract
     */
    constructor(address _aggregator) {
        if (_aggregator == address(0)) revert InvalidOracleAddress();
        aggregator = AggregatorV3Interface(_aggregator);
    }

    /**
     * @notice Get the latest price from Chainlink
     * @return price Price in 18 decimals (converted from 8 decimals)
     * @return timestamp Timestamp of last update
     * @return roundId Current round ID
     * @return isValid Whether price is valid and fresh
     */
    function getLatestPrice()
        external
        view
        override
        returns (
            uint256 price,
            uint256 timestamp,
            uint256 roundId,
            bool isValid
        )
    {
        try aggregator.latestRoundData() returns (
            uint80 _roundId,
            int256 answer,
            uint256 /* startedAt */,
            uint256 updatedAt,
            uint80 answeredInRound
        ) {
            // Validate price
            if (answer <= 0) {
                return (0, 0, 0, false);
            }

            // Check staleness (same security as PoolPriceValidator); reject future updatedAt (no underflow)
            if (updatedAt > block.timestamp || block.timestamp - updatedAt > MAX_STALENESS) {
                return (0, updatedAt, uint256(_roundId), false);
            }

            // Check round completeness
            if (_roundId != answeredInRound) {
                return (0, updatedAt, uint256(_roundId), false);
            }

            // Convert from 8 decimals to 18 decimals (Chainlink standard)
            price = uint256(answer) * 1e10;
            timestamp = updatedAt;
            roundId = uint256(_roundId);
            isValid = true;
        } catch {
            return (0, 0, 0, false);
        }
    }

    /**
     * @notice Get Chainlink description
     * @return The description string
     */
    function description() external view override returns (string memory) {
        try aggregator.description() returns (string memory desc) {
            return desc;
        } catch {
            return "Chainlink Price Feed";
        }
    }

    /**
     * @notice Get Chainlink decimals (typically 8)
     * @return The number of decimals
     */
    function decimals() external view override returns (uint8) {
        try aggregator.decimals() returns (uint8 dec) {
            return dec;
        } catch {
            return 8; // Chainlink default
        }
    }

    /**
     * @notice Check if Chainlink oracle is available
     * @return Whether the oracle is responding
     */
    function isAvailable() external view override returns (bool) {
        try aggregator.latestRoundData() returns (
            uint80,
            int256 answer,
            uint256,
            uint256 updatedAt,
            uint80
        ) {
            return answer > 0 && updatedAt <= block.timestamp && block.timestamp - updatedAt <= MAX_STALENESS;
        } catch {
            return false;
        }
    }
}


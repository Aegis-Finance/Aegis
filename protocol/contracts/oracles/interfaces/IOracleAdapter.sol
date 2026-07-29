// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/**
 * @title IOracleAdapter
 * @notice Unified interface for all oracle providers on Sonic
 * @dev All oracle adapters must implement this interface for consistent integration
 * @author Sentinel CTO
 * @custom:security-contact security@aegisprotocol.com
 * 
 * Oracle providers supported on Sonic (per https://docs.soniclabs.com):
 * - Chainlink (Data Feeds)
 * - Pyth Network (Price Feed)
 * - API3
 * - Band Protocol
 * - RedStone
 * - Supra
 * - Stork Network
 */
interface IOracleAdapter {
    /**
     * @notice Get the latest price from the oracle
     * @return price The price in 18 decimals
     * @return timestamp The timestamp when the price was last updated
     * @return roundId The round ID (if applicable, 0 otherwise)
     * @return isValid Whether the price is valid and fresh
     */
    function getLatestPrice()
        external
        view
        returns (
            uint256 price,
            uint256 timestamp,
            uint256 roundId,
            bool isValid
        );

    /**
     * @notice Get the oracle description/name
     * @return The description string
     */
    function description() external view returns (string memory);

    /**
     * @notice Get the number of decimals for the price
     * @return The number of decimals (typically 8 for Chainlink, 18 for others)
     */
    function decimals() external view returns (uint8);

    /**
     * @notice Check if the oracle is available and responding
     * @return Whether the oracle is available
     */
    function isAvailable() external view returns (bool);
}


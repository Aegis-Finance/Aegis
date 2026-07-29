// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "../oracles/MultiOracleAggregator.sol";

/**
 * @title MultiOracleAggregatorHarness
 * @notice Harness for Certora formal verification
 * @dev Exposes state getters for CVL2 compatibility
 * @author Sentinel Security Team
 */
contract MultiOracleAggregatorHarness is MultiOracleAggregator {
    /**
     * @notice Constructor for harness contract
     */
    constructor(address admin) MultiOracleAggregator(admin) {}

    /**
     * @notice Get oracle config for asset (harness wrapper)
     */
    function getOracleConfigHarness(bytes32 asset) external view returns (
        address[] memory adapters,
        uint256 count,
        uint256 requiredConfirmations,
        bool enabled
    ) {
        OracleConfig memory config = oracleConfigs[asset];
        return (config.adapters, config.count, config.requiredConfirmations, config.enabled);
    }

    /**
     * @notice Get price data for asset (harness wrapper)
     */
    function getPriceDataHarness(bytes32 asset) external view returns (
        uint256 medianPrice,
        uint256 timestamp,
        uint256 validOracles,
        bool isValid
    ) {
        PriceData memory data = priceData[asset];
        return (data.medianPrice, data.timestamp, data.validOracles, data.isValid);
    }

    /**
     * @notice Get adapter at index for asset
     */
    function getAdapterAt(bytes32 asset, uint256 index) external view returns (address) {
        return oracleConfigs[asset].adapters[index];
    }

    /**
     * @notice Get adapter count for asset
     */
    function getAdapterCount(bytes32 asset) external view returns (uint256) {
        return oracleConfigs[asset].adapters.length;
    }
}


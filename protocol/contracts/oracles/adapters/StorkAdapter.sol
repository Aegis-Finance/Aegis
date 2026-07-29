// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "../interfaces/IOracleAdapter.sol";
import "../../interfaces/ICommonErrors.sol";

/**
 * @title StorkAdapter
 * @notice Adapter for Stork Network Oracle on Sonic
 * @dev Implements IOracleAdapter for Stork Network integration
 * @author Sentinel CTO
 * @custom:security-contact security@aegisprotocol.com
 * 
 * Note: Stork Network uses a different interface structure. This adapter wraps it.
 * Stork Network is available on Sonic per https://docs.soniclabs.com
 */
interface IStork {
    function getPrice(bytes32 feedId) external view returns (uint256 price, uint256 timestamp);
}

contract StorkAdapter is IOracleAdapter, ICommonErrors {
    /// @notice Stork Network oracle contract
    IStork public immutable stork;
    
    /// @notice Feed ID for the asset
    bytes32 public immutable feedId;
    
    /// @notice Maximum allowed price staleness (1 hour) - same security as Chainlink
    uint256 public constant MAX_STALENESS = 3600;

    /**
     * @notice Constructor
     * @param _stork Address of Stork Network oracle contract
     * @param _feedId Feed ID for the asset
     */
    constructor(address _stork, bytes32 _feedId) {
        if (_stork == address(0)) revert InvalidOracleAddress();
        if (_feedId == bytes32(0)) revert InvalidOracleAddress();
        stork = IStork(_stork);
        feedId = _feedId;
    }

    /**
     * @notice Get the latest price from Stork Network
     * @return price Price in 18 decimals
     * @return timestamp Timestamp of last update
     * @return roundId Always 0 for Stork (not applicable)
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
        try stork.getPrice(feedId) returns (uint256 p, uint256 ts) {
            // Validate price
            if (p == 0) {
                return (0, 0, 0, false);
            }

            // Check staleness; reject future ts (no underflow)
            if (ts > block.timestamp || block.timestamp - ts > MAX_STALENESS) {
                return (0, ts, 0, false);
            }

            price = p;
            timestamp = ts;
            roundId = 0; // Stork doesn't use round IDs
            isValid = true;
        } catch {
            return (0, 0, 0, false);
        }
    }

    /**
     * @notice Get Stork Network description
     * @return The description string
     */
    function description() external pure override returns (string memory) {
        return "Stork Network Oracle";
    }

    /**
     * @notice Get Stork Network decimals (typically 18)
     * @return The number of decimals (18)
     */
    function decimals() external pure override returns (uint8) {
        return 18;
    }

    /**
     * @notice Check if Stork Network oracle is available
     * @return Whether the oracle is responding
     */
    function isAvailable() external view override returns (bool) {
        try stork.getPrice(feedId) returns (uint256 price, uint256 timestamp) {
            return price > 0 && timestamp <= block.timestamp && block.timestamp - timestamp <= MAX_STALENESS;
        } catch {
            return false;
        }
    }
}


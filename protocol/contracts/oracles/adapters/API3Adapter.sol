// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "../interfaces/IOracleAdapter.sol";
import "../../interfaces/ICommonErrors.sol";

/**
 * @title API3Adapter
 * @notice Adapter for API3 dAPIs on Sonic
 * @dev Implements IOracleAdapter for API3 integration
 * @author Sentinel CTO
 * @custom:security-contact security@aegisprotocol.com
 * 
 * Note: API3 uses Airnode protocol. This adapter wraps their interface.
 * API3 dAPIs are available on Sonic per https://docs.soniclabs.com
 */
interface IAPI3 {
    function read() external view returns (int224 value, uint256 timestamp);
}

contract API3Adapter is IOracleAdapter, ICommonErrors {
    /// @notice API3 dAPI contract
    IAPI3 public immutable api3;
    
    /// @notice Maximum allowed price staleness (1 hour) - same security as Chainlink
    uint256 public constant MAX_STALENESS = 3600;

    /**
     * @notice Constructor
     * @param _api3 Address of API3 dAPI contract
     */
    constructor(address _api3) {
        if (_api3 == address(0)) revert InvalidOracleAddress();
        api3 = IAPI3(_api3);
    }

    /**
     * @notice Get the latest price from API3
     * @return price Price in 18 decimals
     * @return timestamp Timestamp of last update
     * @return roundId Always 0 for API3 (not applicable)
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
        try api3.read() returns (int224 value, uint256 ts) {
            // Validate price
            if (value <= 0) {
                return (0, 0, 0, false);
            }

            // Check staleness; reject future ts (no underflow on block.timestamp - ts)
            if (ts > block.timestamp || block.timestamp - ts > MAX_STALENESS) {
                return (0, ts, 0, false);
            }

            // API3 typically returns in 18 decimals, but verify
            price = uint256(uint224(value));
            timestamp = ts;
            roundId = 0; // API3 doesn't use round IDs
            isValid = true;
        } catch {
            return (0, 0, 0, false);
        }
    }

    /**
     * @notice Get API3 description
     * @return The description string
     */
    function description() external pure override returns (string memory) {
        return "API3 dAPI";
    }

    /**
     * @notice Get API3 decimals (typically 18)
     * @return The number of decimals (18)
     */
    function decimals() external pure override returns (uint8) {
        return 18;
    }

    /**
     * @notice Check if API3 oracle is available
     * @return Whether the oracle is responding
     */
    function isAvailable() external view override returns (bool) {
        try api3.read() returns (int224 value, uint256 timestamp) {
            return value > 0 && timestamp <= block.timestamp && block.timestamp - timestamp <= MAX_STALENESS;
        } catch {
            return false;
        }
    }
}


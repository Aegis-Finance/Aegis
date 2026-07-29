// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "../interfaces/IOracleAdapter.sol";
import "../../interfaces/ICommonErrors.sol";

/**
 * @title SupraAdapter
 * @notice Adapter for Supra Oracle on Sonic
 * @dev Implements IOracleAdapter for Supra integration
 * @author Sentinel CTO
 * @custom:security-contact security@aegisprotocol.com
 * 
 * Note: Supra uses a different interface structure. This adapter wraps it.
 * Supra is available on Sonic per https://docs.soniclabs.com
 */
interface ISupra {
    function getPrice(uint256 pairIndex) external view returns (uint256 price, uint256 timestamp);
}

contract SupraAdapter is IOracleAdapter, ICommonErrors {
    /// @notice Supra oracle contract
    ISupra public immutable supra;
    
    /// @notice Pair index for the asset
    uint256 public immutable pairIndex;
    
    /// @notice Maximum allowed price staleness (1 hour) - same security as Chainlink
    uint256 public constant MAX_STALENESS = 3600;

    /**
     * @notice Constructor
     * @param _supra Address of Supra oracle contract
     * @param _pairIndex Pair index for the asset
     */
    constructor(address _supra, uint256 _pairIndex) {
        if (_supra == address(0)) revert InvalidOracleAddress();
        supra = ISupra(_supra);
        pairIndex = _pairIndex;
    }

    /**
     * @notice Get the latest price from Supra
     * @return price Price in 18 decimals
     * @return timestamp Timestamp of last update
     * @return roundId Always 0 for Supra (not applicable)
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
        try supra.getPrice(pairIndex) returns (uint256 p, uint256 ts) {
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
            roundId = 0; // Supra doesn't use round IDs
            isValid = true;
        } catch {
            return (0, 0, 0, false);
        }
    }

    /**
     * @notice Get Supra description
     * @return The description string
     */
    function description() external pure override returns (string memory) {
        return "Supra Oracle";
    }

    /**
     * @notice Get Supra decimals (typically 18)
     * @return The number of decimals (18)
     */
    function decimals() external pure override returns (uint8) {
        return 18;
    }

    /**
     * @notice Check if Supra oracle is available
     * @return Whether the oracle is responding
     */
    function isAvailable() external view override returns (bool) {
        try supra.getPrice(pairIndex) returns (uint256 price, uint256 timestamp) {
            return price > 0 && timestamp <= block.timestamp && block.timestamp - timestamp <= MAX_STALENESS;
        } catch {
            return false;
        }
    }
}


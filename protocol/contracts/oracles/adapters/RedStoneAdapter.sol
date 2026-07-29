// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "../interfaces/IOracleAdapter.sol";
import "../../interfaces/ICommonErrors.sol";

/**
 * @title RedStoneAdapter
 * @notice Adapter for RedStone Oracle on Sonic
 * @dev Implements IOracleAdapter for RedStone integration
 * @author Sentinel CTO
 * @custom:security-contact security@aegisprotocol.com
 * 
 * Note: RedStone uses a different interface structure. This adapter wraps it.
 * RedStone is available on Sonic per https://docs.soniclabs.com
 */
interface IRedStone {
    function getPrice(bytes32 dataFeedId) external view returns (uint256);
    function getPriceTimestamp(bytes32 dataFeedId) external view returns (uint256);
}

contract RedStoneAdapter is IOracleAdapter, ICommonErrors {
    /// @notice RedStone oracle contract
    IRedStone public immutable redStone;
    
    /// @notice Data feed ID for the asset
    bytes32 public immutable dataFeedId;
    
    /// @notice Maximum allowed price staleness (1 hour) - same security as Chainlink
    uint256 public constant MAX_STALENESS = 3600;

    /**
     * @notice Constructor
     * @param _redStone Address of RedStone oracle contract
     * @param _dataFeedId Data feed ID for the asset
     */
    constructor(address _redStone, bytes32 _dataFeedId) {
        if (_redStone == address(0)) revert InvalidOracleAddress();
        if (_dataFeedId == bytes32(0)) revert InvalidOracleAddress();
        redStone = IRedStone(_redStone);
        dataFeedId = _dataFeedId;
    }

    /**
     * @notice Get the latest price from RedStone
     * @return price Price in 18 decimals
     * @return timestamp Timestamp of last update
     * @return roundId Always 0 for RedStone (not applicable)
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
        try redStone.getPrice(dataFeedId) returns (uint256 p) {
            if (p == 0) {
                return (0, 0, 0, false);
            }

            try redStone.getPriceTimestamp(dataFeedId) returns (uint256 ts) {
                // Check staleness; reject future ts (no underflow)
                if (ts > block.timestamp || block.timestamp - ts > MAX_STALENESS) {
                    return (0, ts, 0, false);
                }

                price = p;
                timestamp = ts;
                roundId = 0; // RedStone doesn't use round IDs
                isValid = true;
            } catch {
                return (0, 0, 0, false);
            }
        } catch {
            return (0, 0, 0, false);
        }
    }

    /**
     * @notice Get RedStone description
     * @return The description string
     */
    function description() external pure override returns (string memory) {
        return "RedStone Oracle";
    }

    /**
     * @notice Get RedStone decimals (typically 18)
     * @return The number of decimals (18)
     */
    function decimals() external pure override returns (uint8) {
        return 18;
    }

    /**
     * @notice Check if RedStone oracle is available
     * @return Whether the oracle is responding
     */
    function isAvailable() external view override returns (bool) {
        try redStone.getPrice(dataFeedId) returns (uint256 p) {
            if (p == 0) return false;
            try redStone.getPriceTimestamp(dataFeedId) returns (uint256 ts) {
                return ts <= block.timestamp && block.timestamp - ts <= MAX_STALENESS;
            } catch {
                return false;
            }
        } catch {
            return false;
        }
    }
}


// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "../interfaces/IOracleAdapter.sol";
import "../../interfaces/ICommonErrors.sol";

/**
 * @title BandProtocolAdapter
 * @notice Adapter for Band Protocol Standard Dataset on Sonic
 * @dev Implements IOracleAdapter for Band Protocol integration
 * @author Sentinel CTO
 * @custom:security-contact security@aegisprotocol.com
 * 
 * Note: Band Protocol uses a different interface. This adapter wraps it.
 * Band Protocol is available on Sonic per https://docs.soniclabs.com
 */
interface IBandProtocol {
    struct PriceData {
        uint256 rate; // The price rate
        uint256 lastUpdatedBase; // Unix timestamp of last base update
        uint256 lastUpdatedQuote; // Unix timestamp of last quote update
    }

    function getPriceData(
        string calldata base,
        string calldata quote
    ) external view returns (PriceData memory);
}

contract BandProtocolAdapter is IOracleAdapter, ICommonErrors {
    /// @notice Band Protocol oracle contract
    IBandProtocol public immutable bandOracle;
    
    /// @notice Base currency symbol (e.g., "AGS")
    string public baseSymbol;
    
    /// @notice Quote currency symbol (e.g., "USD")
    string public quoteSymbol;
    
    /// @notice Maximum allowed price staleness (1 hour) - same security as Chainlink
    uint256 public constant MAX_STALENESS = 3600;

    /**
     * @notice Constructor
     * @param _bandOracle Address of Band Protocol oracle contract
     * @param _baseSymbol Base currency symbol
     * @param _quoteSymbol Quote currency symbol
     */
    constructor(
        address _bandOracle,
        string memory _baseSymbol,
        string memory _quoteSymbol
    ) {
        if (_bandOracle == address(0)) revert InvalidOracleAddress();
        bandOracle = IBandProtocol(_bandOracle);
        baseSymbol = _baseSymbol;
        quoteSymbol = _quoteSymbol;
    }

    /**
     * @notice Get the latest price from Band Protocol
     * @return price Price in 18 decimals
     * @return timestamp Timestamp of last update
     * @return roundId Always 0 for Band Protocol (not applicable)
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
        try bandOracle.getPriceData(baseSymbol, quoteSymbol) returns (
            IBandProtocol.PriceData memory data
        ) {
            // Validate price
            if (data.rate == 0) {
                return (0, 0, 0, false);
            }

            // Use the most recent timestamp
            timestamp = data.lastUpdatedBase > data.lastUpdatedQuote
                ? data.lastUpdatedBase
                : data.lastUpdatedQuote;

            // Check staleness; reject future timestamp (no underflow)
            if (timestamp > block.timestamp || block.timestamp - timestamp > MAX_STALENESS) {
                return (0, timestamp, 0, false);
            }

            // Band Protocol typically returns in 18 decimals
            price = data.rate;
            roundId = 0; // Band Protocol doesn't use round IDs
            isValid = true;
        } catch {
            return (0, 0, 0, false);
        }
    }

    /**
     * @notice Get Band Protocol description
     * @return The description string
     */
    function description() external view override returns (string memory) {
        return string(abi.encodePacked("Band Protocol: ", baseSymbol, "/", quoteSymbol));
    }

    /**
     * @notice Get Band Protocol decimals (typically 18)
     * @return The number of decimals (18)
     */
    function decimals() external pure override returns (uint8) {
        return 18;
    }

    /**
     * @notice Check if Band Protocol oracle is available
     * @return Whether the oracle is responding
     */
    function isAvailable() external view override returns (bool) {
        try bandOracle.getPriceData(baseSymbol, quoteSymbol) returns (
            IBandProtocol.PriceData memory data
        ) {
            uint256 timestamp = data.lastUpdatedBase > data.lastUpdatedQuote
                ? data.lastUpdatedBase
                : data.lastUpdatedQuote;
            return data.rate > 0 && timestamp <= block.timestamp && block.timestamp - timestamp <= MAX_STALENESS;
        } catch {
            return false;
        }
    }
}


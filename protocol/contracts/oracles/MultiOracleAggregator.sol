// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./interfaces/IOracleAdapter.sol";
import "../interfaces/ICommonErrors.sol";

/**
 * @title MultiOracleAggregator
 * @notice Enterprise-grade multi-oracle aggregator with same security as Chainlink implementation
 * @dev Aggregates prices from multiple oracle providers (Chainlink, Pyth, API3, Band, RedStone, Supra, Stork)
 *      Maintains identical security standards: staleness checks, deviation limits, median calculation
 * @author Sentinel CTO
 * @custom:security-contact security@aegisprotocol.com
 * 
 * Security Features (matching PoolPriceValidator):
 * - Maximum price staleness: 1 hour
 * - Maximum deviation between oracles: 5% (500 basis points)
 * - Minimum oracle confirmations: 2
 * - Median price calculation (reduces single-oracle risk)
 * - Governance-controlled oracle management
 * 
 * Oracle Providers Supported (per https://docs.soniclabs.com):
 * - Chainlink (Data Feeds)
 * - Pyth Network (Price Feed)
 * - API3
 * - Band Protocol
 * - RedStone
 * - Supra
 * - Stork Network
 */
contract MultiOracleAggregator is AccessControl, ReentrancyGuard, ICommonErrors {
    bytes32 public constant GOVERNANCE_ROLE = keccak256("GOVERNANCE_ROLE");

    /// @notice Maximum allowed price deviation between oracles (5% = 500 basis points) - same as PoolPriceValidator
    uint256 public constant MAX_DEVIATION_BPS = 500;

    /// @notice Maximum allowed price staleness (1 hour) - same as PoolPriceValidator
    uint256 public constant MAX_PRICE_STALENESS = 3600;

    /// @notice Minimum required oracle confirmations (2) - same as PrivateDerivatives
    uint256 public constant MIN_ORACLE_CONFIRMATIONS = 2;

    /// @notice Oracle configuration for an asset
    struct OracleConfig {
        address[] adapters; // Array of oracle adapter addresses
        uint256 count; // Number of oracles
        uint256 requiredConfirmations; // Required oracle confirmations
        bool enabled; // Whether this asset's oracle aggregation is enabled
    }

    /// @notice Mapping of asset identifier to oracle configuration
    mapping(bytes32 => OracleConfig) public oracleConfigs;

    /// @notice Mapping of asset identifier to last aggregated price data
    mapping(bytes32 => PriceData) public priceData;

    /// @notice Price data structure
    struct PriceData {
        uint256 medianPrice; // Median price from all oracles
        uint256 timestamp; // Timestamp of last update
        uint256 validOracles; // Number of valid oracle responses
        bool isValid; // Whether price is valid
    }

    /// @notice Events
    event OracleAdded(bytes32 indexed asset, address indexed adapter);
    event OracleRemoved(bytes32 indexed asset, address indexed adapter);
    event PriceUpdated(bytes32 indexed asset, uint256 medianPrice, uint256 validOracles, uint256 timestamp);
    event ConfigUpdated(bytes32 indexed asset, uint256 requiredConfirmations, bool enabled);

    error InvalidAdapter();
    error OracleNotConfigured();

    /**
     * @notice Constructor
     * @param admin Address to receive DEFAULT_ADMIN_ROLE and GOVERNANCE_ROLE
     */
    constructor(address admin) {
        require(admin != address(0), "Admin zero");
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(GOVERNANCE_ROLE, admin);
    }

    /**
     * @notice Add an oracle adapter for an asset
     * @param asset Asset identifier
     * @param adapter Address of oracle adapter (must implement IOracleAdapter)
     */
    function addOracle(bytes32 asset, address adapter) external onlyRole(GOVERNANCE_ROLE) {
        if (adapter == address(0)) revert InvalidOracleAddress();
        
        // Verify adapter implements IOracleAdapter
        try IOracleAdapter(adapter).isAvailable() returns (bool) {
            // Adapter is valid
        } catch {
            revert InvalidAdapter();
        }

        OracleConfig storage config = oracleConfigs[asset];
        
        // Check for duplicates
        for (uint256 i = 0; i < config.adapters.length; i++) {
            if (config.adapters[i] == adapter) {
                revert InvalidAdapter(); // Already exists
            }
        }

        config.adapters.push(adapter);
        config.count++;
        
        // Set default required confirmations if first oracle
        if (config.requiredConfirmations == 0) {
            config.requiredConfirmations = MIN_ORACLE_CONFIRMATIONS;
        }
        
        // Enable by default
        if (!config.enabled) {
            config.enabled = true;
        }

        emit OracleAdded(asset, adapter);
    }

    /**
     * @notice Remove an oracle adapter for an asset
     * @param asset Asset identifier
     * @param adapter Address of oracle adapter to remove
     */
    function removeOracle(bytes32 asset, address adapter) external onlyRole(GOVERNANCE_ROLE) {
        OracleConfig storage config = oracleConfigs[asset];
        
        uint256 index = type(uint256).max;
        for (uint256 i = 0; i < config.adapters.length; i++) {
            if (config.adapters[i] == adapter) {
                index = i;
                break;
            }
        }
        
        if (index == type(uint256).max) revert InvalidAdapter();
        
        // Remove by swapping with last element
        config.adapters[index] = config.adapters[config.adapters.length - 1];
        config.adapters.pop();
        config.count--;

        emit OracleRemoved(asset, adapter);
    }

    /**
     * @notice Set required confirmations for an asset
     * @param asset Asset identifier
     * @param confirmations Number of required confirmations
     */
    function setRequiredConfirmations(bytes32 asset, uint256 confirmations) external onlyRole(GOVERNANCE_ROLE) {
        OracleConfig storage config = oracleConfigs[asset];
        if (confirmations == 0 || confirmations > config.count) revert InsufficientOracleConfirmations();
        config.requiredConfirmations = confirmations;
        emit ConfigUpdated(asset, confirmations, config.enabled);
    }

    /**
     * @notice Enable/disable oracle aggregation for an asset
     * @param asset Asset identifier
     * @param enabled Whether to enable aggregation
     */
    function setEnabled(bytes32 asset, bool enabled) external onlyRole(GOVERNANCE_ROLE) {
        oracleConfigs[asset].enabled = enabled;
        emit ConfigUpdated(asset, oracleConfigs[asset].requiredConfirmations, enabled);
    }

    /**
     * @notice Get aggregated price from all configured oracles
     * @param asset Asset identifier
     * @return medianPrice Median price from valid oracles (18 decimals)
     * @return timestamp Timestamp of price update
     * @return validOracles Number of valid oracle responses
     * @return isValid Whether price is valid
     */
    function getPrice(bytes32 asset)
        external
        view
        returns (
            uint256 medianPrice,
            uint256 timestamp,
            uint256 validOracles,
            bool isValid
        )
    {
        PriceData memory data = priceData[asset];
        return (data.medianPrice, data.timestamp, data.validOracles, data.isValid);
    }

    /**
     * @notice Update price from all configured oracles (can be called by anyone)
     * @param asset Asset identifier
     * @return medianPrice Median price from valid oracles
     * @return timestamp Timestamp of price update
     * @return validOracles Number of valid oracle responses
     * @return isValid Whether price is valid
     */
    function updatePrice(bytes32 asset)
        external
        nonReentrant
        returns (
            uint256 medianPrice,
            uint256 timestamp,
            uint256 validOracles,
            bool isValid
        )
    {
        OracleConfig memory config = oracleConfigs[asset];
        if (!config.enabled || config.adapters.length == 0) {
            revert OracleNotConfigured();
        }

        // Fetch prices from all oracles
        (uint256[] memory prices, uint256 validCount) = _fetchOraclePrices(config.adapters);

        // Check if we have enough valid prices
        if (validCount < config.requiredConfirmations) {
            revert InsufficientOracleConfirmations();
        }

        // Calculate median price
        medianPrice = _calculateMedianPrice(prices, validCount);

        // Validate price deviation (same security as PoolPriceValidator)
        if (!_validatePriceDeviation(prices, validCount, medianPrice)) {
            revert PriceDeviationTooHigh();
        }

        timestamp = block.timestamp;
        validOracles = validCount;
        isValid = true;

        // Store price data
        priceData[asset] = PriceData({
            medianPrice: medianPrice,
            timestamp: timestamp,
            validOracles: validOracles,
            isValid: isValid
        });

        emit PriceUpdated(asset, medianPrice, validOracles, timestamp);

        return (medianPrice, timestamp, validOracles, isValid);
    }

    /**
     * @notice Fetch prices from multiple oracle adapters
     * @param adapters Array of oracle adapter addresses
     * @return prices Array of valid prices
     * @return validCount Number of valid prices collected
     */
    function _fetchOraclePrices(
        address[] memory adapters
    ) internal view returns (uint256[] memory prices, uint256 validCount) {
        prices = new uint256[](adapters.length);
        validCount = 0;

        for (uint256 i = 0; i < adapters.length; i++) {
            try IOracleAdapter(adapters[i]).getLatestPrice() returns (
                uint256 price,
                uint256 ts,
                uint256,
                bool isVal
            ) {
                // Validate price and staleness (same security as Chainlink implementation)
                if (!isVal || price == 0) continue;
                // Reject future timestamps (malicious/broken adapters) without underflow on `block.timestamp - ts`
                if (ts > block.timestamp || block.timestamp - ts > MAX_PRICE_STALENESS) continue;

                prices[validCount] = price;
                validCount++;
            } catch {
                // Oracle call failed, skip
                continue;
            }
        }
    }

    /**
     * @notice Calculate median price from array of prices
     * @param prices Array of prices
     * @param length Number of valid prices
     * @return Median price
     */
    function _calculateMedianPrice(uint256[] memory prices, uint256 length) internal pure returns (uint256) {
        if (length == 0) return 0;
        if (length == 1) return prices[0];

        // Sort prices (simple bubble sort for small arrays)
        for (uint256 i = 0; i < length - 1; i++) {
            for (uint256 j = 0; j < length - i - 1; j++) {
                if (prices[j] > prices[j + 1]) {
                    uint256 temp = prices[j];
                    prices[j] = prices[j + 1];
                    prices[j + 1] = temp;
                }
            }
        }

        // Return median
        if (length % 2 == 0) {
            return (prices[length / 2 - 1] + prices[length / 2]) / 2;
        } else {
            return prices[length / 2];
        }
    }

    /**
     * @notice Validate that price deviation is within acceptable range (same as PoolPriceValidator)
     * @param prices Array of prices
     * @param length Number of valid prices
     * @param medianPrice The calculated median price
     * @return True if deviation is acceptable (max 5%)
     */
    function _validatePriceDeviation(
        uint256[] memory prices,
        uint256 length,
        uint256 medianPrice
    ) internal pure returns (bool) {
        if (length < 2) return true; // No deviation check needed for single price

        for (uint256 i = 0; i < length; i++) {
            uint256 deviation;
            if (prices[i] > medianPrice) {
                deviation = ((prices[i] - medianPrice) * 10000) / medianPrice;
            } else {
                deviation = ((medianPrice - prices[i]) * 10000) / medianPrice;
            }

            if (deviation > MAX_DEVIATION_BPS) {
                return false;
            }
        }

        return true;
    }

    /**
     * @notice Get oracle configuration for an asset
     * @param asset Asset identifier
     * @return config Oracle configuration
     */
    function getOracleConfig(bytes32 asset) external view returns (OracleConfig memory config) {
        return oracleConfigs[asset];
    }
}


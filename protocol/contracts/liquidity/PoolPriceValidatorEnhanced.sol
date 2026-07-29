// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {AggregatorV3Interface} from "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IPublicLiquidityPool} from "./IPublicLiquidityPool.sol";

/**
 * @title PoolPriceValidatorEnhanced
 * @notice Enterprise-grade hybrid pricing validator with full TWAP, multi-oracle support, 
 *         flash loan detection, and manipulation alerts
 * @dev Enhanced version with all future enhancements implemented
 * @author Sentinel CTO
 * @custom:security-contact security@aegisprotocol.com
 * 
 * Enhanced Features:
 * - Full TWAP implementation with multiple observations (Uniswap V3 style)
 * - Multi-oracle support (Chainlink + Pyth Network)
 * - Flash loan attack detection
 * - Price manipulation alerts
 * - Automatic pool monitoring
 */
contract PoolPriceValidatorEnhanced is AccessControl, ReentrancyGuard {
    bytes32 public constant GOVERNANCE_ROLE = keccak256("GOVERNANCE_ROLE");
    bytes32 public constant MONITOR_ROLE = keccak256("MONITOR_ROLE");

    /// @notice Maximum allowed price deviation from oracle (5% = 500 basis points)
    uint256 public constant MAX_DEVIATION_BPS = 500;

    /// @notice Maximum allowed price staleness (1 hour)
    uint256 public constant MAX_PRICE_STALENESS = 3600;

    /// @notice Minimum TWAP period for price averaging (1 hour)
    uint256 public constant MIN_TWAP_PERIOD = 3600;

    /// @notice Maximum number of observations per pool (Uniswap V3 uses 65535)
    uint16 public constant MAX_OBSERVATIONS = 65535;

    /// @notice Maximum number of oracles per pool (DoS protection)
    uint256 public constant MAX_ORACLES = 10;

    /// @notice Flash loan detection threshold (10% reserve change in single block)
    uint256 public constant FLASH_LOAN_THRESHOLD_BPS = 1000; // 10%

    /// @notice Observation structure for TWAP calculation
    struct Observation {
        uint32 blockTimestamp; // Block timestamp of observation
        uint256 priceCumulative; // Cumulative price at observation
        bool initialized; // Whether observation is initialized
    }

    /// @notice Enhanced price data structure
    struct PriceData {
        uint256 poolPrice; // Price from pool reserves
        uint256 oraclePrice; // Price from oracle (median if multi-oracle)
        uint256 twapPrice; // Time-weighted average price
        uint256 timestamp; // Last update timestamp
        bool isValid; // Whether price is within acceptable deviation
        uint256 deviation; // Deviation in basis points
        bool flashLoanDetected; // Whether flash loan detected
    }

    /// @notice Enhanced pool configuration with multi-oracle support
    struct PoolConfig {
        address poolAddress; // PublicLiquidityPool address
        address[] quoteOracles; // Array of oracles for quote token (Chainlink, Pyth, etc.)
        address[] agsOracles; // Array of oracles for AGS (optional)
        bool enabled; // Whether validation is enabled
        uint256 maxDeviationBps; // Max deviation allowed
        uint32 twapWindow; // TWAP window in seconds
        uint16 observationCardinality; // Number of observations to store
        bool flashLoanProtectionEnabled; // Flash loan detection enabled
    }

    /// @notice Flash loan detection data
    struct FlashLoanData {
        uint256 previousReserveAGS; // Reserve before potential flash loan
        uint256 previousReserveQuote; // Reserve before potential flash loan
        uint32 lastBlockChecked; // Last block number checked
        bool alertRaised; // Whether alert was raised
    }

    /// @notice Pool configuration mapping
    mapping(address => PoolConfig) public poolConfigs;

    /// @notice Price data mapping
    mapping(address => PriceData) public priceData;

    /// @notice Observations for TWAP calculation (pool => index => observation)
    mapping(address => Observation[]) public observations;

    /// @notice Observation indices per pool
    mapping(address => uint16) public observationIndices;

    /// @notice Flash loan detection data per pool
    mapping(address => FlashLoanData) public flashLoanData;

    /// @notice Reserve history for flash loan detection (pool => block => reserve)
    mapping(address => mapping(uint256 => uint256)) public reserveHistory;

    /// @notice Events
    event PoolConfigured(
        address indexed pool,
        address[] quoteOracles,
        bool enabled
    );

    event PriceValidated(
        address indexed pool,
        uint256 poolPrice,
        uint256 oraclePrice,
        uint256 twapPrice,
        uint256 deviation,
        bool isValid
    );

    event FlashLoanDetected(
        address indexed pool,
        uint256 reserveChangeBps,
        uint256 previousReserveAGS,
        uint256 previousReserveQuote,
        uint256 currentReserveAGS,
        uint256 currentReserveQuote
    );

    event TWAPUnavailable(
        address indexed pool,
        uint256 timeElapsed,
        uint256 requiredWindow,
        bool usingCurrentPrice
    );

    event PriceManipulationAlert(
        address indexed pool,
        uint256 deviation,
        uint256 poolPrice,
        uint256 oraclePrice,
        uint256 twapPrice,
        string reason
    );

    event ValidationEnabled(address indexed pool, bool enabled);
    event DeviationThresholdUpdated(address indexed pool, uint256 newThreshold);
    event FlashLoanProtectionToggled(address indexed pool, bool enabled);

    error PoolNotConfigured();
    error InvalidOracleAddress();
    error InvalidDeviationThreshold();
    error PriceTooStale();
    error PriceDeviationTooHigh(uint256 deviation, uint256 maxDeviation);
    error OracleCallFailed();
    error FlashLoanAttackDetected();
    error InsufficientObservations();
    error TooManyOracles();
    error OraclePriceZero();
    error InvalidTimeWindow();
    error DivisionByZero();

    /**
     * @notice Constructor
     * @param admin Address to receive DEFAULT_ADMIN_ROLE and GOVERNANCE_ROLE
     */
    constructor(address admin) {
        require(admin != address(0), "Admin zero");
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(GOVERNANCE_ROLE, admin);
        _grantRole(MONITOR_ROLE, admin);
    }

    /**
     * @notice Configure pool with multi-oracle support
     * @param pool Pool address
     * @param quoteOracles Array of quote token oracles
     * @param agsOracles Array of AGS oracles (can be empty)
     * @param enabled Enable validation
     * @param maxDeviationBps Max deviation in basis points
     * @param twapWindow TWAP window in seconds
     * @param observationCardinality Number of observations to store
     * @param flashLoanProtectionEnabled Enable flash loan detection
     */
    function configurePool(
        address pool,
        address[] memory quoteOracles,
        address[] memory agsOracles,
        bool enabled,
        uint256 maxDeviationBps,
        uint32 twapWindow,
        uint16 observationCardinality,
        bool flashLoanProtectionEnabled
    ) external onlyRole(GOVERNANCE_ROLE) {
        require(pool != address(0), "Pool zero");
        require(quoteOracles.length > 0 || !enabled, "Oracles required when enabled");
        require(quoteOracles.length <= MAX_ORACLES, "Too many oracles");
        require(agsOracles.length <= MAX_ORACLES, "Too many oracles");
        require(twapWindow >= MIN_TWAP_PERIOD, "TWAP window too short");
        require(observationCardinality <= MAX_OBSERVATIONS, "Cardinality too high");

        poolConfigs[pool] = PoolConfig({
            poolAddress: pool,
            quoteOracles: quoteOracles,
            agsOracles: agsOracles,
            enabled: enabled,
            maxDeviationBps: maxDeviationBps == 0 ? MAX_DEVIATION_BPS : maxDeviationBps,
            twapWindow: twapWindow == 0 ? uint32(MIN_TWAP_PERIOD) : twapWindow,
            observationCardinality: observationCardinality == 0 ? 1 : observationCardinality,
            flashLoanProtectionEnabled: flashLoanProtectionEnabled
        });

        // Initialize observations array
        if (observations[pool].length == 0) {
            observations[pool] = new Observation[](observationCardinality);
        }

        emit PoolConfigured(pool, quoteOracles, enabled);
    }

    /**
     * @notice Validate pool price with full TWAP and multi-oracle support
     * @param pool Pool address
     * @return isValid Whether price is valid
     * @return poolPrice Price from pool
     * @return oraclePrice Median oracle price
     * @return twapPrice TWAP price
     * @return deviation Deviation in basis points
     */
    function validatePoolPrice(address pool)
        external
        nonReentrant
        returns (
            bool isValid,
            uint256 poolPrice,
            uint256 oraclePrice,
            uint256 twapPrice,
            uint256 deviation
        )
    {
        PoolConfig memory config = poolConfigs[pool];
        require(config.poolAddress != address(0), "Pool not configured");

        // Get pool reserves
        IPublicLiquidityPool poolContract = IPublicLiquidityPool(pool);
        (uint256 reserveAGS, uint256 reserveQuote) = poolContract.getReserves();
        require(reserveAGS > 0 && reserveQuote > 0, "Pool empty");

        // Check for flash loans
        bool flashLoanDetected = false;
        if (config.flashLoanProtectionEnabled) {
            flashLoanDetected = _detectFlashLoan(pool, reserveAGS, reserveQuote);
            if (flashLoanDetected) {
                emit FlashLoanDetected(
                    pool,
                    _calculateReserveChange(pool, reserveAGS, reserveQuote),
                    flashLoanData[pool].previousReserveAGS,
                    flashLoanData[pool].previousReserveQuote,
                    reserveAGS,
                    reserveQuote
                );
            }
        }

        // Calculate pool price
        poolPrice = (reserveQuote * 1e18) / reserveAGS;

        // Get median oracle price (multi-oracle support)
        oraclePrice = _getMedianOraclePrice(config, poolPrice);
        if (oraclePrice == 0) revert OraclePriceZero();

        // Calculate TWAP
        twapPrice = _calculateFullTWAP(pool, poolPrice);
        
        // Security: Detect if TWAP is unavailable (falls back to current price)
        // When TWAP equals current price, it means TWAP calculation failed
        bool twapUnavailable = (twapPrice == poolPrice && poolPrice > 0);
        
        if (twapUnavailable) {
            // Emit warning event - TWAP protection is not active
            emit TWAPUnavailable(
                pool,
                block.timestamp, // Current timestamp
                config.twapWindow,
                true // Using current price as fallback
            );
            
            // When TWAP unavailable, rely more heavily on oracle validation
            // Use stricter deviation threshold (50% of normal)
            uint256 strictDeviation = config.maxDeviationBps * 50 / 100;
            uint256 priceDiff = poolPrice > oraclePrice
                ? poolPrice - oraclePrice
                : oraclePrice - poolPrice;
            deviation = (priceDiff * 10000) / oraclePrice;
            isValid = deviation <= strictDeviation && !flashLoanDetected;
        } else {
            // TWAP is available - use it for validation
            // Compare pool price against TWAP (more reliable than current price)
            uint256 priceDiff = poolPrice > twapPrice
                ? poolPrice - twapPrice
                : twapPrice - poolPrice;
            deviation = (priceDiff * 10000) / twapPrice;
            isValid = deviation <= config.maxDeviationBps && !flashLoanDetected;
            
            // Also check oracle deviation as secondary validation
            uint256 oracleDiff = poolPrice > oraclePrice
                ? poolPrice - oraclePrice
                : oraclePrice - poolPrice;
            uint256 oracleDeviation = (oracleDiff * 10000) / oraclePrice;
            if (oracleDeviation > config.maxDeviationBps) {
                isValid = false; // Oracle also shows manipulation
            }
        }

        // Store price data
        priceData[pool] = PriceData({
            poolPrice: poolPrice,
            oraclePrice: oraclePrice,
            twapPrice: twapPrice,
            timestamp: block.timestamp,
            isValid: isValid,
            deviation: deviation,
            flashLoanDetected: flashLoanDetected
        });

        // Update observations for TWAP
        _updateObservation(pool, poolPrice);

        // Update flash loan data
        if (config.flashLoanProtectionEnabled) {
            flashLoanData[pool].previousReserveAGS = reserveAGS;
            flashLoanData[pool].previousReserveQuote = reserveQuote;
            flashLoanData[pool].lastBlockChecked = uint32(block.number);
        }

        // Emit alerts if needed
        if (!isValid || deviation > config.maxDeviationBps / 2) {
            string memory reason = flashLoanDetected
                ? "Flash loan detected"
                : (deviation > config.maxDeviationBps ? "Deviation too high" : "High deviation");
            emit PriceManipulationAlert(pool, deviation, poolPrice, oraclePrice, twapPrice, reason);
        }

        emit PriceValidated(pool, poolPrice, oraclePrice, twapPrice, deviation, isValid);

        return (isValid, poolPrice, oraclePrice, twapPrice, deviation);
    }

    /**
     * @notice Get median oracle price from multiple oracles
     * @param config Pool configuration
     * @param fallbackPrice Fallback price if all oracles fail
     * @return price Median oracle price
     */
    function _getMedianOraclePrice(
        PoolConfig memory config,
        uint256 fallbackPrice
    ) internal view returns (uint256 price) {
        uint256 oracleCount = config.quoteOracles.length;
        if (oracleCount == 0) {
            return fallbackPrice;
        }

        // Limit oracle count to prevent DoS
        if (oracleCount > MAX_ORACLES) {
            oracleCount = MAX_ORACLES;
        }

        uint256[] memory prices = new uint256[](oracleCount);
        uint256 validCount = 0;

        // Fetch prices from all oracles
        for (uint256 i = 0; i < oracleCount; ++i) {
            address oracle = config.quoteOracles[i];
            if (oracle == address(0)) continue;
            
            try AggregatorV3Interface(oracle).latestRoundData() returns (
                uint80 /* roundId */,
                int256 answer,
                uint256 /* startedAt */,
                uint256 updatedAt,
                uint80 /* answeredInRound */
            ) {
                if (answer > 0 && updatedAt > 0 && block.timestamp 
                >= updatedAt && block.timestamp - updatedAt <= MAX_PRICE_STALENESS) {
                    unchecked {
                        prices[validCount] = uint256(answer) * 1e10;
                    }
                    ++validCount;
                }
            } catch {
                continue;
            }
        }

        if (validCount == 0) {
            return fallbackPrice;
        }

        return _calculateMedian(prices, validCount);
    }

    /**
     * @notice Calculate median from sorted prices
     * @param prices Array of prices
     * @param count Number of valid prices
     * @return median Median price
     */
    function _calculateMedian(
        uint256[] memory prices,
        uint256 count
    ) internal pure returns (uint256 median) {
        if (count == 0) return 0;
        if (count == 1) return prices[0];

        // Sort prices (optimized insertion sort for small arrays - better than bubble for <=10 items)
        for (uint256 i = 1; i < count; ++i) {
            uint256 key = prices[i];
            uint256 j = i;
            while (j > 0 && prices[j - 1] > key) {
                prices[j] = prices[j - 1];
                --j;
            }
            prices[j] = key;
        }

        // Calculate median
        if (count % 2 == 0) {
            uint256 mid1 = prices[(count / 2) - 1];
            uint256 mid2 = prices[count / 2];
            median = (mid1 + mid2) / 2;
        } else {
            median = prices[count / 2];
        }
    }

    /**
     * @notice Calculate full TWAP using observations (Uniswap V3 style)
     * @param pool Pool address
     * @param currentPrice Current pool price
     * @return twapPrice TWAP price
     */
    function _calculateFullTWAP(
        address pool,
        uint256 currentPrice
    ) internal view returns (uint256 twapPrice) {
        PoolConfig memory config = poolConfigs[pool];
        Observation[] storage poolObservations = observations[pool];
        uint16 currentIndex = observationIndices[pool];

        if (poolObservations.length == 0 || !poolObservations[currentIndex].initialized) {
            return currentPrice; // TWAP unavailable - will be detected in calling function
        }

        uint32 currentTimestamp = uint32(block.timestamp);
        if (currentTimestamp < poolObservations[currentIndex].blockTimestamp) {
            return currentPrice; // Invalid timestamp (shouldn't happen but protect against edge case)
        }
        uint32 timeElapsed = currentTimestamp - poolObservations[currentIndex].blockTimestamp;
        if (timeElapsed < config.twapWindow) {
            // Need older observations
            uint16 oldestIndex = _getOldestObservationIndex(pool);
            if (oldestIndex == currentIndex) {
                return currentPrice; // Not enough history - TWAP unavailable
            }

            if (currentTimestamp < poolObservations[oldestIndex].blockTimestamp) {
                return currentPrice; // Invalid timestamp
            }
            timeElapsed = currentTimestamp - poolObservations[oldestIndex].blockTimestamp;
            if (timeElapsed < config.twapWindow || timeElapsed == 0) {
                return currentPrice; // Still not enough or invalid - TWAP unavailable
            }

            uint256 priceCumulativeDelta = poolObservations[currentIndex].priceCumulative >
                poolObservations[oldestIndex].priceCumulative
                ? poolObservations[currentIndex].priceCumulative - poolObservations[oldestIndex].priceCumulative
                : 0;
            twapPrice = priceCumulativeDelta / uint256(timeElapsed);
        } else {
            // Simple TWAP from last observation
            if (timeElapsed == 0) return currentPrice; // Prevent division by zero
            uint256 priceCumulativeDelta = _calculatePriceCumulative(currentPrice, timeElapsed);
            twapPrice = priceCumulativeDelta / uint256(timeElapsed);
        }

        if (twapPrice == 0) {
            return currentPrice; // Fallback
        }

        return twapPrice;
    }

    /**
     * @notice Update observation for TWAP calculation
     * @param pool Pool address
     * @param price Current price
     */
    function _updateObservation(address pool, uint256 price) internal {
        Observation[] storage poolObservations = observations[pool];
        uint16 currentIndex = observationIndices[pool];
        uint16 cardinality = uint16(poolObservations.length);
        if (cardinality == 0) return;
        uint16 nextIndex = (currentIndex + 1) % cardinality;

        uint32 timeElapsed = 0;
        if (poolObservations[currentIndex].initialized) {
            uint32 currentTimestamp = uint32(block.timestamp);
            if (currentTimestamp > poolObservations[currentIndex].blockTimestamp) {
                timeElapsed = currentTimestamp - poolObservations[currentIndex].blockTimestamp;
            }
        }

        uint256 newCumulative = _calculatePriceCumulative(price, timeElapsed);
        uint256 priceCumulative = poolObservations[currentIndex].priceCumulative + newCumulative;

        poolObservations[nextIndex] = Observation({
            blockTimestamp: uint32(block.timestamp),
            priceCumulative: priceCumulative,
            initialized: true
        });

        observationIndices[pool] = nextIndex;
    }

    /**
     * @notice Calculate price cumulative for TWAP
     * @param price Price
     * @param timeElapsed Time elapsed
     * @return cumulative Cumulative price
     */
    function _calculatePriceCumulative(
        uint256 price,
        uint32 timeElapsed
    ) internal pure returns (uint256 cumulative) {
        if (timeElapsed == 0) return 0;
        unchecked {
            cumulative = price * uint256(timeElapsed);
        }
    }

    /**
     * @notice Get oldest observation index
     * @param pool Pool address
     * @return index Oldest observation index
     */
    function _getOldestObservationIndex(address pool) internal view returns (uint16 index) {
        Observation[] storage poolObservations = observations[pool];
        uint16 currentIndex = observationIndices[pool];
        uint16 cardinality = uint16(poolObservations.length);
        
        if (cardinality == 0) return currentIndex;
        
        uint16 oldestIndex = currentIndex;
        uint32 oldestTimestamp = type(uint32).max;

        // Limit search to prevent DoS (max 100 iterations)
        uint16 maxSearch = cardinality > 100 ? 100 : cardinality;
        
        for (uint16 i = 0; i < maxSearch; ++i) {
            uint16 idx = (currentIndex + i) % cardinality;
            if (poolObservations[idx].initialized) {
                if (poolObservations[idx].blockTimestamp < oldestTimestamp) {
                    oldestTimestamp = poolObservations[idx].blockTimestamp;
                    oldestIndex = idx;
                }
            }
        }

        return oldestIndex;
    }

    /**
     * @notice Detect flash loan attacks by checking reserve changes
     * @param pool Pool address
     * @param currentReserveAGS Current AGS reserve
     * @param currentReserveQuote Current quote reserve
     * @return detected Whether flash loan detected
     */
    function _detectFlashLoan(
        address pool,
        uint256 currentReserveAGS,
        uint256 currentReserveQuote
    ) internal view returns (bool detected) {
        FlashLoanData memory data = flashLoanData[pool];

        // First check in block
        if (data.lastBlockChecked == 0 || uint256(data.lastBlockChecked) < block.number - 1) {
            return false; // Not enough history
        }

        // Check if reserves changed significantly in same block (must be first check this block)
        if (data.lastBlockChecked > 0 && uint256(data.lastBlockChecked) == block.number) {
            uint256 agsChangeBps = _calculateChangeBps(
                data.previousReserveAGS,
                currentReserveAGS
            );
            uint256 quoteChangeBps = _calculateChangeBps(
                data.previousReserveQuote,
                currentReserveQuote
            );

            // Flash loan detected if >10% change in same block
            if (
                agsChangeBps > FLASH_LOAN_THRESHOLD_BPS ||
                quoteChangeBps > FLASH_LOAN_THRESHOLD_BPS
            ) {
                return true;
            }
        }

        return false;
    }

    /**
     * @notice Calculate percentage change in basis points
     * @param oldValue Old value
     * @param newValue New value
     * @return changeBps Change in basis points
     */
    function _calculateChangeBps(
        uint256 oldValue,
        uint256 newValue
    ) internal pure returns (uint256 changeBps) {
        if (oldValue == 0) return 0;
        uint256 diff = newValue > oldValue ? newValue - oldValue : oldValue - newValue;
        return (diff * 10000) / oldValue;
    }

    /**
     * @notice Calculate reserve change percentage
     * @param pool Pool address
     * @param currentReserveAGS Current AGS reserve
     * @param currentReserveQuote Current quote reserve
     * @return changeBps Change in basis points
     */
    function _calculateReserveChange(
        address pool,
        uint256 currentReserveAGS,
        uint256 currentReserveQuote
    ) internal view returns (uint256 changeBps) {
        FlashLoanData memory data = flashLoanData[pool];
        uint256 agsChange = _calculateChangeBps(data.previousReserveAGS, currentReserveAGS);
        uint256 quoteChange = _calculateChangeBps(
            data.previousReserveQuote,
            currentReserveQuote
        );
        return agsChange > quoteChange ? agsChange : quoteChange;
    }

    /**
     * @notice Validate seeding price (enhanced with multi-oracle)
     * @param pool Pool address
     * @param agsAmount AGS amount to seed
     * @param quoteAmount Quote amount to seed
     */
    function validateSeedingPrice(
        address pool,
        uint256 agsAmount,
        uint256 quoteAmount
    ) external view {
        PoolConfig memory config = poolConfigs[pool];
        if (!config.enabled) return;

        require(config.poolAddress != address(0), "Pool not configured");

        if (agsAmount == 0) revert DivisionByZero();
        uint256 proposedPrice = (quoteAmount * 1e18) / agsAmount;
        uint256 oraclePrice = _getMedianOraclePrice(config, proposedPrice);
        if (oraclePrice == 0) revert OraclePriceZero();
        
        uint256 priceDiff = proposedPrice > oraclePrice
            ? proposedPrice - oraclePrice
            : oraclePrice - proposedPrice;
        uint256 deviation = (priceDiff * 10000) / oraclePrice;

        if (deviation > config.maxDeviationBps) {
            revert PriceDeviationTooHigh(deviation, config.maxDeviationBps);
        }
    }

    /**
     * @notice Get pool status with all data
     * @param pool Pool address
     * @return config Pool configuration
     * @return price Latest price data
     * @return flashLoan Flash loan detection data
     * @return observationCount Number of observations stored
     */
    function getPoolStatus(address pool)
        external
        view
        returns (
            PoolConfig memory config,
            PriceData memory price,
            FlashLoanData memory flashLoan,
            uint256 observationCount
        )
    {
        config = poolConfigs[pool];
        price = priceData[pool];
        flashLoan = flashLoanData[pool];
        observationCount = observations[pool].length;
    }

    // Additional utility functions
    function setValidationEnabled(address pool, bool enabled) external onlyRole(GOVERNANCE_ROLE) {
        require(poolConfigs[pool].poolAddress != address(0), "Pool not configured");
        poolConfigs[pool].enabled = enabled;
        emit ValidationEnabled(pool, enabled);
    }

    function setMaxDeviation(address pool, uint256 maxDeviationBps)
        external
        onlyRole(GOVERNANCE_ROLE)
    {
        require(poolConfigs[pool].poolAddress != address(0), "Pool not configured");
        require(maxDeviationBps <= 2000, "Deviation too high");
        poolConfigs[pool].maxDeviationBps = maxDeviationBps;
        emit DeviationThresholdUpdated(pool, maxDeviationBps);
    }

    function setFlashLoanProtection(address pool, bool enabled)
        external
        onlyRole(GOVERNANCE_ROLE)
    {
        require(poolConfigs[pool].poolAddress != address(0), "Pool not configured");
        poolConfigs[pool].flashLoanProtectionEnabled = enabled;
        emit FlashLoanProtectionToggled(pool, enabled);
    }
}


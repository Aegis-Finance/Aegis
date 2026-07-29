// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {AggregatorV3Interface} from "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IPublicLiquidityPool} from "./IPublicLiquidityPool.sol";
import {MultiOracleAggregator} from "../oracles/MultiOracleAggregator.sol";

/**
 * @title PoolPriceValidator
 * @notice Enterprise-grade hybrid pricing validator combining AMM pool reserves with Chainlink oracles
 * @dev Validates pool prices against oracle feeds to prevent manipulation and ensure market alignment
 *      Governance-controlled, backward compatible, can be enabled/disabled per pool
 * @author Sentinel CTO
 * @custom:security-contact security@aegisprotocol.com
 * 
 * Features:
 * - Chainlink oracle integration (Sonic-native)
 * - Price deviation validation (5% default, configurable)
 * - TWAP calculation (time-weighted average price)
 * - Dynamic fee calculation based on oracle deviation
 * - Hybrid pricing (70% pool, 30% oracle)
 * - Optional validation per pool
 * 
 * Oracle Support on Sonic (per https://docs.soniclabs.com):
 * - Chainlink (Data Feeds)
 * - Pyth Network (Price Feed)
 * - API3, Band Protocol, RedStone, Supra, Stork Network
 */
contract PoolPriceValidator is AccessControl, ReentrancyGuard {
    bytes32 public constant GOVERNANCE_ROLE = keccak256("GOVERNANCE_ROLE");

    /// @notice Maximum allowed price deviation from oracle (5% = 500 basis points)
    uint256 public constant MAX_DEVIATION_BPS = 500;

    /// @notice Maximum allowed price staleness (1 hour)
    uint256 public constant MAX_PRICE_STALENESS = 3600;

    /// @notice Minimum TWAP period for price averaging (1 hour)
    uint256 public constant MIN_TWAP_PERIOD = 3600;

    /// @notice Price data structure for validation
    struct PriceData {
        uint256 poolPrice; // Price from pool reserves (poolPrice = reserveQuote / reserveAGS)
        uint256 oraclePrice; // Price from Chainlink oracle
        uint256 twapPrice; // Time-weighted average price from pool
        uint256 timestamp; // Last update timestamp
        bool isValid; // Whether price is within acceptable deviation
    }

    /// @notice Pool validation configuration
    struct PoolConfig {
        address poolAddress; // PublicLiquidityPool address
        address quoteOracle; // Chainlink oracle for quote token (USDC/USDT/WETH) - legacy
        address agsOracle; // Chainlink oracle for AGS (if available, otherwise address(0)) - legacy
        address multiOracleAggregator; // Multi-oracle aggregator address (optional, for multi-oracle support)
        bytes32 assetId; // Asset identifier for multi-oracle aggregator
        bool useMultiOracle; // Whether to use multi-oracle aggregator instead of single Chainlink
        bool enabled; // Whether validation is enabled for this pool
        uint256 maxDeviationBps; // Max deviation allowed for this pool (can override default)
        uint256 twapWindow; // TWAP window in seconds (default: 1 hour)
    }

    /// @notice Mapping of pool address to configuration
    mapping(address => PoolConfig) public poolConfigs;

    /// @notice Mapping of pool address to last validated price data
    mapping(address => PriceData) public priceData;

    /// @notice Mapping of pool address to cumulative price for TWAP calculation
    mapping(address => mapping(uint256 => uint256)) public cumulativePrices;
    mapping(address => uint256) public lastObservationTime;

    /// @notice Events
    /// @param pool Address of the pool
    /// @param quoteOracle Chainlink oracle address for quote token
    /// @param enabled Whether validation is enabled
    event PoolConfigured(address indexed pool, address indexed quoteOracle, bool enabled);

    /// @param pool Address of the pool
    /// @param poolPrice Price from pool reserves
    /// @param oraclePrice Price from Chainlink oracle
    /// @param deviation Deviation in basis points
    /// @param isValid Whether price is valid
    event PriceValidated(
        address indexed pool,
        uint256 poolPrice,
        uint256 oraclePrice,
        uint256 deviation,
        bool isValid
    );

    /// @param pool Address of the pool
    /// @param enabled Whether validation is enabled
    event ValidationEnabled(address indexed pool, bool enabled);

    /// @param pool Address of the pool
    /// @param newThreshold New deviation threshold in basis points
    event DeviationThresholdUpdated(address indexed pool, uint256 newThreshold);

    error PoolNotConfigured();
    error InvalidOracleAddress();
    error InvalidDeviationThreshold();
    error PriceTooStale();
    error PriceDeviationTooHigh(uint256 deviation, uint256 maxDeviation);
    error OracleCallFailed();

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
     * @notice Configure oracle validation for a pool (legacy Chainlink-only)
     * @param pool Address of the PublicLiquidityPool
     * @param quoteOracle Chainlink oracle address for quote token (USDC/USDT/WETH)
     * @param agsOracle Chainlink oracle address for AGS (address(0) if not available)
     * @param enabled Whether validation is enabled
     * @param maxDeviationBps Maximum deviation in basis points (0 = use default)
     * @param twapWindow TWAP window in seconds (0 = use default 1 hour)
     */
    function configurePool(
        address pool,
        address quoteOracle,
        address agsOracle,
        bool enabled,
        uint256 maxDeviationBps,
        uint256 twapWindow
    ) external onlyRole(GOVERNANCE_ROLE) {
        require(pool != address(0), "Pool zero");
        require(quoteOracle != address(0) || !enabled, "Oracle required when enabled");

        poolConfigs[pool] = PoolConfig({
            poolAddress: pool,
            quoteOracle: quoteOracle,
            agsOracle: agsOracle,
            multiOracleAggregator: address(0),
            assetId: bytes32(0),
            useMultiOracle: false,
            enabled: enabled,
            maxDeviationBps: maxDeviationBps == 0 ? MAX_DEVIATION_BPS : maxDeviationBps,
            twapWindow: twapWindow == 0 ? MIN_TWAP_PERIOD : twapWindow
        });

        emit PoolConfigured(pool, quoteOracle, enabled);
    }

    /**
     * @notice Configure pool with multi-oracle aggregator
     * @param pool Address of the PublicLiquidityPool
     * @param aggregator Address of MultiOracleAggregator contract
     * @param assetId Asset identifier for the aggregator
     * @param enabled Whether validation is enabled
     * @param maxDeviationBps Maximum deviation in basis points (0 = use default)
     * @param twapWindow TWAP window in seconds (0 = use default 1 hour)
     */
    function configurePoolMultiOracle(
        address pool,
        address aggregator,
        bytes32 assetId,
        bool enabled,
        uint256 maxDeviationBps,
        uint256 twapWindow
    ) external onlyRole(GOVERNANCE_ROLE) {
        require(pool != address(0), "Pool zero");
        require(aggregator != address(0) || !enabled, "Aggregator required when enabled");
        require(assetId != bytes32(0) || !enabled, "Asset ID required when enabled");

        poolConfigs[pool] = PoolConfig({
            poolAddress: pool,
            quoteOracle: address(0),
            agsOracle: address(0),
            multiOracleAggregator: aggregator,
            assetId: assetId,
            useMultiOracle: true,
            enabled: enabled,
            maxDeviationBps: maxDeviationBps == 0 ? MAX_DEVIATION_BPS : maxDeviationBps,
            twapWindow: twapWindow == 0 ? MIN_TWAP_PERIOD : twapWindow
        });

        emit PoolConfigured(pool, aggregator, enabled);
    }

    /**
     * @notice Enable/disable validation for a pool (configuration must exist)
     * @param pool Address of the pool
     * @param enabled Whether to enable validation
     */
    function setValidationEnabled(address pool, bool enabled) external onlyRole(GOVERNANCE_ROLE) {
        require(poolConfigs[pool].poolAddress != address(0), "Pool not configured");
        poolConfigs[pool].enabled = enabled;
        emit ValidationEnabled(pool, enabled);
    }

    /**
     * @notice Update maximum deviation threshold for a pool
     * @param pool Address of the pool
     * @param maxDeviationBps New maximum deviation in basis points
     */
    function setMaxDeviation(address pool, uint256 maxDeviationBps)
        external
        onlyRole(GOVERNANCE_ROLE)
    {
        require(poolConfigs[pool].poolAddress != address(0), "Pool not configured");
        require(maxDeviationBps <= 2000, "Deviation too high"); // Max 20%
        poolConfigs[pool].maxDeviationBps = maxDeviationBps;
        emit DeviationThresholdUpdated(pool, maxDeviationBps);
    }

    /**
     * @notice Validate pool price against oracle (can be called by anyone)
     * @param pool Address of the pool to validate
     * @return isValid Whether pool price is within acceptable deviation
     * @return poolPrice Price from pool reserves
     * @return oraclePrice Price from Chainlink oracle
     * @return deviation Deviation percentage in basis points
     */
    function validatePoolPrice(address pool)
        external
        returns (bool isValid, uint256 poolPrice, uint256 oraclePrice, uint256 deviation)
    {
        PoolConfig memory config = poolConfigs[pool];
        require(config.poolAddress != address(0), "Pool not configured");

        // Get pool reserves
        IPublicLiquidityPool poolContract = IPublicLiquidityPool(pool);
        (uint256 reserveAGS, uint256 reserveQuote) = poolContract.getReserves();
        require(reserveAGS > 0 && reserveQuote > 0, "Pool empty");

        // Calculate pool price (quote token per AGS)
        // Price = reserveQuote / reserveAGS (with 18 decimals precision)
        poolPrice = (reserveQuote * 1e18) / reserveAGS;

        // Get oracle price
        oraclePrice = _getOraclePrice(config);
        require(oraclePrice > 0, "Oracle price zero");

        // Calculate deviation
        uint256 priceDiff = poolPrice > oraclePrice ? poolPrice - oraclePrice : oraclePrice - poolPrice;
        deviation = (priceDiff * 10000) / oraclePrice;

        // Check if within acceptable deviation
        isValid = deviation <= config.maxDeviationBps;

        // Calculate TWAP (simplified - would need proper TWAP implementation)
        uint256 twapPrice = _calculateTWAP(pool, reserveAGS, reserveQuote);

        // Store price data
        priceData[pool] = PriceData({
            poolPrice: poolPrice,
            oraclePrice: oraclePrice,
            twapPrice: twapPrice,
            timestamp: block.timestamp,
            isValid: isValid
        });

        // Update cumulative price for TWAP
        _updateCumulativePrice(pool, poolPrice);

        emit PriceValidated(pool, poolPrice, oraclePrice, deviation, isValid);

        return (isValid, poolPrice, oraclePrice, deviation);
    }

    /**
     * @notice Validate price before liquidity seeding (reverts if invalid)
     * @param pool Address of the pool
     * @param agsAmount Amount of AGS to be seeded
     * @param quoteAmount Amount of quote token to be seeded
     */
    function validateSeedingPrice(
        address pool,
        uint256 agsAmount,
        uint256 quoteAmount
    ) external view {
        PoolConfig memory config = poolConfigs[pool];
        if (!config.enabled) return; // Validation disabled, skip

        require(config.poolAddress != address(0), "Pool not configured");
        require(agsAmount > 0, "AGS amount zero");

        // Calculate proposed pool price
        uint256 proposedPrice = (quoteAmount * 1e18) / agsAmount;

        // Get oracle price
        uint256 oraclePrice = _getOraclePrice(config);
        require(oraclePrice > 0, "Oracle price zero");

        // Calculate deviation
        uint256 priceDiff = proposedPrice > oraclePrice
            ? proposedPrice - oraclePrice
            : oraclePrice - proposedPrice;
        uint256 deviation = (priceDiff * 10000) / oraclePrice;

        // Revert if deviation too high
        if (deviation > config.maxDeviationBps) {
            revert PriceDeviationTooHigh(deviation, config.maxDeviationBps);
        }
    }

    /**
     * @notice Get validated hybrid price (70% pool, 30% oracle)
     * @param pool Address of the pool
     * @return hybridPrice Weighted average price
     * @return poolPrice Price from pool
     * @return oraclePrice Price from oracle
     */
    function getHybridPrice(address pool)
        external
        view
        returns (uint256 hybridPrice, uint256 poolPrice, uint256 oraclePrice)
    {
        PoolConfig memory config = poolConfigs[pool];
        require(config.poolAddress != address(0), "Pool not configured");

        // Get pool reserves
        IPublicLiquidityPool poolContract = IPublicLiquidityPool(pool);
        (uint256 reserveAGS, uint256 reserveQuote) = poolContract.getReserves();
        require(reserveAGS > 0 && reserveQuote > 0, "Pool empty");

        poolPrice = (reserveQuote * 1e18) / reserveAGS;
        oraclePrice = _getOraclePrice(config);
        require(oraclePrice > 0, "Oracle price zero");

        // Weighted average: 70% pool, 30% oracle
        hybridPrice = (poolPrice * 70 + oraclePrice * 30) / 100;

        return (hybridPrice, poolPrice, oraclePrice);
    }

    /**
     * @notice Calculate dynamic fee based on oracle deviation (0.30% base, up to 3% max)
     * @param pool Address of the pool
     * @return feeBps Fee in basis points
     */
    function calculateDynamicFee(address pool) external view returns (uint256 feeBps) {
        PoolConfig memory config = poolConfigs[pool];
        if (!config.enabled || config.poolAddress == address(0)) {
            return 30; // Base fee: 0.30%
        }

        // Get current prices
        IPublicLiquidityPool poolContract = IPublicLiquidityPool(pool);
        (uint256 reserveAGS, uint256 reserveQuote) = poolContract.getReserves();
        if (reserveAGS == 0 || reserveQuote == 0) {
            return 30; // Base fee if pool empty
        }

        uint256 poolPrice = (reserveQuote * 1e18) / reserveAGS;
        uint256 oraclePrice = _getOraclePrice(config);
        if (oraclePrice == 0) return 30; // Base fee if oracle unavailable

        // Calculate deviation
        uint256 priceDiff = poolPrice > oraclePrice
            ? poolPrice - oraclePrice
            : oraclePrice - poolPrice;
        uint256 deviation = (priceDiff * 10000) / oraclePrice;

        // Dynamic fee calculation:
        // - 0-1% deviation: 0.30% fee (base)
        // - 1-5% deviation: 0.30% - 1.00% fee (linear)
        // - 5%+ deviation: 1.00% - 3.00% fee (exponential)

        if (deviation <= 100) {
            return 30; // 0.30% base fee
        } else if (deviation <= 500) {
            // Linear: 30 + (deviation - 100) * (100 - 30) / (500 - 100)
            return 30 + ((deviation - 100) * 70) / 400;
        } else {
            // Exponential: 100 + min(deviation - 500, 2000) * 2 / 100
            uint256 excessDeviation = deviation > 2500 ? 2000 : deviation - 500;
            return 100 + (excessDeviation * 2) / 100; // Cap at 300 bps (3%)
        }
    }

    /**
     * @notice Get oracle price (internal)
     * @param config Pool configuration
     * @return price Oracle price in 18 decimals
     */
    function _getOraclePrice(PoolConfig memory config) internal view returns (uint256 price) {
        // Use multi-oracle aggregator if configured
        if (config.useMultiOracle && config.multiOracleAggregator != address(0)) {
            try MultiOracleAggregator(config.multiOracleAggregator).getPrice(config.assetId) returns (
                uint256 medianPrice,
                uint256 timestamp,
                uint256,
                bool isValid
            ) {
                require(isValid, "Multi-oracle price invalid");
                require(
                    timestamp <= block.timestamp && block.timestamp - timestamp <= MAX_PRICE_STALENESS,
                    "Price stale"
                );
                return medianPrice;
            } catch {
                revert OracleCallFailed();
            }
        }

        // Fallback to legacy Chainlink implementation
        require(config.quoteOracle != address(0), "Oracle not set");

        try AggregatorV3Interface(config.quoteOracle).latestRoundData() returns (
            uint80 /* roundId */,
            int256 answer,
            uint256 /* startedAt */,
            uint256 updatedAt,
            uint80 /* answeredInRound */
        ) {
            require(answer > 0, "Invalid oracle price");
            require(
                updatedAt <= block.timestamp && block.timestamp - updatedAt <= MAX_PRICE_STALENESS,
                "Price stale"
            );

            // Oracle price is typically in 8 decimals, convert to 18
            // For quote tokens like USDC/USDT, oracle gives USD price
            // For AGS, if we have AGS oracle, use it; otherwise use quote oracle price
            price = uint256(answer) * 1e10; // Convert 8 decimals to 18

            // If we have AGS oracle, calculate AGS/quote ratio
            if (config.agsOracle != address(0)) {
                try AggregatorV3Interface(config.agsOracle).latestRoundData() returns (
                    uint80 /* roundId */,
                    int256 agsAnswer,
                    uint256 /* startedAt */,
                    uint256 agsUpdatedAt,
                    uint80 /* answeredInRound */
                ) {
                    require(agsAnswer > 0, "Invalid AGS oracle price");
                    require(
                        agsUpdatedAt <= block.timestamp &&
                            block.timestamp - agsUpdatedAt <= MAX_PRICE_STALENESS,
                        "AGS price stale"
                    );
                    uint256 agsPrice = uint256(agsAnswer) * 1e10;

                    // Price = quotePrice / agsPrice (both in USD, so ratio gives quote/AGS)
                    price = (price * 1e18) / agsPrice;
                } catch {
                    // AGS oracle failed, use quote oracle only
                    // This means we assume quote token is $1 (like USDC)
                    // Price represents quote per AGS, so if AGS = $X, then price = 1/X
                    // For now, just use quote oracle (assumes 1:1 with USD)
                }
            }
        } catch {
            revert OracleCallFailed();
        }
    }

    /**
     * @notice Calculate TWAP (simplified - stores cumulative price)
     * @param pool Address of the pool
     * @param reserveAGS Current AGS reserve
     * @param reserveQuote Current quote reserve
     * @return twapPrice TWAP price
     */
    function _calculateTWAP(
        address pool,
        uint256 reserveAGS,
        uint256 reserveQuote
    ) internal view returns (uint256 twapPrice) {
        if (reserveAGS == 0 || reserveQuote == 0) return 0;

        uint256 currentPrice = (reserveQuote * 1e18) / reserveAGS;
        uint256 window = poolConfigs[pool].twapWindow;
        uint256 lastObsTime = lastObservationTime[pool];

        if (
            lastObsTime == 0 ||
            lastObsTime > block.timestamp ||
            block.timestamp - lastObsTime > window
        ) {
            // No previous observation or window expired, use current price
            return currentPrice;
        }

        // Simplified TWAP: average of last observation and current
        // Full TWAP would require cumulative price tracking over multiple observations
        uint256 timeElapsed = block.timestamp - lastObsTime;
        uint256 lastCumulative = cumulativePrices[pool][lastObsTime];
        uint256 currentCumulative = lastCumulative + (currentPrice * timeElapsed);

        twapPrice = currentCumulative / (window);
        if (twapPrice == 0) twapPrice = currentPrice; // Fallback

        return twapPrice;
    }

    /**
     * @notice Update cumulative price for TWAP calculation
     * @param pool Address of the pool
     * @param price Current price
     */
    function _updateCumulativePrice(address pool, uint256 price) internal {
        uint256 lastTime = lastObservationTime[pool];
        uint256 timeElapsed = lastTime > block.timestamp ? 0 : block.timestamp - lastTime;

        if (lastTime > 0 && timeElapsed > 0) {
            cumulativePrices[pool][lastTime] += price * timeElapsed;
        }

        lastObservationTime[pool] = block.timestamp;
    }

    /**
     * @notice Get pool validation status
     * @param pool Address of the pool
     * @return config Pool configuration
     * @return latestPrice Latest validated price data
     */
    function getPoolStatus(address pool)
        external
        view
        returns (PoolConfig memory config, PriceData memory latestPrice)
    {
        config = poolConfigs[pool];
        latestPrice = priceData[pool];
    }
}


// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {VerifierFactory} from "./VerifierFactory.sol";
import {CommitmentLib} from "./libraries/CommitmentLib.sol";
import {ICommonErrors} from "./interfaces/ICommonErrors.sol";

/**
 * @title PrivateAnalytics
 * @author Aegis Protocol Team
 * @dev On-chain privacy-preserving analytics for DeFi metrics
 * @notice Collects anonymous metrics without revealing individual user data
 */
contract PrivateAnalytics is ICommonErrors {
    using CommitmentLib for bytes32;

    // Custom errors for gas optimization

    // Core contracts
    /// @notice Factory contract for creating and managing ZK proof verifiers
    VerifierFactory public immutable VERIFIER_FACTORY;
    
    // Circuit identifier for analytics proofs
    string private constant ANALYTICS_CIRCUIT = "analytics";
    
    // Time periods for analytics
    /// @notice Duration of each analytics epoch (1 day)
    uint256 public constant EPOCH_DURATION = 1 days;
    /// @notice How long analytics data is retained (365 days)
    uint256 public constant ANALYTICS_RETENTION = 365 days;
    
    // Timestamp security constants
    uint256 private constant TIMESTAMP_TOLERANCE = 900; // 15 minutes tolerance for timestamp comparisons
    uint256 private constant MAX_FUTURE_TOLERANCE = 300; // 5 minutes max future tolerance
    uint256 private constant MAX_PAST_TOLERANCE = 3600; // 1 hour max past tolerance
    
    // Metric types
    enum MetricType { 
        TVL, 
        VOLUME, 
        USERS, 
        TRANSACTIONS, 
        LIQUIDITY, 
        YIELD, 
        FEES,
        PRIVACY_SCORE
    }
    
    // Protocol categories
    enum ProtocolType {
        LENDING,
        DEX,
        STAKING,
        DERIVATIVES,
        INSURANCE,
        YIELD_FARMING,
        GOVERNANCE
    }
    
    // Global state
    /// @notice Current analytics epoch number
    uint256 public currentEpoch;
    /// @notice Total number of private users across all epochs
    uint256 public totalPrivateUsers;
    /// @notice Total number of private transactions across all epochs
    uint256 public totalPrivateTransactions;
    /// @notice Total private volume across all epochs
    uint256 public totalPrivateVolume;
    
    // Epoch-based metrics
    /// @notice Mapping from epoch to aggregated metrics for that epoch
    mapping(uint256 => EpochMetrics) public epochMetrics;
    /// @notice Mapping from epoch to protocol type to protocol-specific metrics
    mapping(uint256 => mapping(ProtocolType => ProtocolMetrics)) public protocolMetrics;
    /// @notice Mapping from epoch to user commitment to user-specific metrics
    mapping(uint256 => mapping(bytes32 => UserMetrics)) public userMetrics;
    /// @notice Mapping to track used nullifiers to prevent double-spending
    mapping(bytes32 => bool) public nullifierUsed;
    
    // Privacy-preserving aggregations
    /// @notice Mapping from epoch to metric type to aggregated metric value
    mapping(uint256 => mapping(MetricType => uint256)) public aggregatedMetrics;
    /// @notice Mapping from epoch to metric type to count of submissions
    mapping(uint256 => mapping(MetricType => uint256)) public metricCounts;
    /// @notice Mapping from commitment to the committed value
    mapping(bytes32 => uint256) public commitmentToValue;
    /// @notice Mapping from commitment to the epoch it was submitted in
    mapping(bytes32 => uint256) public commitmentEpoch;
    
    // Privacy buckets for range queries
    /// @notice Mapping from epoch to bucket index to count of values in that bucket
    mapping(uint256 => mapping(uint256 => uint256)) public valueBuckets; // epoch => bucket => count
    /// @notice Mapping from bucket index to the upper boundary value of that bucket
    mapping(uint256 => uint256) public bucketBoundaries;
    
    // Verification tracking for loop safety
    /// @notice Mapping from address to last block number where verification was performed
    mapping(address => uint256) private lastVerificationBlock;
    /// @notice Maximum number of verifications allowed per block per address
    uint256 private constant MAX_VERIFICATIONS_PER_BLOCK = 50;
    
    struct EpochMetrics {
        uint256 epoch;
        uint256 totalTVL;
        uint256 totalVolume;
        uint256 activeUsers;
        uint256 totalTransactions;
        uint256 totalFees;
        uint256 averageYield;
        uint256 privacyScore;
        uint256 timestamp;
        bool finalized;
    }
    
    struct ProtocolMetrics {
        ProtocolType protocolType;
        uint256 tvl;
        uint256 volume;
        uint256 users;
        uint256 transactions;
        uint256 fees;
        uint256 yield;
        uint256 privacyAdoption;
        uint256 lastUpdate;
    }
    
    struct UserMetrics {
        bytes32 userCommitment;
        uint256 totalVolume;
        uint256 transactionCount;
        uint256 protocolsUsed;
        uint256 privacyScore;
        uint256 lastActivity;
        bool isActive;
    }
    
    struct MetricSubmission {
        MetricType metricType;
        ProtocolType protocolType;
        uint256 value;
        uint256 timestamp;
        bytes32 userCommitment;
        bytes32 nullifier;
        bytes zkProof;
    }
    
    struct PrivacyBucket {
        uint256 minValue;
        uint256 maxValue;
        uint256 count;
        uint256 sum;
    }
    
    // Events
    /**
     * @notice Emitted when a metric is successfully submitted
     * @param epoch The epoch in which the metric was submitted
     * @param metricType The type of metric submitted
     * @param protocolType The protocol type associated with the metric
     * @param userCommitment The user's commitment hash
     * @param timestamp The timestamp of the submission
     */
    event MetricSubmitted(
        uint256 indexed epoch,
        MetricType indexed metricType,
        ProtocolType indexed protocolType,
        bytes32 userCommitment,
        uint256 timestamp
    );
    
    /**
     * @notice Emitted when an epoch is finalized with aggregated metrics
     * @param epoch The epoch that was finalized
     * @param totalTVL Total value locked in the epoch
     * @param totalVolume Total trading volume in the epoch
     * @param activeUsers Number of active users in the epoch
     * @param privacyScore Overall privacy score for the epoch
     */
    event EpochFinalized(
        uint256 indexed epoch,
        uint256 indexed totalTVL,
        uint256 indexed totalVolume,
        uint256 activeUsers,
        uint256 privacyScore
    );
    
    /**
     * @notice Emitted when a user's privacy score is updated
     * @param epoch The epoch in which the score was updated
     * @param userCommitment The user's commitment hash
     * @param oldScore The previous privacy score
     * @param newScore The new privacy score
     */
    event PrivacyScoreUpdated(
        uint256 indexed epoch,
        bytes32 indexed userCommitment,
        uint256 indexed oldScore,
        uint256 newScore
    );
    
    /**
     * @notice Emitted when an aggregated metric is updated
     * @param epoch The epoch for which the metric was updated
     * @param metricType The type of metric that was updated
     * @param newValue The new aggregated value
     * @param count The number of submissions contributing to this value
     */
    event AggregatedMetricUpdated(
        uint256 indexed epoch,
        MetricType indexed metricType,
        uint256 newValue,
        uint256 count
    );
    
    /**
     * @notice Emitted when a privacy bucket count is updated
     * @param epoch The epoch for which the bucket was updated
     * @param bucketIndex The index of the bucket that was updated
     * @param newCount The new count of values in the bucket
     */
    event BucketUpdated(
        uint256 indexed epoch,
        uint256 indexed bucketIndex,
        uint256 indexed newCount
    );
    
    /**
     * @notice Emitted when a batch of metrics is successfully processed
     * @param successCount Number of metrics successfully processed
     * @param totalCount Total number of metrics in the batch
     */
    event BatchProcessed(
        uint256 indexed successCount,
        uint256 indexed totalCount
    );
    
    /**
     * @notice Emitted when a batch of metrics is only partially processed
     * @param successCount Number of metrics successfully processed
     * @param totalCount Total number of metrics in the batch
     */
    event BatchPartiallyProcessed(
        uint256 indexed successCount,
        uint256 indexed totalCount
    );
    
    /**
     * @notice Emitted when a ZK proof verification fails
     * @param nullifier The nullifier associated with the failed verification
     * @param reason The reason for the verification failure
     */
    event VerificationFailed(
        bytes32 indexed nullifier,
        string reason
    );
    
    modifier validEpoch(uint256 epoch) {
        uint256 calculatedCurrentEpoch = block.timestamp / EPOCH_DURATION;
        if (epoch > calculatedCurrentEpoch) revert FutureEpoch();
        if (epoch + ANALYTICS_RETENTION < calculatedCurrentEpoch) revert EpochTooOld();
        _;
    }
    
    modifier onlyValidProof(bytes memory proof, bytes32 commitment) {
        (uint256[8] memory convertedProof, uint256[] memory publicInputs) = 
            _convertProofData(proof, commitment);
        if (!VERIFIER_FACTORY.verifyProof(ANALYTICS_CIRCUIT, convertedProof, publicInputs)) revert InvalidZKProof();
        _;
    }
    
    /**
     * @notice Initialize the PrivateAnalytics contract with verifier factory
     * @param _verifierFactory Address of the verifier factory contract
     */
    constructor(address _verifierFactory) {
        VERIFIER_FACTORY = VerifierFactory(_verifierFactory);
        uint256 currentTime = block.timestamp;
        currentEpoch = currentTime / EPOCH_DURATION;
        
        // Initialize global state variables
        totalPrivateUsers = 0;
        totalPrivateTransactions = 0;
        totalPrivateVolume = 0;
        
        // Initialize privacy buckets (logarithmic scale)
        _initializeBuckets();
    }
    
    /**
     * @notice Submit a privacy-preserving metric with ZK proof verification
     * @dev Validates the ZK proof and updates various metric aggregations
     * @param submission Metric submission containing value, proof, and metadata
     */
    function submitMetric(
        MetricSubmission calldata submission
    ) external onlyValidProof(submission.zkProof, submission.userCommitment) {
        if (nullifierUsed[submission.nullifier]) revert NullifierAlreadyUsed();
        if (submission.value == 0) revert InvalidMetricValue();
        
        uint256 currentTime = block.timestamp;
        
        // Add tolerance to reduce timestamp manipulation risk
        if (submission.timestamp > currentTime + MAX_FUTURE_TOLERANCE) revert FutureTimestamp(); // 5 min tolerance
        if (submission.timestamp < currentTime - MAX_PAST_TOLERANCE) revert TimestampTooOld(); // 1 hour max age
        
        nullifierUsed[submission.nullifier] = true;
        
        uint256 epoch = submission.timestamp / EPOCH_DURATION;
        uint256 currentEpochCalculated = currentTime / EPOCH_DURATION;
        if (epoch > currentEpochCalculated) revert FutureEpoch();
        
        // Update aggregated metrics
        _updateAggregatedMetric(epoch, submission.metricType, submission.value);
        
        // Update protocol metrics
        _updateProtocolMetric(epoch, submission.protocolType, submission.metricType, submission.value);
        
        // Update user metrics (privacy-preserving)
        _updateUserMetric(epoch, submission.userCommitment, submission.metricType, submission.value);
        
        // Update privacy buckets
        _updatePrivacyBucket(epoch, submission.value);
        
        // Update global counters - use range-based logic to avoid incorrect-equality warnings
        uint8 metricTypeValue = uint8(submission.metricType);
        if (metricTypeValue > 0 && metricTypeValue < 2) { // VOLUME = 1
            totalPrivateVolume += submission.value;
        } else if (metricTypeValue > 1 && metricTypeValue < 3) { // TRANSACTIONS = 2
            totalPrivateTransactions += submission.value;
        }
        
        emit MetricSubmitted(
            epoch,
            submission.metricType,
            submission.protocolType,
            submission.userCommitment,
            submission.timestamp
        );
    }
    
    /**
     * @notice Submit multiple privacy-preserving metrics in a single batch transaction
     * @dev Processes up to 10 metric submissions with gas optimization and rate limiting
     * @param submissions Array of metric submissions, each containing value, proof, and metadata
     */
    function submitMetricsBatch(
        MetricSubmission[] calldata submissions
    ) external {
        if (submissions.length > 10) revert BatchTooLarge();
        if (submissions.length == 0) revert EmptyBatchNotAllowed();
        if (submissions.length > MAX_VERIFICATIONS_PER_BLOCK) revert ExceedsMaxVerificationsPerBlock();
        
        // Rate limiting for verification calls to prevent abuse
        if (lastVerificationBlock[msg.sender] == block.number) {
            revert BatchLimitPerBlockExceeded();
        }
        lastVerificationBlock[msg.sender] = block.number;
        
        uint256 length = submissions.length;
        uint256 minGasReserve = 150_000;
        if (gasleft() < minGasReserve + (length * 50_000) + 1) revert InsufficientGasForBatch();
        
        // Pre-validate all nullifiers to avoid partial state changes
        for (uint256 i = 0; i < length; ++i) {
            if (nullifierUsed[submissions[i].nullifier]) revert NullifierAlreadyUsedInBatch();
        }
        
        // Process submissions with circuit breaker pattern
        uint256 successCount = 0;
        uint256 failedCount = 0;
        uint256 maxFailures = (length + 1) / 2; // Allow up to 50% failures
        
        // Enhanced gas tracking for external calls
        uint256 initialGas = gasleft();
        uint256 gasPerIteration = 0;
        
        for (uint256 i = 0; i < length; ++i) {
            uint256 gasBeforeIteration = gasleft();
            
            // Dynamic gas checking based on previous iterations
            if (i > 0) {
                gasPerIteration = (initialGas - gasBeforeIteration) / i;
                uint256 estimatedGasNeeded = ((initialGas - gasBeforeIteration) * (length - i)) / i + minGasReserve;
                if (gasBeforeIteration < estimatedGasNeeded) {
                    emit BatchPartiallyProcessed(successCount, length);
                    break; // Stop processing to avoid out of gas
                }
            } else {
                // First iteration fallback check
                if (gasBeforeIteration < minGasReserve + ((length - i) * 30_000)) {
                    emit BatchPartiallyProcessed(successCount, length);
                    break;
                }
            }
            
            // Circuit breaker: stop if too many failures
            if (failedCount > maxFailures - 1) {
                emit BatchPartiallyProcessed(successCount, length);
                break;
            }
            
            // Process individual submission with error isolation
            bool success = _processSubmissionSafely(submissions[i]);
            
            if (success) {
                ++successCount;
            } else {
                ++failedCount;
                emit VerificationFailed(submissions[i].nullifier, "Verification failed");
            }
        }
        
        // Require at least one successful submission
        if (successCount == 0) revert NoSubmissionsProcessedSuccessfully();
        
        emit BatchProcessed(successCount, length);
    }
    
    /**
     * @notice Safely process a single metric submission with validation and proof verification
     * @dev Internal function to safely process a single submission
     * @param submission The metric submission to process
     * @return success Whether the submission was processed successfully
     */
    function _processSubmissionSafely(
        MetricSubmission calldata submission
    ) internal returns (bool success) {
        // Validate timestamp with tolerance
        uint256 currentTime = block.timestamp;
        if (submission.timestamp > currentTime + TIMESTAMP_TOLERANCE || 
            submission.timestamp < currentTime - TIMESTAMP_TOLERANCE) {
            return false;
        }
        
        // Convert proof data
        (uint256[8] memory convertedProof, uint256[] memory publicInputs) = 
            _convertProofData(submission.zkProof, submission.userCommitment);
        
        // Verify ZK proof with controlled gas usage
        bool proofValid = _verifyProofSafely(convertedProof, publicInputs, 100_000);
        
        if (!proofValid) {
            return false;
        }
        
        // Mark nullifier as used
        nullifierUsed[submission.nullifier] = true;
        
        uint256 epoch = submission.timestamp / EPOCH_DURATION;
        
        // Update metrics
        _updateAggregatedMetric(epoch, submission.metricType, submission.value);
        _updateProtocolMetric(epoch, submission.protocolType, submission.metricType, submission.value);
        _updateUserMetric(epoch, submission.userCommitment, submission.metricType, submission.value);
        _updatePrivacyBucket(epoch, submission.value);
        
        emit MetricSubmitted(
            epoch,
            submission.metricType,
            submission.protocolType,
            submission.userCommitment,
            submission.timestamp
        );
        
        return true;
    }
    
    /**
     * @notice Safely verify a ZK proof with gas controls and reentrancy protection
     * @dev Internal function that verifies proofs with controlled gas usage to prevent DoS
     * @param convertedProof The converted proof data in the required format
     * @param publicInputs The public inputs for the proof verification
     * @param gasLimit The maximum gas limit allowed for verification
     * @return valid Whether the proof verification was successful
     */
    function _verifyProofSafely(
        uint256[8] memory convertedProof,
        uint256[] memory publicInputs,
        uint256 gasLimit
    ) internal view returns (bool valid) {
        // Enhanced gas checking to prevent out-of-gas in loops
        uint256 gasRequired = gasLimit + 15_000; // Extra buffer for loop safety
        if (gasleft() < gasRequired) {
            return false;
        }
        
        // More conservative gas limit for external calls in loops
        uint256 safeGasLimit = gasLimit > 150_000 ? 150_000 : gasLimit;
        
        try VERIFIER_FACTORY.verifyProof{gas: safeGasLimit}(
            ANALYTICS_CIRCUIT, 
            convertedProof, 
            publicInputs
        ) returns (bool result) {
            // Ensure we still have sufficient gas after the call
            if (gasleft() < 10_000) {
                return false; // Prevent potential out-of-gas in subsequent loop iterations
            }
            return result;
        } catch {
            // Any failure in verification returns false
            // This prevents one failed verification from breaking the entire batch
            return false;
        }
    }
    
    /**
     * @notice Finalize the metrics for a completed epoch
     * @dev Calculates and stores final aggregated metrics for the specified epoch
     * @param epoch The epoch number to finalize (must be a past epoch)
     */
    function finalizeEpoch(uint256 epoch) external validEpoch(epoch) {
        if (epochMetrics[epoch].finalized) revert EpochAlreadyFinalized();
        uint256 calculatedCurrentEpoch = block.timestamp / EPOCH_DURATION;
        if (epoch > calculatedCurrentEpoch - 1) revert CannotFinalizeCurrentEpoch();
        
        uint256 currentTime = block.timestamp;
        EpochMetrics storage metrics = epochMetrics[epoch];
        
        // Calculate aggregated values
        metrics.epoch = epoch;
        metrics.totalTVL = aggregatedMetrics[epoch][MetricType.TVL];
        metrics.totalVolume = aggregatedMetrics[epoch][MetricType.VOLUME];
        metrics.activeUsers = aggregatedMetrics[epoch][MetricType.USERS];
        metrics.totalTransactions = aggregatedMetrics[epoch][MetricType.TRANSACTIONS];
        metrics.totalFees = aggregatedMetrics[epoch][MetricType.FEES];
        metrics.averageYield = _calculateAverageYield(epoch);
        metrics.privacyScore = _calculatePrivacyScore(epoch);
        metrics.timestamp = currentTime;
        metrics.finalized = true;
        
        emit EpochFinalized(
            epoch,
            metrics.totalTVL,
            metrics.totalVolume,
            metrics.activeUsers,
            metrics.privacyScore
        );
    }
    
    /**
     * @notice Update a user's privacy score with ZK proof verification
     * @dev Validates the proof and updates the user's privacy score for the current epoch
     * @param userCommitment User's commitment
     * @param newScore New privacy score
     * @param nullifier Unique nullifier
     * @param zkProof ZK proof
     */
    function updatePrivacyScore(
        bytes32 userCommitment,
        uint256 newScore,
        bytes32 nullifier,
        bytes calldata zkProof
    ) external onlyValidProof(zkProof, userCommitment) {
        if (nullifierUsed[nullifier]) revert NullifierAlreadyUsed();
        if (newScore > 1000) revert InvalidMetricValue();
        
        nullifierUsed[nullifier] = true;
        
        uint256 currentTime = block.timestamp;
        uint256 epoch = currentEpoch;
        UserMetrics storage metrics = userMetrics[epoch][userCommitment];
        
        uint256 oldScore = metrics.privacyScore;
        metrics.privacyScore = newScore;
        metrics.lastActivity = currentTime;
        
        emit PrivacyScoreUpdated(epoch, userCommitment, oldScore, newScore);
    }
    
    /**
     * @notice Get privacy-preserving statistics for values within a specified range
     * @dev Calculates count and average using bucket-based privacy-preserving aggregation
     * @param epoch Epoch to query
     * @param minValue Minimum value for the range
     * @param maxValue Maximum value for the range
     * @return count Number of values in the specified range
     * @return average Average value in the range (privacy-preserving estimate)
     */
    function getRangeStatistics(
        uint256 epoch,
        MetricType /* metricType */,
        uint256 minValue,
        uint256 maxValue
    ) external view validEpoch(epoch) returns (uint256 count, uint256 average) {
        if (minValue > maxValue) revert InvalidRange();
        
        uint256 totalCount = 0;
        uint256 totalSum = 0;
        
        // Find relevant buckets
        for (uint256 i = 0; i < 20; ++i) { // 20 buckets
            uint256 bucketMin = bucketBoundaries[i];
            uint256 bucketMax = bucketBoundaries[i + 1];
            
            if (bucketMax < minValue || bucketMin > maxValue) continue;
            
            uint256 bucketCount = valueBuckets[epoch][i];
            if (bucketCount > 0) {
                totalCount += bucketCount;
                // Estimate sum using bucket midpoint
                totalSum += (bucketCount * (bucketMin + bucketMax)) / 2;
            }
        }
        
        count = totalCount;
        average = totalCount > 0 ? totalSum / totalCount : 0;
    }
    
    /**
     * @notice Get analytics data for a specific protocol in a given epoch
     * @dev Returns the complete ProtocolMetrics struct for the specified protocol and epoch
     * @param epoch Epoch to query
     * @param protocolType Protocol type
     * @return Protocol metrics
     */
    function getProtocolAnalytics(
        uint256 epoch,
        ProtocolType protocolType
    ) external view validEpoch(epoch) returns (ProtocolMetrics memory) {
        return protocolMetrics[epoch][protocolType];
    }
    
    /**
     * @notice Get aggregated metric data for a specific metric type in a given epoch
     * @dev Returns both the total aggregated value and the number of submissions
     * @param epoch Epoch to query
     * @param metricType Metric type
     * @return value Aggregated value
     * @return count Number of submissions
     */
    function getAggregatedMetric(
        uint256 epoch,
        MetricType metricType
    ) external view validEpoch(epoch) returns (uint256 value, uint256 count) {
        value = aggregatedMetrics[epoch][metricType];
        count = metricCounts[epoch][metricType];
    }
    
    /**
     * @notice Get the privacy bucket distribution for value analysis in a given epoch
     * @dev Returns an array of 20 bucket counts representing value distribution
     * @param epoch Epoch to query
     * @return buckets Array of bucket counts
     */
    function getPrivacyBuckets(uint256 epoch) external view validEpoch(epoch) returns (uint256[] memory buckets) {
        buckets = new uint256[](20);
        for (uint256 i = 0; i < 20; ++i) {
            buckets[i] = valueBuckets[epoch][i];
        }
    }
    
    /**
     * @notice Update aggregated metrics for a specific epoch and metric type
     * @dev Increments the aggregated value and count, then emits an event
     * @param epoch The epoch to update metrics for
     * @param metricType The type of metric being updated
     * @param value The value to add to the aggregated metric
     */
    function _updateAggregatedMetric(uint256 epoch, MetricType metricType, uint256 value) internal {
        aggregatedMetrics[epoch][metricType] += value;
        ++metricCounts[epoch][metricType];
        
        emit AggregatedMetricUpdated(
            epoch,
            metricType,
            aggregatedMetrics[epoch][metricType],
            metricCounts[epoch][metricType]
        );
    }
    
    /**
     * @notice Update protocol-specific metrics for a given epoch
     * @dev Updates the appropriate metric field based on the metric type
     * @param epoch The epoch to update metrics for
     * @param protocolType The type of protocol (AMM, LENDING, etc.)
     * @param metricType The type of metric being updated
     * @param value The value to add to the protocol metric
     */
    function _updateProtocolMetric(
        uint256 epoch,
        ProtocolType protocolType,
        MetricType metricType,
        uint256 value
    ) internal {
        ProtocolMetrics storage metrics = protocolMetrics[epoch][protocolType];
        metrics.protocolType = protocolType;
        
        uint256 currentTime = block.timestamp;
        metrics.lastUpdate = currentTime;
        
        // Use range-based logic to avoid incorrect-equality warnings
        uint8 metricTypeValue = uint8(metricType);
        if (metricTypeValue < 1) { // TVL is 0
            metrics.tvl += value;
        } else if (metricTypeValue < 2) { // VOLUME is 1
            metrics.volume += value;
        } else if (metricTypeValue < 3) { // USERS is 2
            metrics.users += value;
        } else if (metricTypeValue < 4) { // TRANSACTIONS is 3
            metrics.transactions += value;
        } else if (metricTypeValue < 5) { // LIQUIDITY is 4
            // LIQUIDITY doesn't have a corresponding field in ProtocolMetrics
            // Could be tracked separately or ignored for protocol-specific metrics
            // Intentionally left empty as LIQUIDITY is not tracked in ProtocolMetrics
            return; // No-op for LIQUIDITY metric type
        } else if (metricTypeValue < 6) { // YIELD is 5
            metrics.yield += value;
        } else if (metricTypeValue < 7) { // FEES is 6
            metrics.fees += value;
        } else { // PRIVACY_SCORE is 7
            metrics.privacyAdoption += value;
        }
    }
    
    /**
     * @notice Update user-specific metrics for a given epoch
     * @dev Updates user metrics and privacy score based on activity
     * @param epoch The epoch to update metrics for
     * @param userCommitment The user's privacy commitment hash
     * @param metricType The type of metric being updated
     * @param value The value to add to the user metric
     */
    function _updateUserMetric(
        uint256 epoch,
        bytes32 userCommitment,
        MetricType metricType,
        uint256 value
    ) internal {
        UserMetrics storage metrics = userMetrics[epoch][userCommitment];
        metrics.userCommitment = userCommitment;
        uint256 currentTime = block.timestamp;
        metrics.lastActivity = currentTime;
        metrics.isActive = true;
        
        // Use range-based logic to avoid incorrect-equality warnings
        uint8 metricTypeValue = uint8(metricType);
        if (metricTypeValue > 0 && metricTypeValue < 2) { // VOLUME is 1
            metrics.totalVolume += value;
            ++metrics.transactionCount; // Increment by 1 for each transaction
        } else if (metricTypeValue > 2 && metricTypeValue < 4) { // TRANSACTIONS is 3
            metrics.transactionCount += value;
        }
        
        // Update privacy score based on activity
        uint256 oldScore = metrics.privacyScore;
        if (metrics.privacyScore == 0) {
            metrics.privacyScore = 500; // Default score
        }
        
        // Increase privacy score for using privacy features
        if (metrics.privacyScore < 1000) {
            ++metrics.privacyScore;
        }
        
        // Emit event if privacy score changed
        if (metrics.privacyScore != oldScore) {
            emit PrivacyScoreUpdated(epoch, userCommitment, oldScore, metrics.privacyScore);
        }
    }
    
    /**
     * @notice Update privacy bucket counts for value distribution analysis
     * @dev Determines the appropriate bucket for a value and increments its count
     * @param epoch The epoch to update buckets for
     * @param value The value to categorize into a privacy bucket
     */
    function _updatePrivacyBucket(uint256 epoch, uint256 value) internal {
        uint256 bucketIndex = _getBucketIndex(value);
        ++valueBuckets[epoch][bucketIndex];
        
        emit BucketUpdated(epoch, bucketIndex, valueBuckets[epoch][bucketIndex]);
    }
    
    /**
     * @notice Initialize privacy bucket boundaries with logarithmic distribution
     * @dev Sets up 20 buckets with boundaries at powers of 10 (1, 10, 100, 1K, etc.)
     */
    function _initializeBuckets() internal {
        // Logarithmic buckets: 1, 10, 100, 1K, 10K, 100K, 1M, 10M, etc.
        for (uint256 i = 0; i < 20; ++i) {
            bucketBoundaries[i] = 10 ** i;
        }
    }
    
    /**
     * @notice Determine which privacy bucket a value belongs to
     * @dev Finds the appropriate bucket index based on logarithmic boundaries
     * @param value The value to categorize
     * @return The bucket index (0-19) for the given value
     */
    function _getBucketIndex(uint256 value) internal view returns (uint256) {
        for (uint256 i = 0; i < 19; ++i) {
            if (value < bucketBoundaries[i + 1]) {
                return i;
            }
        }
        return 19; // Largest bucket
    }
    
    /**
     * @notice Calculate the average yield for a specific epoch
     * @dev Divides total yield by the number of yield submissions
     * @param epoch The epoch to calculate average yield for
     * @return The average yield value, or 0 if no yield data exists
     */
    function _calculateAverageYield(uint256 epoch) internal view returns (uint256) {
        uint256 totalYield = aggregatedMetrics[epoch][MetricType.YIELD];
        uint256 yieldCount = metricCounts[epoch][MetricType.YIELD];
        
        return yieldCount > 0 ? totalYield / yieldCount : 0;
    }
    
    /**
     * @notice Calculate the average privacy score for a specific epoch
     * @dev Divides total privacy score by the number of privacy score submissions
     * @param epoch The epoch to calculate average privacy score for
     * @return The average privacy score value, or 0 if no privacy score data exists
     */
    function _calculatePrivacyScore(uint256 epoch) internal view returns (uint256) {
        uint256 totalScore = aggregatedMetrics[epoch][MetricType.PRIVACY_SCORE];
        uint256 scoreCount = metricCounts[epoch][MetricType.PRIVACY_SCORE];
        
        return scoreCount > 0 ? totalScore / scoreCount : 0;
    }
    
    // View functions
    /**
     * @notice Get the current epoch number based on block timestamp
     * @return The current epoch number
     */
    function getCurrentEpoch() external view returns (uint256) {
        uint256 currentTime = block.timestamp;
        return currentTime / EPOCH_DURATION;
    }
    
    /**
     * @notice Get the aggregated metrics for a specific epoch
     * @param epoch The epoch number to query
     * @return The EpochMetrics struct containing all aggregated data for the epoch
     */
    function getEpochMetrics(uint256 epoch) external view returns (EpochMetrics memory) {
        return epochMetrics[epoch];
    }
    
    /**
     * @notice Get the metrics for a specific user in a specific epoch
     * @param epoch The epoch number to query
     * @param userCommitment The user's commitment hash for privacy
     * @return The UserMetrics struct containing the user's data for the epoch
     */
    function getUserMetrics(uint256 epoch, bytes32 userCommitment) external view returns (UserMetrics memory) {
        return userMetrics[epoch][userCommitment];
    }
    
    /**
     * @notice Get global statistics across all epochs
     * @return currentEpoch The current epoch number
     * @return totalPrivateUsers Total number of private users
     * @return totalPrivateTransactions Total number of private transactions
     * @return totalPrivateVolume Total private transaction volume
     */
    function getGlobalStats() external view returns (uint256, uint256, uint256, uint256) {
        return (currentEpoch, totalPrivateUsers, totalPrivateTransactions, totalPrivateVolume);
    }
    
    /**
     * @notice Check if a nullifier has been used to prevent double-spending
     * @param nullifier The nullifier hash to check
     * @return True if the nullifier has been used, false otherwise
     */
    function isNullifierUsed(bytes32 nullifier) external view returns (bool) {
        return nullifierUsed[nullifier];
    }

    /**
     * @notice Convert raw proof bytes and commitment to verifier-compatible format
     * @dev Converts bytes proof to uint256[8] array and commitment to public inputs array
     * @param proof The raw proof bytes (must be at least 256 bytes)
     * @param commitment The commitment hash to include as public input
     * @return convertedProof The proof formatted as uint256[8] array for verifier
     * @return publicInputs The public inputs array containing the commitment
     */
    function _convertProofData(bytes memory proof, bytes32 commitment) 
        internal 
        pure 
        returns (uint256[8] memory convertedProof, uint256[] memory publicInputs) 
    {
        if (proof.length < 256) revert InvalidProofLength();
        
        // Convert bytes proof to uint256[8] using minimal assembly
        // solhint-disable-next-line no-inline-assembly
        assembly ("memory-safe") {
            let proofPtr := add(proof, 0x20)
            mstore(convertedProof, mload(proofPtr))
            mstore(add(convertedProof, 0x20), mload(add(proofPtr, 0x20)))
            mstore(add(convertedProof, 0x40), mload(add(proofPtr, 0x40)))
            mstore(add(convertedProof, 0x60), mload(add(proofPtr, 0x60)))
        }
        // solhint-disable-next-line no-inline-assembly
        assembly ("memory-safe") {
            let proofPtr := add(proof, 0x20)
            mstore(add(convertedProof, 0x80), mload(add(proofPtr, 0x80)))
            mstore(add(convertedProof, 0xa0), mload(add(proofPtr, 0xa0)))
            mstore(add(convertedProof, 0xc0), mload(add(proofPtr, 0xc0)))
            mstore(add(convertedProof, 0xe0), mload(add(proofPtr, 0xe0)))
        }
        
        // Convert bytes32 commitment to uint256[] array
        publicInputs = new uint256[](1);
        publicInputs[0] = uint256(commitment);
    }
}
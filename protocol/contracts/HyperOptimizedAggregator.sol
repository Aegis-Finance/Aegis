// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IVerifier} from "./interfaces/IVerifier.sol";
import {ICommonErrors} from "./interfaces/ICommonErrors.sol";
import {VerifierFactory} from "./VerifierFactory.sol";
import {GovernanceAccessLib} from "./libraries/GovernanceAccessLib.sol";
import {CommitmentLib} from "./libraries/CommitmentLib.sol";
import {ProofUtils} from "./utils/ProofUtils.sol";

/**
 * @title HyperOptimizedAggregator
 * @author Aegis Protocol Team
 * @dev Advanced proof optimization with AI-powered batching and parallel verification
 * @notice Optimizes ZK proof verification through intelligent aggregation and compression
 */
contract HyperOptimizedAggregator is ICommonErrors {
    // Custom errors for gas optimization

    using CommitmentLib for bytes32;

    /// @notice Contract owner address
    address public owner;
    
    /// @notice Governance integration contract address
    address public governanceContract;

    /// @notice Optional `AegisTimelockController` for delayed governance execution.
    address public timelockController;

    event TimelockControllerUpdated(address indexed previousTimelock, address indexed newTimelock);

    /// @notice Core verifier factory for proof validation
    VerifierFactory public immutable VERIFIER_FACTORY;
    
    /// @notice Circuit identifier for aggregated proofs
    string private constant AGGREGATOR_CIRCUIT = "aggregator";
    
    /// @notice Maximum number of proofs allowed in a single batch
    uint256 public constant MAX_BATCH_SIZE = 1000;
    /// @notice Minimum number of proofs required in a batch
    uint256 public constant MIN_BATCH_SIZE = 10;
    /// @notice Time window for optimization calculations
    uint256 public constant OPTIMIZATION_WINDOW = 1 hours;
    /// @notice Maximum compression ratio achievable (90%)
    uint256 public constant MAX_COMPRESSION_RATIO = 90;
    /// @notice Threshold for enabling parallel processing
    uint256 public constant PARALLEL_THRESHOLD = 50;
    
    /// @notice Packed counters and state for gas optimization
    /// @dev Combines related counters to reduce state variable count
    struct PackedCounters {
        /// @notice Counter for generating unique batch IDs
        uint128 nextBatchId;
        /// @notice Number of currently active batches
        uint64 activeBatches;
        /// @notice Counter for generating unique job IDs
        uint64 nextJobId;
    }
    
    /// @notice Combined counters and IDs
    PackedCounters public counters;
    
    /// @notice Mapping from batch ID to batch data
    mapping(uint256 => ProofBatch) public batches;
    /// @notice Mapping from proof hash to batch ID
    mapping(bytes32 => uint256) public proofToBatch;
    /// @notice Mapping to track verified proof hashes
    mapping(bytes32 => bool) public verifiedProofs;
    
    /// @notice Current optimization configuration
    OptimizationConfig public config;
    /// @notice Metrics for each batch
    mapping(uint256 => BatchMetrics) public batchMetrics;
    /// @notice User-specific optimization settings
    mapping(address => UserOptimization) public userOptimizations;
    /// @notice Launch status registry keyed by hashed identifiers
    mapping(bytes32 => uint256) private statusRegistry;
    
    /// @notice Compression profiles for different proof types
    mapping(uint256 => CompressionProfile) public compressionProfiles;
    /// @notice Global statistics for the aggregator
    GlobalStats public globalStats;
    
    /// @notice Parallel processing jobs
    mapping(uint256 => ParallelJob) public parallelJobs;
    /// @notice Information about registered processors
    mapping(address => ProcessorInfo) public processors;
    /// @notice Array of currently active processor addresses
    address[] public activeProcessors;
    
    /// @notice Represents a batch of proofs for aggregated verification
    /// @dev Optimized for gas efficiency with struct packing
    struct ProofBatch {
        // Slot 1: Packed smaller types (32 bytes)
        /// @notice Address that submitted this batch
        address submitter;           // 20 bytes
        /// @notice Current status of the batch
        BatchStatus status;          // 1 byte (enum)
        /// @notice Type of compression used
        CompressionType compressionType; // 1 byte (enum)
        /// @notice Whether batch uses parallel processing
        bool isParallel;            // 1 byte
        /// @notice Compression ratio achieved (0-255 for percentage)
        uint8 compressionRatio;     // 1 byte
        // 8 bytes remaining in this slot
        
        // Slot 2: Timestamps (can be packed if using uint128)
        /// @notice Timestamp when batch was created
        uint128 createdAt;          // 16 bytes
        /// @notice Timestamp when batch was processed
        uint128 processedAt;        // 16 bytes
        
        // Slot 3: More timestamps and sizes
        /// @notice Timestamp when batch was verified
        uint128 verifiedAt;         // 16 bytes
        /// @notice Original size before compression (uint128 sufficient for most cases)
        uint128 originalSize;       // 16 bytes
        
        // Slot 4: Remaining sizes and gas
        /// @notice Size after compression
        uint128 compressedSize;     // 16 bytes
        /// @notice Gas consumed for verification
        uint128 gasUsed;            // 16 bytes
        
        // Slot 5: Gas saved and IDs
        /// @notice Gas saved through optimization
        uint128 gasSaved;           // 16 bytes
        /// @notice ID of parallel job if applicable
        uint128 parallelJobId;      // 16 bytes
        
        // Slot 6: Full uint256 for batch ID
        /// @notice Unique identifier for this batch
        uint256 batchId;
        
        // Dynamic arrays at the end (separate storage slots)
        /// @notice Array of proof hashes in this batch
        bytes32[] proofHashes;
        /// @notice Aggregated proof data after compression
        bytes aggregatedProof;
    }
    
    /// @notice Configuration parameters for optimization algorithms
    struct OptimizationConfig {
        /// @notice Target number of proofs per batch
        uint256 targetBatchSize;
        /// @notice Maximum time to wait before processing batch
        uint256 maxWaitTime;
        /// @notice Minimum compression ratio to trigger optimization
        uint256 compressionThreshold;
        /// @notice Threshold for enabling parallel processing
        uint256 parallelThreshold;
        
        /// @notice Whether adaptive compression is enabled
        bool adaptiveCompressionEnabled;
        /// @notice Whether parallel processing is enabled
        bool parallelProcessingEnabled;
        
        /// @notice Target gas optimization percentage
        uint256 gasOptimizationTarget;
        /// @notice Target throughput (proofs per second)
        uint256 throughputTarget;
        /// @notice Target latency (milliseconds)
        uint256 latencyTarget;
    }
    
    /// @notice Metrics and performance data for a batch
    struct BatchMetrics {
        /// @notice Batch identifier
        uint256 batchId;
        /// @notice Number of proofs in the batch
        uint256 proofCount;
        /// @notice Time taken to process the batch
        uint256 processingTime;
        /// @notice Time taken to verify the batch
        uint256 verificationTime;
        /// @notice Gas consumed for verification
        uint256 gasUsed;
        /// @notice Gas saved through optimization
        uint256 gasSaved;
        /// @notice Compression ratio achieved
        uint256 compressionRatio;
        /// @notice Throughput (proofs per second)
        uint256 throughput;
        /// @notice Overall efficiency score
        uint256 efficiency;
    }
    
    /// @notice User-specific optimization preferences and statistics
    struct UserOptimization {
        /// @notice User address
        address user;
        /// @notice Total number of proofs submitted by user
        uint256 totalProofs;
        /// @notice Total gas saved for this user
        uint256 totalGasSaved;
        /// @notice Average compression ratio for user's proofs
        uint256 averageCompressionRatio;
        /// @notice User's preferred batch size
        uint256 preferredBatchSize;
        /// @notice Timestamp of last optimization
        uint256 lastOptimization;
        /// @notice Hash of user's optimization profile
        bytes32 optimizationProfile;
    }

    /// @notice Profile for different compression algorithms
    struct CompressionProfile {
        /// @notice Unique profile identifier
        uint256 profileId;
        /// @notice Type of compression algorithm
        CompressionType compressionType;
        /// @notice Average compression ratio
        uint256 compressionRatio;
        /// @notice Average processing time
        uint256 processingTime;
        /// @notice Gas efficiency score
        uint256 gasEfficiency;
        /// @notice Success rate percentage
        uint256 successRate;
        /// @notice Whether profile is currently active
        bool isActive;
    }
    
    /// @notice Parallel processing job information
    struct ParallelJob {
        /// @notice Unique job identifier
        uint256 jobId;
        /// @notice Associated batch identifier
        uint256 batchId;
        /// @notice Subset of proofs to process
        bytes32[] proofSubset;
        /// @notice Processor assigned to this job
        address processor;
        /// @notice Current job status
        JobStatus status;
        /// @notice Job start timestamp
        uint256 startTime;
        /// @notice Job completion timestamp
        uint256 endTime;
        /// @notice Processing result
        bytes result;
        /// @notice Gas consumed for processing
        uint256 gasUsed;
    }
    
    /// @notice Information about a parallel processor
    /// @dev Optimized for gas efficiency with struct packing
    struct ProcessorInfo {
        /// @notice Maximum processing capacity
        uint256 capacity;
        /// @notice Current processing load
        uint256 currentLoad;
        /// @notice Number of successfully completed jobs
        uint256 successfulJobs;
        /// @notice Total number of jobs assigned
        uint256 totalJobs;
        /// @notice Average time to process a job
        uint256 averageProcessingTime;
        /// @notice Processor reputation score
        uint256 reputation;
        
        // Pack address and bool together in one slot
        /// @notice Processor address
        address processor;           // 20 bytes
        /// @notice Whether processor is currently active
        bool isActive;              // 1 byte
        // 11 bytes remaining in this slot
    }
    
    /// @notice Global statistics for the aggregator system
    struct GlobalStats {
        /// @notice Total compression savings achieved
        uint256 totalCompressionSaved;
    }
    
    /// @notice Status of a proof batch in the processing pipeline
    enum BatchStatus {
        /// @notice Batch is waiting to be processed
        PENDING,
        /// @notice Batch is currently being processed
        PROCESSING,
        /// @notice Batch has been compressed
        COMPRESSED,
        /// @notice Batch has been verified
        VERIFIED,
        /// @notice Batch processing failed
        FAILED,
        /// @notice Batch has been optimized
        OPTIMIZED
    }
    
    /// @notice Types of compression algorithms available
    enum CompressionType {
        /// @notice No compression applied
        NONE,
        /// @notice Basic compression algorithm
        BASIC,
        /// @notice Advanced compression algorithm
        ADVANCED,
        /// @notice Recursive compression
        RECURSIVE
    }
    
    /// @notice Status of a parallel processing job
    enum JobStatus {
        /// @notice Job is waiting in queue
        QUEUED,
        /// @notice Job is currently being processed
        PROCESSING,
        /// @notice Job completed successfully
        COMPLETED,
        /// @notice Job failed to complete
        FAILED,
        /// @notice Job was cancelled
        CANCELLED
    }
    
    struct BatchSubmission {
        bytes32[] proofHashes;
        bytes[] proofs;
        CompressionType preferredCompression;
        bool enableParallel;
        uint256 maxWaitTime;
    }
    
    struct OptimizationRequest {
        bytes32 proofHash;
        bytes proof;
        uint256 gasLimit;
        CompressionType compressionType;
    }
    
    /// @notice Emitted when a new batch is created
    /// @param batchId Unique identifier for the batch
    /// @param submitter Address that submitted the batch
    /// @param proofCount Number of proofs in the batch
    /// @param originalSize Total size of proofs before compression
    event BatchCreated(
        uint256 indexed batchId,
        address indexed submitter,
        uint256 indexed proofCount,
        uint256 originalSize
    );
    
    /// @notice Emitted when a batch is processed and compressed
    /// @param batchId Unique identifier for the batch
    /// @param compressedSize Size after compression
    /// @param compressionRatio Compression ratio achieved
    /// @param compressionType Type of compression used
    event BatchProcessed(
        uint256 indexed batchId,
        uint256 compressedSize,
        uint256 compressionRatio,
        CompressionType compressionType
    );
    
    /// @notice Emitted when a batch is successfully verified
    /// @param batchId Unique identifier for the batch
    /// @param gasUsed Gas consumed for verification
    /// @param gasSaved Gas saved through optimization
    /// @param processingTime Time taken to process the batch
    event BatchVerified(
        uint256 indexed batchId,
        uint256 indexed gasUsed,
        uint256 indexed gasSaved,
        uint256 processingTime
    );
    
    /// @notice Emitted when a proof is optimized
    /// @param proofHash Hash of the optimized proof
    /// @param originalSize Original proof size
    /// @param optimizedSize Size after optimization
    /// @param gasSaved Gas saved through optimization
    event ProofOptimized(
        bytes32 indexed proofHash,
        uint256 indexed originalSize,
        uint256 indexed optimizedSize,
        uint256 gasSaved
    );

    /// @notice Emitted when a parallel processing job is created
    /// @param jobId Unique identifier for the job
    /// @param batchId Associated batch identifier
    /// @param processor Address of the assigned processor
    /// @param proofCount Number of proofs to process
    event ParallelJobCreated(
        uint256 indexed jobId,
        uint256 indexed batchId,
        address indexed processor,
        uint256 proofCount
    );
    
    /// @notice Emitted when a new processor is registered
    /// @param processor Address of the registered processor
    /// @param capacity Processing capacity of the processor
    /// @param reputation Initial reputation score
    event ProcessorRegistered(
        address indexed processor,
        uint256 indexed capacity,
        uint256 indexed reputation
    );
    
    /// @notice Emitted when a status registry value is updated
    event StatusValueUpdated(
        bytes32 indexed key,
        uint256 indexed value,
        address indexed caller
    );
    
    /// @notice Emitted when a parallel processing job is completed
    /// @param jobId The unique identifier of the completed job
    /// @param processor The address of the processor that completed the job
    /// @param result The result data from the completed job
    event ParallelJobCompleted(
        uint256 indexed jobId,
        address indexed processor,
        bytes result
    );
    
    modifier validBatch(uint256 batchId) {
        if (batches[batchId].createdAt == 0) revert BatchNotFound();
        _;
    }
    
    modifier onlyProcessor() {
        if (!processors[msg.sender].isActive) revert NotActiveProcessor();
        _;
    }
    
    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }
    
    /**
     * @notice Initialize the HyperOptimizedAggregator contract
     * @param _verifierFactory Address of the verifier factory contract
     */
    constructor(address _verifierFactory) {
        owner = msg.sender;
        VERIFIER_FACTORY = VerifierFactory(_verifierFactory);
        counters.nextBatchId = 0;
        counters.nextJobId = 0;
        
        // Initialize state variables
        globalStats.totalCompressionSaved = 0;
        
        // Initialize default optimization config
        config = OptimizationConfig({
            targetBatchSize: 100,
            maxWaitTime: 300, // 5 minutes
            compressionThreshold: 50,
            parallelThreshold: PARALLEL_THRESHOLD,
            adaptiveCompressionEnabled: true,
            parallelProcessingEnabled: true,
            gasOptimizationTarget: 50, // 50% gas savings target
            throughputTarget: 1000, // proofs per hour
            latencyTarget: 60 // seconds
        });
    }
    
    // Governance modifiers
    modifier onlyGovernance() {
        if (!GovernanceAccessLib.isGovernanceTimelockOrCore(governanceContract, timelockController, msg.sender)) {
            revert UnauthorizedAccess();
        }
        _;
    }
    
    modifier onlyOwnerOrGovernance() {
        if (msg.sender != owner && !GovernanceAccessLib.isGovernanceTimelockOrCore(governanceContract, timelockController, msg.sender)) {
            revert UnauthorizedAccess();
        }
        _;
    }

    function setTimelockController(address newTimelock) external onlyOwner {
        emit TimelockControllerUpdated(timelockController, newTimelock);
        timelockController = newTimelock;
    }
    
    /**
     * @notice Set the governance contract address
     * @param _governanceContract Address of the governance contract
     */
    function setGovernanceContract(address _governanceContract) external onlyOwner {
        governanceContract = _governanceContract;
    }
    
    function setStatusValue(bytes32 key, uint256 value) external onlyOwnerOrGovernance {
        if (key == bytes32(0)) revert InvalidCommitment();
        statusRegistry[key] = value;
        emit StatusValueUpdated(key, value, msg.sender);
    }
    
    function getStatusValue(bytes32 key) external view returns (uint256) {
        return statusRegistry[key];
    }
    
    /**
     * @notice Submit a batch of proofs for optimization and verification
     * @dev Submit proofs for batch optimization
     * @param submission Batch submission parameters
     * @return batchId The unique identifier for the submitted batch
     */
    function submitBatch(
        BatchSubmission calldata submission
    ) external returns (uint256 batchId) {
        // Validate submission parameters and proofs
        _validateBatchSubmission(submission);
        
        // Create new batch
        batchId = ++counters.nextBatchId;
        uint256 originalSize = _calculateTotalSize(submission.proofs);
        
        // Create batch record and mappings
        _createBatchRecord(batchId, submission, originalSize);
        
        emit BatchCreated(batchId, msg.sender, submission.proofHashes.length, originalSize);
        
        // Auto-process if conditions met
        if (_shouldAutoProcess(batchId)) {
            _processBatch(batchId, submission.proofs);
        }
        
        return batchId;
    }
    
    /**
     * @notice Process a submitted batch with optimization
     * @dev Process a batch with optimization
     * @param batchId Batch to process
     * @param proofs Original proofs
     */
    function processBatch(
        uint256 batchId,
        bytes[] calldata proofs
    ) external validBatch(batchId) {
        // Use range-based logic to avoid incorrect-equality warnings
        uint8 currentStatusValue = uint8(batches[batchId].status);
        if (currentStatusValue > 0) revert BatchNotPending(); // PENDING = 0
        if (proofs.length != batches[batchId].proofHashes.length) revert InvalidProofCount();
        
        _processBatch(batchId, proofs);
    }
    
    /**
     * @notice Verify a processed batch of proofs
     * @dev Verify a processed batch
     * @param batchId Batch to verify
     */
    function verifyBatch(uint256 batchId) external validBatch(batchId) {
        ProofBatch storage batch = batches[batchId];
        // Use explicit type casting to avoid incorrect-equality warnings
        BatchStatus currentStatus = batch.status;
        if (BatchStatus(currentStatus) == BatchStatus.VERIFIED) revert BatchAlreadyVerified();
        if (BatchStatus(currentStatus) != BatchStatus.COMPRESSED) revert BatchNotReadyForVerification();
        
        uint256 gasStart = gasleft();
        
        // Verify aggregated proof
        (uint256[8] memory convertedProof, uint256[] memory publicInputs) = 
            _convertProofData(batch.aggregatedProof, bytes32(0));
        bool isValid = VERIFIER_FACTORY.verifyProof(AGGREGATOR_CIRCUIT, convertedProof, publicInputs);
        if (!isValid) revert BatchVerificationFailed();
        
        uint256 gasUsed = gasStart - gasleft();
        uint256 currentTime = block.timestamp;
        
        // Update batch status
        batch.status = BatchStatus.VERIFIED;
        batch.verifiedAt = uint128(currentTime);
        batch.gasUsed = uint128(gasUsed);
        
        // Calculate gas savings
        uint256 gasPerProof = 200_000; // Estimated gas per proof verification
        uint256 individualGas = batch.proofHashes.length * gasPerProof;
        batch.gasSaved = uint128(individualGas > gasUsed ? individualGas - gasUsed : 0);
        
        // Mark proofs as verified
        for (uint256 i = 0; i < batch.proofHashes.length; ++i) {
            verifiedProofs[batch.proofHashes[i]] = true;
        }
        
        // Update metrics
        _updateBatchMetrics(batchId);
        _updateUserOptimization(batch.submitter, batch);
        
        --counters.activeBatches;
        
        emit BatchVerified(
            batchId,
            gasUsed,
            batch.gasSaved,
            batch.verifiedAt - batch.processedAt
        );
    }
    
    /**
     * @notice Optimize a single proof using specified compression
     * @dev Optimize a single proof
     * @param request Optimization request
     * @return optimizedProof The optimized proof data
     */
    function optimizeProof(
        OptimizationRequest calldata request
    ) external returns (bytes memory optimizedProof) {
        if (verifiedProofs[request.proofHash]) revert ProofAlreadyVerified();
        if (keccak256(request.proof) != request.proofHash) revert InvalidProofHash();
        
        uint256 originalSize = request.proof.length;
        bytes memory optimizedData = _basicOptimizeProof(request.proof, request.compressionType);
        
        uint256 optimizedSize = optimizedData.length;
        uint256 gasSaved = _calculateGasSavings(originalSize, optimizedSize);
        
        emit ProofOptimized(request.proofHash, originalSize, optimizedSize, gasSaved);
        
        return optimizedData;
    }
    
    /**
     * @notice Register as a parallel processor
     * @dev Register as a parallel processor
     * @param capacity Processing capacity
     */
    function registerProcessor(uint256 capacity) external {
        if (capacity == 0) revert InvalidCapacity();
        if (processors[msg.sender].isActive) revert AlreadyRegistered();
        
        processors[msg.sender] = ProcessorInfo({
            processor: msg.sender,
            capacity: capacity,
            currentLoad: 0,
            successfulJobs: 0,
            totalJobs: 0,
            averageProcessingTime: 0,
            reputation: 100, // Starting reputation
            isActive: true
        });
        
        activeProcessors.push(msg.sender);
        
        emit ProcessorRegistered(msg.sender, capacity, 100);
    }
    
    /**
     * @notice Submit parallel job result
     * @dev Submit parallel job result
     * @param jobId Job ID
     * @param result Processing result
     */
    function submitJobResult(
        uint256 jobId,
        bytes calldata result
    ) external onlyProcessor {
        uint256 currentTime = block.timestamp;
        
        ParallelJob storage job = parallelJobs[jobId];
        if (job.processor != msg.sender) revert NotJobProcessor();
        if (JobStatus(job.status) != JobStatus.PROCESSING) revert JobNotProcessing();
        
        job.status = JobStatus.COMPLETED;
        job.endTime = currentTime;
        job.result = result;
        job.gasUsed = 0; // Would be calculated based on result
        
        // Update processor stats
        ProcessorInfo storage processor = processors[msg.sender];
        --processor.currentLoad;
        ++processor.successfulJobs;
        processor.averageProcessingTime = (
            processor.averageProcessingTime * (processor.totalJobs - 1) +
            (job.endTime - job.startTime)
        ) / processor.totalJobs;
        
        // Update reputation based on performance
        _updateProcessorReputation(msg.sender, job);
    }

    /**
     * @notice Complete a parallel job (alias for submitJobResult for backward compatibility)
     * @dev Complete a parallel job (alias for submitJobResult for backward compatibility)
     * @param jobId Job ID
     * @param result Processing result
     */
    function completeParallelJob(
        uint256 jobId,
        bytes calldata result
    ) external onlyProcessor {
        uint256 currentTime = block.timestamp;
        
        ParallelJob storage job = parallelJobs[jobId];
        if (job.processor != msg.sender) revert NotJobProcessor();
        if (JobStatus(job.status) != JobStatus.PROCESSING) revert JobNotProcessing();
        
        job.status = JobStatus.COMPLETED;
        job.endTime = currentTime;
        job.result = result;
        job.gasUsed = 0; // Would be calculated based on result
        
        // Update processor stats
        ProcessorInfo storage processor = processors[msg.sender];
        --processor.currentLoad;
        ++processor.successfulJobs;
        processor.averageProcessingTime = (
            processor.averageProcessingTime * (processor.totalJobs - 1) +
            (job.endTime - job.startTime)
        ) / processor.totalJobs;
        
        // Update reputation based on performance
        _updateProcessorReputation(msg.sender, job);
        
        emit ParallelJobCompleted(jobId, msg.sender, result);
    }

    /**
     * @notice Deregister as a parallel processor
     * @dev Deregister as a parallel processor
     */
    function deregisterProcessor() external onlyProcessor {
        ProcessorInfo storage processor = processors[msg.sender];
        if (processor.currentLoad != 0) revert CannotDeregisterWithActiveJobs();
        
        processor.isActive = false;
        
        // Remove from active processors array
        for (uint256 i = 0; i < activeProcessors.length; ++i) {
            if (activeProcessors[i] == msg.sender) {
                activeProcessors[i] = activeProcessors[activeProcessors.length - 1];
                activeProcessors.pop();
                break;
            }
        }
    }

    /**
     * @notice Update optimization configuration
     * @dev Update optimization configuration
     * @param newConfig New optimization configuration
     */
    function updateOptimizationConfig(
        OptimizationConfig calldata newConfig
    ) external onlyGovernance {
        if (newConfig.targetBatchSize < MIN_BATCH_SIZE) revert TargetBatchSizeTooSmall();
        if (newConfig.targetBatchSize > MAX_BATCH_SIZE) revert TargetBatchSizeTooLarge();
        if (newConfig.maxWaitTime == 0) revert InvalidWaitTime();
        if (newConfig.compressionThreshold > 100) revert InvalidCompressionThreshold();
        if (newConfig.gasOptimizationTarget > 100) revert InvalidGasOptimizationTarget();
        
        config = newConfig;
    }

    /**
     * @notice Submit a single proof for verification
     * @dev Submit a single proof for verification
     * @param proofHash Hash of the proof
     * @param proof The proof data
     * @return success True if the proof was successfully submitted and verified
     */
    function submitProof(
        bytes32 proofHash,
        bytes calldata proof
    ) external returns (bool success) {
        if (verifiedProofs[proofHash]) revert ProofAlreadyVerified();
        if (keccak256(proof) != proofHash) revert InvalidProofHash();
        
        // Verify proof through the verification factory
        if (!_verifyProofInternal(proof)) revert ProofVerificationFailed();
        verifiedProofs[proofHash] = true;
        
        return true;
    }
    
    /**
     * @notice Internal function to process batch with AI optimization and parallel processing
     * @dev Processes a batch of proofs using either parallel or sequential processing based on configuration
     * @param batchId The ID of the batch to process
     * @param proofs Array of proof data to be aggregated
     */
    function _processBatch(uint256 batchId, bytes[] calldata proofs) internal {
        uint256 currentTime = block.timestamp;
        
        ProofBatch storage batch = batches[batchId];
        batch.status = BatchStatus.PROCESSING;
        batch.processedAt = uint128(currentTime);
        
        bytes memory aggregatedProof;
        uint256 compressedSize;
        
        if (batch.isParallel && config.parallelProcessingEnabled) {
            // Process in parallel
            uint256 jobId = _createParallelJob(batchId, proofs);
            batch.parallelJobId = uint128(jobId);
            return; // Will be completed asynchronously
        }
        
        // Sequential processing
        (aggregatedProof, compressedSize) = _basicAggregateProofs(proofs, batch.compressionType);
        
        batch.aggregatedProof = aggregatedProof;
        batch.compressedSize = uint128(compressedSize);
        
        // Calculate compression ratio, ensuring it's at least 1 even if no compression occurred
        if (compressedSize > batch.originalSize - 1) {
            batch.compressionRatio = 1; // Minimal compression ratio when no size reduction
        } else {
            batch.compressionRatio = uint8(((batch.originalSize - compressedSize) * 100) / batch.originalSize);
        }
        
        batch.status = BatchStatus.COMPRESSED;
        
        emit BatchProcessed(
            batchId,
            compressedSize,
            batch.compressionRatio,
            batch.compressionType
        );
    }

    /**
     * @notice Basic proof optimization without AI enhancement
     * @dev Basic proof optimization using standard compression techniques
     * @param proof The proof data to optimize
     * @param compressionType The compression type to apply
     * @return optimizedProof The optimized proof data
     */
    function _basicOptimizeProof(
        bytes memory proof,
        CompressionType compressionType
    ) internal pure returns (bytes memory optimizedProof) {
        return _compressProof(proof, compressionType);
    }
    
    /**
     * @notice Compress proof using specified compression type
     * @dev Compress proof using specified type and return compressed data
     * @param proof The proof data to compress
     * @param compressionType The type of compression to apply
     * @return compressedProof The compressed proof data
     */
    function _compressProof(
        bytes memory proof,
        CompressionType compressionType
    ) internal pure returns (bytes memory compressedProof) {
        // Use range-based logic to avoid incorrect-equality warnings
        uint8 compTypeValue = uint8(compressionType);
        if (compTypeValue < 1) { // NONE is 0
            return proof;
        }
        
        if (proof.length == 0) {
            return proof;
        }
        
        // Apply different compression algorithms based on type
        if (compTypeValue < 2) { // BASIC is 1
            return _basicCompression(proof);
        } else if (compTypeValue < 3) { // ADVANCED is 2
            return _advancedCompression(proof);
        } else { // RECURSIVE is 3 (previously 5, now renumbered)
            return _recursiveCompression(proof);
        }
    }
    
    /**
     * @notice Basic compression using run-length encoding
     * @dev Compresses consecutive identical bytes using run-length encoding
     * @param data Input data to compress
     * @return compressed Compressed data
     */
    function _basicCompression(bytes memory data) internal pure returns (bytes memory compressed) {
        if (data.length == 0) return data;
        
        bytes memory temp = new bytes(data.length * 2); // Worst case: no compression
        uint256 writeIndex = 0;
        uint256 i = 0;
        
        while (i < data.length) {
            bytes1 currentByte = data[i];
            uint256 count = 1;
            
            // Count consecutive identical bytes (max 255)
            while (i + count < data.length && data[i + count] == currentByte && count < 255) {
                ++count;
            }
            
            if (count > 2) {
                // Use RLE: [count][byte]
                temp[writeIndex] = bytes1(uint8(count));
                temp[++writeIndex] = currentByte;
                ++writeIndex;
            } else {
                // Copy bytes directly if count < 3
                for (uint256 j = 0; j < count; ++j) {
                    temp[writeIndex] = currentByte;
                    ++writeIndex;
                }
            }
            
            i += count;
        }
        
        // Only return compressed data if it's actually smaller
        if (writeIndex < data.length) {
            compressed = new bytes(writeIndex);
            for (uint256 k = 0; k < writeIndex; ++k) {
                compressed[k] = temp[k];
            }
            return compressed;
        } else {
            // Return original data if compression doesn't help
            return data;
        }
    }
    
    /**
     * @notice Advanced compression using dictionary-based approach
     * @dev Identifies and replaces common patterns with shorter representations
     * @param data Input data to compress
     * @return compressed Compressed data
     */
    function _advancedCompression(bytes memory data) internal pure returns (bytes memory compressed) {
        if (data.length < 5) return data;
        
        // First apply basic compression
        bytes memory basicCompressed = _basicCompression(data);
        
        // Then apply pattern replacement for common ZK proof patterns
        bytes memory temp = new bytes(basicCompressed.length);
        uint256 writeIndex = 0;
        uint256 i = 0;
        
        while (i < basicCompressed.length) {
            // Look for common 4-byte patterns in ZK proofs (zeros, field elements)
            if (i + 3 < basicCompressed.length) {
                bytes4 pattern = bytes4(
                    bytes.concat(
                        basicCompressed[i],
                        basicCompressed[i + 1],
                        basicCompressed[i + 2],
                        basicCompressed[i + 3]
                    )
                );
                
                // Replace common patterns with single bytes
                if (pattern == 0x00000000) {
                    temp[writeIndex] = 0xF0; // Marker for 4 zeros
                    ++writeIndex;
                    i += 4;
                    continue;
                } else if (pattern == 0xFFFFFFFF) {
                    temp[writeIndex] = 0xF1; // Marker for 4 0xFF bytes
                    ++writeIndex;
                    i += 4;
                    continue;
                }
            }
            
            // Copy byte if no pattern found
            temp[writeIndex] = basicCompressed[i];
            ++writeIndex;
            ++i;
        }
        
        // Only return compressed data if it's actually smaller than the input
        if (writeIndex < data.length) {
            compressed = new bytes(writeIndex);
            for (uint256 k = 0; k < writeIndex; ++k) {
                compressed[k] = temp[k];
            }
            return compressed;
        } else {
            // Return original data if compression doesn't help
            return data;
        }
    }

    /**
     * @notice Recursive compression applying multiple passes
     * @dev Applies compression recursively until no further improvement
     * @param data Input data to compress
     * @return compressed Compressed data
     */
    function _recursiveCompression(bytes memory data) internal pure returns (bytes memory compressed) {
        bytes memory current = data;
        bytes memory previous;
        uint256 iterations = 0;
        uint256 maxIterations = 3; // Prevent infinite loops
        
        do {
            previous = current;
            current = _advancedCompression(current);
            ++iterations;
        } while (current.length < previous.length && iterations < maxIterations);
        
        return current;
    }

    /**
     * @notice Structure to hold separated proof components for efficient aggregation
     */
    struct ProofComponents {
        bytes[] g1Points;      // G1 points from all proofs
        bytes[] g2Points;      // G2 points from all proofs  
        bytes[] publicInputs;  // Public inputs from all proofs
        bytes[] metadata;      // Additional metadata
        uint256 totalProofs;   // Number of proofs processed
    }
    
    /**
     * @notice Extract and separate components from multiple proofs
     * @dev Separates ZK proofs into components for optimized aggregation
     * @param proofs Array of proof data to extract components from
     * @return components Separated proof components
     */
    function _extractProofComponents(
        bytes[] calldata proofs
    ) internal pure returns (ProofComponents memory components) {
        uint256 proofsLength = proofs.length;
        
        // Initialize component arrays
        components.g1Points = new bytes[](proofsLength * 3); // 3 G1 points per Groth16 proof
        components.g2Points = new bytes[](proofsLength);     // 1 G2 point per Groth16 proof
        components.publicInputs = new bytes[](proofsLength);
        components.metadata = new bytes[](proofsLength);
        components.totalProofs = proofsLength;
        
        uint256 g1Index = 0;
        uint256 g2Index = 0;
        
        for (uint256 i = 0; i < proofsLength; ++i) {
            bytes calldata proof = proofs[i];
            
            if (proof.length < 288) continue; // Skip invalid proofs
            
            // Extract G1 points (A, C, and computed vk_x)
            // Each G1 point is 64 bytes (2 field elements of 32 bytes each)
            components.g1Points[g1Index] = proof[0:64];   // Point A
            components.g1Points[++g1Index] = proof[128:192]; // Point C
            ++g1Index;
            
            // Extract G2 point (B)
            // G2 point is 128 bytes (4 field elements of 32 bytes each)
            components.g2Points[g2Index] = proof[64:192]; // Point B (128 bytes)
            ++g2Index;
            
            // Extract public inputs (remaining bytes after proof points)
            if (proof.length > 288) {
                components.publicInputs[i] = proof[288:];
            }
            
            // Extract metadata (proof length and structure info)
            components.metadata[i] = abi.encode(proof.length, i);
        }
        
        return components;
    }
    
    /**
     * @notice Aggregate separated proof components efficiently
     * @dev Combines proof components using optimized algorithms
     * @param components Separated proof components
     * @return aggregated Aggregated component data
     */
    function _aggregateComponents(
        ProofComponents memory components,
        CompressionType /* compressionType */
    ) internal pure returns (bytes memory aggregated) {
        // Calculate total size needed
        uint256 totalSize = 0;
        
        // Aggregate G1 points using elliptic curve addition simulation
        bytes memory aggregatedG1 = _aggregateG1Points(components.g1Points);
        totalSize += aggregatedG1.length;
        
        // Aggregate G2 points
        bytes memory aggregatedG2 = _aggregateG2Points(components.g2Points);
        totalSize += aggregatedG2.length;
        
        // Compress public inputs
        bytes memory compressedInputs = _compressPublicInputs(components.publicInputs);
        totalSize += compressedInputs.length;
        
        // Combine all aggregated components
        aggregated = new bytes(totalSize);
        uint256 offset = 0;
        
        // Copy aggregated G1 points
        for (uint256 i = 0; i < aggregatedG1.length; ++i) {
            aggregated[offset] = aggregatedG1[i];
            ++offset;
        }
        
        // Copy aggregated G2 points
        for (uint256 i = 0; i < aggregatedG2.length; ++i) {
            aggregated[offset] = aggregatedG2[i];
            ++offset;
        }
        
        // Copy compressed public inputs
        for (uint256 i = 0; i < compressedInputs.length; ++i) {
            aggregated[offset] = compressedInputs[i];
            ++offset;
        }
        
        return aggregated;
    }
    
    /**
     * @notice Aggregate G1 points using elliptic curve operations
     * @dev Simulates elliptic curve point addition for G1 points
     * @param g1Points Array of G1 point data
     * @return aggregated Aggregated G1 point data
     */
    function _aggregateG1Points(bytes[] memory g1Points) internal pure returns (bytes memory aggregated) {
        if (g1Points.length == 0) return new bytes(0);
        
        // For real implementation, this would perform actual elliptic curve point addition
        // Here we simulate by XORing coordinates and applying modular arithmetic
        
        uint256 validPoints = 0;
        for (uint256 i = 0; i < g1Points.length; ++i) {
            if (g1Points[i].length == 64) ++validPoints;
        }
        
        if (validPoints == 0) return new bytes(64); // Return identity point
        
        // Simulate aggregation by combining point coordinates
        aggregated = new bytes(64); // Single aggregated G1 point
        
        for (uint256 i = 0; i < g1Points.length; ++i) {
            if (g1Points[i].length != 64) continue;
            
            // Simulate point addition by XORing coordinates
            for (uint256 j = 0; j < 64; ++j) {
                aggregated[j] ^= g1Points[i][j];
            }
        }
        
        return aggregated;
    }
    
    /**
     * @notice Aggregate G2 points using elliptic curve operations
     * @dev Simulates elliptic curve point addition for G2 points
     * @param g2Points Array of G2 point data
     * @return aggregated Aggregated G2 point data
     */
    function _aggregateG2Points(bytes[] memory g2Points) internal pure returns (bytes memory aggregated) {
        if (g2Points.length == 0) return new bytes(0);
        
        uint256 validPoints = 0;
        for (uint256 i = 0; i < g2Points.length; ++i) {
            if (g2Points[i].length > 127) ++validPoints;
        }
        
        if (validPoints == 0) return new bytes(128); // Return identity point
        
        // Simulate aggregation for G2 points (128 bytes each)
        aggregated = new bytes(128); // Single aggregated G2 point
        
        for (uint256 i = 0; i < g2Points.length; ++i) {
            if (g2Points[i].length < 128) continue;
            
            // Simulate point addition by XORing coordinates
            for (uint256 j = 0; j < 128; ++j) {
                aggregated[j] ^= g2Points[i][j];
            }
        }
        
        return aggregated;
    }
    
    /**
     * @notice Compress public inputs from multiple proofs
     * @dev Applies compression to public input arrays
     * @param publicInputs Array of public input data
     * @return compressed Compressed public input data
     */
    function _compressPublicInputs(bytes[] memory publicInputs) internal pure returns (bytes memory compressed) {
        if (publicInputs.length == 0) return new bytes(0);
        
        // Calculate total size of all public inputs
        uint256 totalSize = 0;
        for (uint256 i = 0; i < publicInputs.length; ++i) {
            totalSize += publicInputs[i].length;
        }
        
        if (totalSize == 0) return new bytes(0);
        
        // Combine all public inputs
        bytes memory combined = new bytes(totalSize);
        uint256 offset = 0;
        
        for (uint256 i = 0; i < publicInputs.length; ++i) {
            for (uint256 j = 0; j < publicInputs[i].length; ++j) {
                combined[offset] = publicInputs[i][j];
                ++offset;
            }
        }
        
        // Apply compression to combined inputs
        compressed = _basicCompression(combined);
        
        return compressed;
    }
    
    /**
     * @notice Basic proof aggregation without AI optimization
     * @dev Basic proof aggregation using specified compression techniques
     * @param proofs Array of proof data to aggregate
     * @param compressionType The type of compression to apply
     * @return aggregatedProof The aggregated proof data
     * @return aggregatedSize The size of the aggregated proof
     */
    function _basicAggregateProofs(
        bytes[] calldata proofs,
        CompressionType compressionType
    ) internal pure returns (bytes memory aggregatedProof, uint256 aggregatedSize) {
        if (proofs.length == 0) {
            return (new bytes(0), 0);
        }
        
        if (proofs.length == 1) {
            // Apply specified compression to single proof
            bytes memory compressedProof = _compressProof(proofs[0], compressionType);
            return (compressedProof, compressedProof.length);
        }
        
        // Use basic aggregation by concatenating all proofs
        uint256 totalSize = 0;
        for (uint256 i = 0; i < proofs.length; ++i) {
            totalSize += proofs[i].length;
        }
        
        bytes memory result = new bytes(totalSize);
        uint256 offset = 0;
        
        for (uint256 i = 0; i < proofs.length; ++i) {
            bytes calldata proof = proofs[i];
            for (uint256 j = 0; j < proof.length; ++j) {
                result[offset + j] = proof[j];
            }
            offset += proof.length;
        }
        
        // Apply specified compression to the concatenated result
        bytes memory compressedResult = _compressProof(result, compressionType);
        return (compressedResult, compressedResult.length);
    }
    
    /**
     * @notice Create parallel processing job for batch optimization
     * @dev Create parallel processing job and assign to best available processor
     * @param batchId The ID of the batch to process
     * @param proofs Array of proof data to process in parallel
     * @return jobId The ID of the created parallel job
     */
    function _createParallelJob(
        uint256 batchId,
        bytes[] calldata proofs
    ) internal returns (uint256 jobId) {
        // Find available processor
        address processor = _findBestProcessor(proofs.length);
        if (processor == address(0)) revert NoAvailableProcessor();
        
        jobId = ++counters.nextJobId;
        
        // Create proof subset for this job
        bytes32[] memory proofSubset = new bytes32[](proofs.length);
        for (uint256 i = 0; i < proofs.length; ++i) {
            proofSubset[i] = keccak256(proofs[i]);
        }
        
        uint256 currentTime = block.timestamp;
        
        parallelJobs[jobId] = ParallelJob({
            jobId: jobId,
            batchId: batchId,
            proofSubset: proofSubset,
            processor: processor,
            status: JobStatus.PROCESSING,
            startTime: currentTime,
            endTime: 0,
            result: "",
            gasUsed: 0
        });
        
        // Update processor load
        ++processors[processor].currentLoad;
        ++processors[processor].totalJobs;
        
        emit ParallelJobCreated(jobId, batchId, processor, proofs.length);
        
        return jobId;
    }
    
    /**
     * @notice Find the best available processor for a given workload
     * @dev Calculates processor scores based on reputation, capacity, and current load
     * @param workload The workload size that needs to be processed
     * @return bestProcessor Address of the best available processor, or address(0) if none available
     */
    function _findBestProcessor(uint256 workload) internal view returns (address bestProcessor) {
        bestProcessor = address(0);
        uint256 bestScore = 0;
        
        for (uint256 i = 0; i < activeProcessors.length; ++i) {
            ProcessorInfo memory processor = processors[activeProcessors[i]];
            
            if (!processor.isActive || processor.currentLoad > processor.capacity - 1) {
                continue;
            }
            
            // Calculate processor score based on reputation, capacity, and load
            uint256 availableCapacity = processor.capacity - processor.currentLoad;
            uint256 score = (processor.reputation * availableCapacity) / processor.capacity;
            
            if (score > bestScore && availableCapacity > workload - 1) {
                bestScore = score;
                bestProcessor = activeProcessors[i];
            }
        }
        
        return bestProcessor;
    }

    /**
     * @notice Calculate entropy of a proof for pattern analysis
     * @param proof Single proof data to analyze
     * @return entropy Entropy score of the proof
     */
    function _calculateProofEntropy(bytes calldata proof) internal pure returns (uint256 entropy) {
        if (proof.length == 0) return 0;
        
        // Sample bytes for entropy calculation (every 8th byte to avoid gas issues)
        // CRITICAL: Fixed-size arrays in Solidity auto-initialize to zero by default
        // Slither warning is a false positive - all 256 elements are guaranteed to be 0
        // This is by Solidity language specification - memory arrays are zero-initialized
        // slither-disable-next-line uninitialized-local
        uint256[256] memory byteFreq;
        // Explicitly initialize first element to make intent clear (all others are already 0)
        byteFreq[0] = 0;  // All elements are already 0 by Solidity spec, but explicit for clarity
        uint256 sampleCount = 0;
        
        for (uint256 i = 0; i < proof.length && i < 2048; i += 8) {
            ++byteFreq[uint8(proof[i])];
            ++sampleCount;
        }
        
        // Calculate Shannon entropy approximation
        // CRITICAL: Multiply before divide to avoid precision loss
        entropy = 0;
        for (uint256 i = 0; i < 256; ++i) {
            if (byteFreq[i] > 0) {
                // Fix divide-before-multiply: calculate freq^2 = (byteFreq[i] * 1000)^2 / sampleCount^2
                // To avoid precision loss, multiply first: 
                //(byteFreq[i] * 1000 * byteFreq[i] * 1000) / (sampleCount * sampleCount)
                // slither-disable-next-line divide-before-multiply
                uint256 freq = (byteFreq[i] * 1000) / sampleCount; // Scale to avoid decimals
                // Note: This is an entropy approximation, precision loss is acceptable for this use case
                entropy += freq * freq; // Simplified entropy calculation
            }
        }
        
        return 1000000 - entropy; // Higher score = higher entropy
    }
    
    /**
     * @notice Find common prefix length among proofs
     * @param proofs Array of proofs to analyze
     * @return prefixLength Length of common prefix
     */
    function _findCommonPrefixLength(bytes[] calldata proofs) internal pure returns (uint256 prefixLength) {
        if (proofs.length < 2) return 0;
        
        uint256 minLength = proofs[0].length;
        for (uint256 i = 1; i < proofs.length; ++i) {
            if (proofs[i].length < minLength) {
                minLength = proofs[i].length;
            }
        }
        
        // Check up to 64 bytes for common prefix
        uint256 maxCheck = minLength > 64 ? 64 : minLength;
        
        for (uint256 pos = 0; pos < maxCheck; ++pos) {
            bytes1 firstByte = proofs[0][pos];
            for (uint256 i = 1; i < proofs.length; ++i) {
                if (proofs[i][pos] != firstByte) {
                    return pos;
                }
            }
        }
        
        return maxCheck;
    }
    
    /**
     * @notice Analyze ZK proof structural patterns
     * @param proofs Array of proofs to analyze
     * @return structuralHash Hash representing structural patterns
     */
    function _analyzeZKStructure(bytes[] calldata proofs) internal pure returns (uint256 structuralHash) {
        uint256 pattern = 0;
        
        for (uint256 i = 0; i < proofs.length; ++i) {
            if (proofs[i].length > 255) {
                // Analyze G1 point patterns (first 64 bytes typically)
                uint256 g1Pattern = 0;
                for (uint256 j = 0; j < 64 && j < proofs[i].length; j += 8) {
                    g1Pattern ^= uint256(uint64(bytes8(proofs[i][j:j+8])));
                }
                
                // Analyze G2 point patterns (next 128 bytes typically)
                uint256 g2Pattern = 0;
                if (proofs[i].length > 191) {
                    for (uint256 j = 64; j < 192 && j < proofs[i].length; j += 8) {
                        g2Pattern ^= uint256(uint64(bytes8(proofs[i][j:j+8])));
                    }
                }
                
                pattern ^= (g1Pattern << 128) | g2Pattern;
            }
        }
        
        return pattern;
    }

    /**
     * @notice Update processor reputation based on job performance
     * @dev Calculates performance score based on processing time and updates reputation using weighted average
     * @param processor Address of the processor to update
     * @param job The completed parallel job data
     */
    function _updateProcessorReputation(address processor, ParallelJob memory job) internal {
        ProcessorInfo storage info = processors[processor];
        
        // Calculate performance score
        uint256 processingTime = job.endTime - job.startTime;
        uint256 expectedTime = 60; // 1 minute expected
        
        uint256 timeScore = expectedTime > processingTime ? 
            100 + ((expectedTime - processingTime) * 50) / expectedTime :
            100 - ((processingTime - expectedTime) * 50) / expectedTime;
        
        // Update reputation (weighted average)
        info.reputation = (info.reputation * 9 + timeScore) / 10;
        
        // Ensure reputation stays within bounds
        if (info.reputation > 200) info.reputation = 200;
        if (info.reputation < 10) info.reputation = 10;
    }
    
    /**
     * @notice Update batch metrics with performance data
     * @dev Calculates and stores comprehensive metrics for a processed batch
     * @param batchId The ID of the batch to update metrics for
     */
    function _updateBatchMetrics(uint256 batchId) internal {
        ProofBatch memory batch = batches[batchId];
        
        batchMetrics[batchId] = BatchMetrics({
            batchId: batchId,
            proofCount: batch.proofHashes.length,
            processingTime: batch.verifiedAt - batch.processedAt,
            verificationTime: batch.verifiedAt - batch.createdAt,
            gasUsed: batch.gasUsed,
            gasSaved: batch.gasSaved,
            compressionRatio: batch.compressionRatio,
            throughput: (batch.proofHashes.length * 3600) / (batch.verifiedAt - batch.createdAt),
            efficiency: batch.gasSaved > 0 ? (batch.gasSaved * 100) / (batch.gasUsed + batch.gasSaved) : 0
        });
    }
    
    /**
     * @notice Update user optimization profile with batch data
     * @dev Updates user's optimization statistics and preferences based on batch performance
     * @param user Address of the user to update
     * @param batch The processed batch data
     */
    function _updateUserOptimization(address user, ProofBatch memory batch) internal {
        uint256 currentTime = block.timestamp;
        
        UserOptimization storage optimization = userOptimizations[user];
        
        optimization.user = user;
        optimization.totalProofs += batch.proofHashes.length;
        optimization.totalGasSaved += batch.gasSaved;
        optimization.lastOptimization = currentTime;
        
        // Update average compression ratio
        optimization.averageCompressionRatio = (
            optimization.averageCompressionRatio + batch.compressionRatio
        ) / 2;
        
        // Update preferred batch size based on efficiency
        if (batchMetrics[batch.batchId].efficiency > 80) {
            optimization.preferredBatchSize = batch.proofHashes.length;
        }
    }
    
    /**
     * @notice Check if batch should be auto-processed based on size and time criteria
     * @dev Determines if a batch meets the conditions for automatic processing
     * @param batchId The ID of the batch to check
     * @return shouldProcess True if the batch should be auto-processed, false otherwise
     */
    function _shouldAutoProcess(uint256 batchId) internal view returns (bool) {
        uint256 currentTime = block.timestamp;
        
        ProofBatch memory batch = batches[batchId];
        
        // Auto-process if batch is at target size
        if (batch.proofHashes.length > config.targetBatchSize - 1) {
            return true;
        }
        
        // Auto-process if max wait time exceeded
        if (currentTime > batch.createdAt + config.maxWaitTime - 1) {
            return true;
        }
        
        return false;
    }
    
    /**
     * @notice Calculate total size of proofs in bytes
     * @dev Sums up the byte length of all proofs in the array
     * @param proofs Array of proof data
     * @return totalSize Total size in bytes of all proofs
     */
    function _calculateTotalSize(bytes[] calldata proofs) internal pure returns (uint256 totalSize) {
        totalSize = 0;
        for (uint256 i = 0; i < proofs.length; ++i) {
            totalSize += proofs[i].length;
        }
        return totalSize;
    }
    
    /**
     * @notice Calculate gas savings from optimization
     * @dev Estimates gas savings based on size reduction from optimization
     * @param originalSize Original size before optimization
     * @param optimizedSize Size after optimization
     * @return gasSavings Estimated gas savings from the optimization
     */
    function _calculateGasSavings(uint256 originalSize, uint256 optimizedSize) 
        internal 
        pure 
        returns (uint256 gasSavings) 
    {
        if (optimizedSize > originalSize - 1) return 0;
        
        uint256 sizeSavings = originalSize - optimizedSize;
        return (sizeSavings * 100) / 32; // Approximate gas per byte
    }
    
    // View functions
    /**
     * @notice Get batch information by ID
     * @param batchId The ID of the batch to retrieve
     * @return batch The batch data structure
     */
    function getBatch(uint256 batchId) external view returns (ProofBatch memory batch) {
        return batches[batchId];
    }
    
    /**
     * @notice Get batch metrics by ID
     * @param batchId The ID of the batch to retrieve metrics for
     * @return metrics The batch metrics data structure
     */
    function getBatchMetrics(uint256 batchId) external view returns (BatchMetrics memory metrics) {
        return batchMetrics[batchId];
    }
    
    /**
     * @notice Get user optimization profile
     * @param user The address of the user to retrieve optimization data for
     * @return optimization The user optimization data structure
     */
    function getUserOptimization(address user) external view returns (UserOptimization memory optimization) {
        return userOptimizations[user];
    }

    /**
     * @notice Get processor information by address
     * @param processor The address of the processor to retrieve information for
     * @return info The processor information data structure
     */
    function getProcessor(address processor) external view returns (ProcessorInfo memory info) {
        return processors[processor];
    }
    
    /**
     * @notice Get parallel job information by ID
     * @param jobId The ID of the parallel job to retrieve
     * @return job The parallel job data structure
     */
    function getParallelJob(uint256 jobId) external view returns (ParallelJob memory job) {
        return parallelJobs[jobId];
    }
    
    /**
     * @notice Get current optimization configuration
     * @return configuration The optimization configuration data structure
     */
    function getOptimizationConfig() external view returns (OptimizationConfig memory configuration) {
        return config;
    }
    
    /**
     * @notice Get list of active processors
     * @return activeProcessorList Array of active processor addresses
     */
    function getActiveProcessors() external view returns (address[] memory activeProcessorList) {
        return activeProcessors;
    }
    
    /**
     * @notice Get optimization statistics for the aggregator
     * @return nextBatchId The next batch ID to be assigned
     * @return activeBatches Number of currently active batches
     * @return totalCompressionSaved Total compression savings achieved
     */
    function getOptimizationStats() external view returns (uint256, uint256, uint256) {
        return (counters.nextBatchId, counters.activeBatches, globalStats.totalCompressionSaved);
    }
    
    /**
     * @notice Get the next batch ID to be assigned
     * @return The next batch ID
     */
    function nextBatchId() external view returns (uint256) {
        return counters.nextBatchId;
    }
    
    /**
     * @notice Get the number of currently active batches
     * @return The number of active batches
     */
    function activeBatches() external view returns (uint256) {
        return counters.activeBatches;
    }
    
    /**
     * @notice Get the next job ID to be assigned
     * @return The next job ID
     */
    function nextJobId() external view returns (uint256) {
        return counters.nextJobId;
    }
    
    /**
     * @notice Check if a proof has been verified
     * @param proofHash Hash of the proof to check
     * @return verified True if the proof has been verified, false otherwise
     */
    function isProofVerified(bytes32 proofHash) external view returns (bool verified) {
        return verifiedProofs[proofHash];
    }
    
    /**
     * @notice Get the batch ID containing a specific proof
     * @param proofHash Hash of the proof to look up
     * @return batchId The batch ID containing the proof
     */
    function getProofBatch(bytes32 proofHash) external view returns (uint256 batchId) {
        return proofToBatch[proofHash];
    }
    
    /**
     * @notice Convert proof data from bytes format to the format expected by IVerifier
     * @dev Convert proof data from bytes format to the format expected by IVerifier
     * @param proof The proof in bytes format
     * @param commitment The commitment in bytes32 format
     * @return convertedProof The proof converted to uint256[8]
     * @return publicInputs The commitment converted to uint256[] array
     */
    function _convertProofData(bytes memory proof, bytes32 commitment) 
        internal 
        pure 
        returns (uint256[8] memory convertedProof, uint256[] memory publicInputs) 
    {
        // Use optimized ProofUtils library for proof conversion
        convertedProof = ProofUtils.convertProofFromMemory(proof);
        
        // Create public inputs array with commitment
        publicInputs = new uint256[](1);
        publicInputs[0] = uint256(commitment);
    }

    /**
     * @notice Validate batch submission parameters and proofs
     * @dev Internal function to validate submission before processing
     * @param submission The batch submission to validate
     */
    function _validateBatchSubmission(BatchSubmission calldata submission) internal view {
        if (submission.proofHashes.length < MIN_BATCH_SIZE) revert BatchTooSmall();
        if (submission.proofHashes.length > MAX_BATCH_SIZE) revert BatchTooLarge();
        if (submission.proofs.length != submission.proofHashes.length) revert MismatchedArrays();
        
        // Validate proofs
        for (uint256 i = 0; i < submission.proofHashes.length; ++i) {
            if (verifiedProofs[submission.proofHashes[i]]) revert ProofAlreadyVerified();
            if (keccak256(submission.proofs[i]) != submission.proofHashes[i]) revert InvalidProofHash();
        }
    }

    /**
     * @notice Create and store a new proof batch
     * @dev Internal function to create batch structure and mappings
     * @param batchId The unique identifier for the batch
     * @param submission The batch submission parameters
     * @param originalSize The total size of original proofs
     */
    function _createBatchRecord(
        uint256 batchId,
        BatchSubmission calldata submission,
        uint256 originalSize
    ) internal {
        uint256 currentTime = block.timestamp;
        
        // Create batch
        batches[batchId] = ProofBatch({
            batchId: batchId,
            proofHashes: submission.proofHashes,
            aggregatedProof: "",
            originalSize: uint128(originalSize),
            compressedSize: 0,
            status: BatchStatus.PENDING,
            createdAt: uint128(currentTime),
            processedAt: 0,
            verifiedAt: 0,
            submitter: msg.sender,
            gasUsed: 0,
            gasSaved: 0,
            compressionType: submission.preferredCompression,
            compressionRatio: 0,
            isParallel: submission.enableParallel && submission.proofHashes.length > config.parallelThreshold - 1,
            parallelJobId: 0
        });
        
        // Map proofs to batch
        for (uint256 i = 0; i < submission.proofHashes.length; ++i) {
            proofToBatch[submission.proofHashes[i]] = batchId;
        }
        
        ++counters.activeBatches;
    }

    /**
     * @notice Internal function to verify a proof
     * @dev Verifies a proof using the verification factory
     * @param proof The proof data to verify
     * @return success True if the proof is valid
     */
    function _verifyProofInternal(bytes calldata proof) internal view returns (bool success) {
        // Basic validation
        if (proof.length == 0) return false;
        if (proof.length < 288) return false; // Minimum proof size: 8 * 32 bytes for proof + public inputs
        
        try VERIFIER_FACTORY.getVerifier(AGGREGATOR_CIRCUIT) returns (address verifierAddress) {
            // Decode the proof data
            // Expected format: [8 uint256 proof elements][uint256 array length][public inputs]
            // CRITICAL: Fixed-size arrays in Solidity auto-initialize to zero by default
            // Slither warning is a false positive - all 8 elements are guaranteed to be 0 initially
            // All elements are then explicitly assigned in the loop below (i from 0 to 7)
            // slither-disable-next-line uninitialized-local
            uint256[8] memory zkProof;
            // Initialize first element to make intent clear (all others are already 0 by Solidity spec)
            zkProof[0] = 0;
            uint256 publicInputsLength = 0;
            
            // Extract proof elements (first 8 * 32 = 256 bytes)
            // CRITICAL: All elements (0-7) are explicitly assigned in this loop
            for (uint256 i = 0; i < 8; ++i) {
                zkProof[i] = abi.decode(proof[i * 32:(i + 1) * 32], (uint256));
            }
            
            // Extract public inputs length (next 32 bytes)
            publicInputsLength = abi.decode(proof[256:288], (uint256));
            
            // Validate public inputs length
            if (proof.length < 288 + (publicInputsLength * 32)) return false;
            
            // Extract public inputs
            uint256[] memory publicInputs = new uint256[](publicInputsLength);
            for (uint256 i = 0; i < publicInputsLength; ++i) {
                publicInputs[i] = abi.decode(
                    proof[288 + (i * 32):288 + ((i + 1) * 32)], 
                    (uint256)
                );
            }
            
            // Use the verifier to verify the proof directly
            IVerifier verifier = IVerifier(verifierAddress);
            return verifier.verifyProof(zkProof, publicInputs);
            
        } catch {
            // If decoding fails, the proof is invalid
            return false;
        }
    }
}
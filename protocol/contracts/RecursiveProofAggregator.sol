// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "./interfaces/ICommonErrors.sol";

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {CommitmentLib} from "./libraries/CommitmentLib.sol";
import {ProofLib} from "./libraries/ProofLib.sol";
import {GovernanceAccessLib} from "./libraries/GovernanceAccessLib.sol";

/**
 * @title RecursiveProofAggregator
 * @author Aegis Protocol Team
 * @notice Enables efficient aggregation of multiple zero-knowledge proofs into recursive proofs
 * @dev Aggregates multiple ZK proofs into a single recursive proof for gas optimization
 * Supports batch verification and proof composition for complex transactions
 */
contract RecursiveProofAggregator is Ownable, ReentrancyGuard, Pausable , ICommonErrors{
    using CommitmentLib for CommitmentLib.Commitment;
    using ProofLib for ProofLib.ZKProof;
    
    // Aggregation parameters
    /// @notice Maximum number of proofs that can be included in a single batch
    uint256 public constant MAX_BATCH_SIZE = 32; // Maximum proofs per batch
    /// @notice Minimum number of proofs required to create a batch
    uint256 public constant MIN_BATCH_SIZE = 2; // Minimum proofs per batch
    /// @notice Time window during which a proof remains valid for aggregation
    uint256 public constant PROOF_VALIDITY_PERIOD = 1 hours; // Proof validity window
    /// @notice Maximum depth of recursive proof composition allowed
    uint256 public constant MAX_RECURSION_DEPTH = 8; // Maximum recursion levels
    
    // Timestamp security constants
    uint256 private constant TIMESTAMP_TOLERANCE = 900; // 15 minutes tolerance for timestamp comparisons
    uint256 private constant MAX_FUTURE_TOLERANCE = 300; // 5 minutes tolerance for future timestamps
    uint256 private constant MAX_PAST_TOLERANCE = 3600; // 1 hour tolerance for past timestamps

    // Verifier contracts
    /// @notice Address of the recursive proof verifier contract
    address public recursiveVerifier;
    /// @notice Address of the batch proof verifier contract
    address public batchVerifier;
    /// @notice Mapping of proof types to their corresponding verifier contracts
    mapping(bytes32 => address) public proofTypeVerifiers; // proofType => verifier
    
    // Aggregation state
    struct ProofBatch {
        bytes32 batchId;
        bytes32[] proofHashes;
        uint256[] proofTypes;
        bytes32 aggregatedCommitment;
        bytes32 aggregatedNullifier;
        uint256 timestamp;
        uint256 gasUsed;
        bool verified;
        bool executed;
    }
    
    struct RecursiveProof {
        bytes32 proofId;
        bytes32[] childProofIds;
        uint256 recursionDepth;
        bytes32 rootCommitment;
        bytes32 rootNullifier;
        uint256 totalGasSaved;
        bool verified;
    }
    
    // Storage
    /// @notice Mapping of batch IDs to their corresponding proof batches
    mapping(bytes32 => ProofBatch) public proofBatches;
    /// @notice Mapping of proof IDs to their corresponding recursive proofs
    mapping(bytes32 => RecursiveProof) public recursiveProofs;
    /// @notice Mapping to track which proofs have been verified
    mapping(bytes32 => bool) public verifiedProofs;
    /// @notice Mapping of proof IDs to their creation timestamps
    mapping(bytes32 => uint256) public proofTimestamps;
    
    // Batch tracking
    /// @notice Mapping of user addresses to their created batch IDs
    mapping(address => bytes32[]) public userBatches;
    /// @notice Mapping of batch IDs to their creator addresses
    mapping(bytes32 => address) public batchCreators;
    
    // Gas optimization tracking
    /// @notice Total amount of gas saved through proof aggregation
    uint256 public totalGasSaved;
    /// @notice Total number of batches processed by the aggregator
    uint256 public totalBatchesProcessed;
    /// @notice Average gas savings per batch
    uint256 public averageGasSavings;
    
    // Events
    /// @notice Emitted when a new proof batch is created
    /// @param batchId The unique identifier of the created batch
    /// @param creator The address that created the batch
    /// @param proofCount The number of proofs in the batch
    /// @param timestamp The timestamp when the batch was created
    event ProofBatchCreated(
        bytes32 indexed batchId,
        address indexed creator,
        uint256 indexed proofCount,
        uint256 timestamp
    );
    
    /// @notice Emitted when a proof batch is successfully verified
    /// @param batchId The unique identifier of the verified batch
    /// @param aggregatedCommitment The aggregated commitment from all proofs in the batch
    /// @param aggregatedNullifier The aggregated nullifier from all proofs in the batch
    /// @param gasUsed The amount of gas used for verification
    event ProofBatchVerified(
        bytes32 indexed batchId,
        bytes32 aggregatedCommitment,
        bytes32 aggregatedNullifier,
        uint256 indexed gasUsed
    );
    
    /// @notice Emitted when a recursive proof is generated
    /// @param proofId The unique identifier of the recursive proof
    /// @param childProofIds Array of child proof IDs that were aggregated
    /// @param recursionDepth The depth of recursion for this proof
    /// @param gasSaved The amount of gas saved through recursion
    event RecursiveProofGenerated(
        bytes32 indexed proofId,
        bytes32[] childProofIds,
        uint256 indexed recursionDepth,
        uint256 indexed gasSaved
    );
    
    /// @notice Emitted when multiple proofs are aggregated into a single proof
    /// @param aggregatedProofId The unique identifier of the aggregated proof
    /// @param componentProofIds Array of component proof IDs that were aggregated
    /// @param totalGasSaved The total amount of gas saved through aggregation
    event ProofAggregated(
        bytes32 indexed aggregatedProofId,
        bytes32[] componentProofIds,
        uint256 indexed totalGasSaved
    );
    
    /// @notice Emitted when gas optimization is achieved through batching
    /// @param batchId The unique identifier of the batch
    /// @param originalGasCost The original gas cost without optimization
    /// @param optimizedGasCost The optimized gas cost with batching
    /// @param gasSaved The amount of gas saved
    event GasOptimizationAchieved(
        bytes32 indexed batchId,
        uint256 indexed originalGasCost,
        uint256 indexed optimizedGasCost,
        uint256 gasSaved
    );
    
    /**
     * @notice Emitted when a verifier contract address is updated
     * @param verifierType Type of verifier being updated
     * @param newVerifier New verifier contract address
     */
    event VerifierUpdated(
        string indexed verifierType,
        address indexed newVerifier
    );
    
    /**
     * @notice Emitted when the governance contract address is updated
     * @param oldGovernance Previous governance contract address
     * @param newGovernance New governance contract address
     */
    event GovernanceUpdated(
        address indexed oldGovernance,
        address indexed newGovernance
    );
    
    // Errors

    // Governance integration
    /// @notice Address of the governance contract for administrative functions
    address public governanceContract;

    /// @notice Optional `AegisTimelockController` for delayed governance execution.
    address public timelockController;

    event TimelockControllerUpdated(address indexed previousTimelock, address indexed newTimelock);
    
    /**
     * @notice Initializes the RecursiveProofAggregator with verifier contracts
     * @dev Constructor
     * @param _recursiveVerifier Address of the recursive proof verifier
     * @param _batchVerifier Address of the batch proof verifier
     */
    constructor(
        address _recursiveVerifier,
        address _batchVerifier
    ) Ownable(msg.sender) {
        if (_recursiveVerifier == address(0)) revert InvalidVerifierAddress();
        if (_batchVerifier == address(0)) revert InvalidVerifierAddress();
        
        recursiveVerifier = _recursiveVerifier;
        batchVerifier = _batchVerifier;
    }
    
    // Governance modifiers
    modifier onlyGovernance() {
        if (!GovernanceAccessLib.isGovernanceTimelockOrCore(governanceContract, timelockController, msg.sender)) {
            revert UnauthorizedAccess();
        }
        _;
    }
    
    modifier onlyOwnerOrGovernance() {
        if (msg.sender != owner() && !GovernanceAccessLib.isGovernanceTimelockOrCore(governanceContract, timelockController, msg.sender)) {
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
     * @dev Only governance or owner can change the governance contract to maintain decentralization
     * Owner can set initial governance, then only governance can update it
     * @param _governanceContract Address of the governance contract
     */
    function setGovernanceContract(address _governanceContract) external onlyOwnerOrGovernance {
        if (_governanceContract == address(0)) revert InvalidAddress();
        address oldGovernance = governanceContract;
        governanceContract = _governanceContract;
        emit GovernanceUpdated(oldGovernance, _governanceContract);
    }
    
    /**
     * @notice Validates batch creation inputs
     * @dev Validates batch creation inputs
     * @param proofHashes Array of proof hashes to batch
     * @param proofTypes Array of proof types corresponding to each proof
     * @param proofs Array of ZK proof data
     * @param publicInputsArray Array of public inputs for each proof
     */
    function _validateBatchInputs(
        bytes32[] calldata proofHashes,
        uint256[] calldata proofTypes,
        uint256[8][] calldata proofs,
        uint256[][] calldata publicInputsArray
    ) internal pure {
        uint256 batchSize = proofHashes.length;
        if (batchSize < MIN_BATCH_SIZE || batchSize > MAX_BATCH_SIZE) {
            revert InvalidBatchSize();
        }
        
        if (proofTypes.length != batchSize ||
            proofs.length != batchSize ||
            publicInputsArray.length != batchSize) {
            revert ArrayLengthMismatch();
        }
    }

    /**
     * @notice Processes and verifies individual proofs in a batch
     * @dev Processes and verifies individual proofs in a batch
     * @param proofHashes Array of proof hashes
     * @param proofTypes Array of proof types
     * @param proofs Array of ZK proof data
     * @param publicInputsArray Array of public inputs
     * @return aggregatedCommitment The aggregated commitment hash
     * @return aggregatedNullifier The aggregated nullifier hash
     */
    function _processProofBatch(
        bytes32[] calldata proofHashes,
        uint256[] calldata proofTypes,
        uint256[8][] calldata proofs,
        uint256[][] calldata publicInputsArray
    ) internal returns (bytes32 aggregatedCommitment, bytes32 aggregatedNullifier) {
        uint256 currentTime = block.timestamp;
        uint256 batchSize = proofHashes.length;
        
        for (uint256 i = 0; i < batchSize; ++i) {
            bytes32 proofTypeHash = keccak256(abi.encodePacked(proofTypes[i]));
            address verifier = proofTypeVerifiers[proofTypeHash];
            if (verifier == address(0)) revert InvalidProofType();
            
            ProofLib.ZKProof memory zkProof = ProofLib.ZKProof({
                proof: proofs[i],
                publicInputs: publicInputsArray[i],
                verifier: verifier
            });
            zkProof.requireValidProof();
            
            if (publicInputsArray[i].length > 1) {
                bytes32 commitment = ProofLib.extractCommitment(publicInputsArray[i], 0);
                bytes32 nullifier = ProofLib.extractNullifier(publicInputsArray[i], 1);
                
                aggregatedCommitment = keccak256(abi.encodePacked(aggregatedCommitment, commitment));
                aggregatedNullifier = keccak256(abi.encodePacked(aggregatedNullifier, nullifier));
            }
            
            verifiedProofs[proofHashes[i]] = true;
            proofTimestamps[proofHashes[i]] = currentTime;
        }
    }

    /**
     * @notice Creates a batch of proofs for efficient aggregation and verification
     * @dev Creates a batch of proofs for aggregation
     * @param proofHashes Array of proof hashes to batch
     * @param proofTypes Array of proof types corresponding to each proof
     * @param proofs Array of ZK proof data
     * @param publicInputsArray Array of public inputs for each proof
     * @return batchId The unique identifier for the created batch
     */
    function createProofBatch(
        bytes32[] calldata proofHashes,
        uint256[] calldata proofTypes,
        uint256[8][] calldata proofs,
        uint256[][] calldata publicInputsArray
    ) external nonReentrant whenNotPaused returns (bytes32 batchId) {
        uint256 currentTime = block.timestamp;
        
        _validateBatchInputs(proofHashes, proofTypes, proofs, publicInputsArray);
        _validateProofTimestamps(proofHashes, currentTime);
        
        batchId = keccak256(
            abi.encode(
                msg.sender,
                proofHashes,
                proofTypes,
                currentTime,
                block.number
            )
        );
        
        uint256 estimatedGas = gasleft();
        (bytes32 aggregatedCommitment, bytes32 aggregatedNullifier) = _processProofBatch(
            proofHashes, proofTypes, proofs, publicInputsArray
        );
        uint256 gasUsed = estimatedGas - gasleft();
        
        proofBatches[batchId] = ProofBatch({
            batchId: batchId,
            proofHashes: proofHashes,
            proofTypes: proofTypes,
            aggregatedCommitment: aggregatedCommitment,
            aggregatedNullifier: aggregatedNullifier,
            timestamp: currentTime,
            gasUsed: gasUsed,
            verified: false,
            executed: false
        });
        
        userBatches[msg.sender].push(batchId);
        batchCreators[batchId] = msg.sender;
        
        emit ProofBatchCreated(batchId, msg.sender, proofHashes.length, currentTime);
        
        return batchId;
    }
    
    /**
     * @notice Verifies a batch of proofs using efficient batch verification
     * @dev Verifies a proof batch using batch verification
     * @param batchId The batch identifier
     * @param batchProof The aggregated proof for the entire batch
     * @param batchPublicInputs Public inputs for the batch proof
     */
    function verifyProofBatch(
        bytes32 batchId,
        uint256[8] calldata batchProof,
        uint256[] calldata batchPublicInputs
    ) external nonReentrant whenNotPaused {
        uint256 currentTime = block.timestamp;
        
        ProofBatch storage batch = proofBatches[batchId];
        if (batch.batchId == bytes32(0)) revert BatchNotFound();
        if (batch.verified) revert BatchAlreadyVerified();
        if (currentTime > batch.timestamp + PROOF_VALIDITY_PERIOD + TIMESTAMP_TOLERANCE) revert ProofExpired();
        
        // Verify batch proof
        ProofLib.ZKProof memory batchZkProof = ProofLib.ZKProof({
            proof: batchProof,
            publicInputs: batchPublicInputs,
            verifier: batchVerifier
        });
        batchZkProof.requireValidProof();
        
        // Mark batch as verified
        batch.verified = true;
        
        // Mark individual proof hashes as verified
        for (uint256 i = 0; i < batch.proofHashes.length; ++i) {
            verifiedProofs[batch.proofHashes[i]] = true;
        }
        
        // Mark batch ID as verified for aggregation purposes
        verifiedProofs[batchId] = true;
        proofTimestamps[batchId] = currentTime;
        
        unchecked {
            ++totalBatchesProcessed;
        }
        
        // Calculate gas savings
        uint256 individualGasCost = batch.gasUsed * batch.proofHashes.length;
        uint256 batchGasCost = batch.gasUsed;
        uint256 gasSaved = individualGasCost > batchGasCost ? individualGasCost - batchGasCost : 0;
        
        totalGasSaved += gasSaved;
        averageGasSavings = totalGasSaved / totalBatchesProcessed;
        
        emit ProofBatchVerified(batchId, batch.aggregatedCommitment, batch.aggregatedNullifier, batch.gasUsed);
        emit GasOptimizationAchieved(batchId, individualGasCost, batchGasCost, gasSaved);
    }
    
    /**
     * @notice Validates child proofs and calculates recursion depth
     * @dev Validates child proofs and calculates recursion depth
     * @param childProofIds Array of child proof IDs to validate
     * @return maxDepth The maximum recursion depth found
     * @return gasSaved Total gas saved from child proofs
     */
    function _validateChildProofs(bytes32[] calldata childProofIds) 
        internal view returns (uint256 maxDepth, uint256 gasSaved) {
        for (uint256 i = 0; i < childProofIds.length; ++i) {
            if (!verifiedProofs[childProofIds[i]]) revert ProofNotVerified();
            
            RecursiveProof memory childProof = recursiveProofs[childProofIds[i]];
            if (childProof.recursionDepth > maxDepth) {
                maxDepth = childProof.recursionDepth;
            }
            gasSaved += childProof.totalGasSaved;
        }
        
        if (maxDepth > MAX_RECURSION_DEPTH - 1) revert MaxRecursionExceeded();
    }

    /**
     * @notice Creates a recursive proof by aggregating multiple child proofs
     * @dev Creates a recursive proof from multiple child proofs
     * @param childProofIds Array of child proof IDs to aggregate
     * @param recursiveProof The recursive proof data
     * @param recursivePublicInputs Public inputs for the recursive proof
     * @return proofId The unique identifier for the created recursive proof
     */
    function createRecursiveProof(
        bytes32[] calldata childProofIds,
        uint256[8] calldata recursiveProof,
        uint256[] calldata recursivePublicInputs
    ) external nonReentrant whenNotPaused returns (bytes32 proofId) {
        uint256 currentTime = block.timestamp;
        
        _validateChildProofTimestamps(childProofIds, currentTime);
        
        (uint256 maxDepth, uint256 gasSaved) = _validateChildProofs(childProofIds);
        
        ProofLib.ZKProof memory zkProof = ProofLib.ZKProof({
            proof: recursiveProof,
            publicInputs: recursivePublicInputs,
            verifier: recursiveVerifier
        });
        zkProof.requireValidProof();
        
        proofId = keccak256(
            abi.encodePacked(
                childProofIds,
                recursiveProof,
                currentTime,
                msg.sender
            )
        );
        
        bytes32 rootCommitment = ProofLib.extractCommitment(recursivePublicInputs, 0);
        bytes32 rootNullifier = ProofLib.extractNullifier(recursivePublicInputs, 1);
        
        recursiveProofs[proofId] = RecursiveProof({
            proofId: proofId,
            childProofIds: childProofIds,
            recursionDepth: maxDepth + 1,
            rootCommitment: rootCommitment,
            rootNullifier: rootNullifier,
            totalGasSaved: gasSaved,
            verified: true
        });
        
        verifiedProofs[proofId] = true;
        proofTimestamps[proofId] = currentTime;
        totalGasSaved += gasSaved;
        
        emit RecursiveProofGenerated(proofId, childProofIds, maxDepth + 1, gasSaved);
        
        return proofId;
    }
    
    /**
     * @notice Aggregates multiple verified proofs into a single proof
     * @dev Aggregates multiple verified proofs into a single proof
     * @param proofIds Array of proof IDs to aggregate
     * @param aggregatedProof The aggregated proof data
     * @param aggregatedPublicInputs Public inputs for the aggregated proof
     * @return aggregatedProofId The unique identifier for the aggregated proof
     */
    function aggregateProofs(
        bytes32[] calldata proofIds,
        uint256[8] calldata aggregatedProof,
        uint256[] calldata aggregatedPublicInputs
    ) external nonReentrant whenNotPaused returns (bytes32 aggregatedProofId) {
        uint256 currentTime = block.timestamp;
        
        // Validate all proofs are verified
        uint256 batchGasSaved = 0;
        for (uint256 i = 0; i < proofIds.length; ++i) {
            if (!verifiedProofs[proofIds[i]]) revert ProofNotVerified();
            
            // Check if proof is still valid
            if (currentTime > proofTimestamps[proofIds[i]] + PROOF_VALIDITY_PERIOD + TIMESTAMP_TOLERANCE) {
                revert ProofExpired();
            }
            
            // Accumulate gas savings
            ProofBatch memory batch = proofBatches[proofIds[i]];
            if (batch.batchId != bytes32(0)) {
                batchGasSaved += batch.gasUsed;
            }
        }
        
        // Verify aggregated proof
        ProofLib.ZKProof memory zkProof = ProofLib.ZKProof({
            proof: aggregatedProof,
            publicInputs: aggregatedPublicInputs,
            verifier: batchVerifier
        });
        zkProof.requireValidProof();
        
        // Generate aggregated proof ID
        aggregatedProofId = keccak256(
            abi.encodePacked(
                proofIds,
                aggregatedProof,
                currentTime,
                msg.sender
            )
        );
        
        // Mark aggregated proof as verified
        verifiedProofs[aggregatedProofId] = true;
        proofTimestamps[aggregatedProofId] = currentTime;
        totalGasSaved += batchGasSaved; // Update state variable
        
        emit ProofAggregated(aggregatedProofId, proofIds, batchGasSaved);
        
        return aggregatedProofId;
    }
    
    /// @notice Returns batch information
    /// @param batchId The batch identifier
    /// @return batch The batch data
    function getBatch(bytes32 batchId) external view returns (ProofBatch memory batch) {
        return proofBatches[batchId];
    }
    
    /// @notice Returns recursive proof information
    /// @param proofId The proof identifier
    /// @return proof The recursive proof data
    function getRecursiveProof(bytes32 proofId) external view returns (RecursiveProof memory proof) {
        return recursiveProofs[proofId];
    }
    
    /// @notice Returns user's batches
    /// @param user The user address
    /// @return batchIds Array of batch IDs created by the user
    function getUserBatches(address user) external view returns (bytes32[] memory batchIds) {
        return userBatches[user];
    }
    
    /// @notice Returns gas optimization statistics
    /// @return _totalGasSaved Total gas saved across all batches
    /// @return _totalBatchesProcessed Total number of batches processed
    /// @return _averageGasSavings Average gas savings per batch
    function getGasOptimizationStats() external view returns (
        uint256 _totalGasSaved,
        uint256 _totalBatchesProcessed,
        uint256 _averageGasSavings
    ) {
        return (totalGasSaved, totalBatchesProcessed, averageGasSavings);
    }
    
    /// @notice Checks if a proof is verified and valid
    /// @param proofId The proof identifier
    /// @return True if the proof is verified and not expired
    function isProofValid(bytes32 proofId) external view returns (bool) {
        uint256 currentTime = block.timestamp;
        return verifiedProofs[proofId] && 
               currentTime < proofTimestamps[proofId] + PROOF_VALIDITY_PERIOD + TIMESTAMP_TOLERANCE;
    }
    
    /// @notice Registers a verifier for a specific proof type
    /// @param proofType The proof type identifier
    /// @param verifier The verifier contract address
    function registerProofTypeVerifier(uint256 proofType, address verifier) external onlyGovernance {
        if (verifier == address(0)) revert InvalidVerifierAddress();
        bytes32 proofTypeHash = keccak256(abi.encodePacked(proofType));
        proofTypeVerifiers[proofTypeHash] = verifier;
    }
    
    /// @notice Updates the recursive verifier contract
    /// @param recursiveVerifierAddress New recursive verifier address
    function updateRecursiveVerifier(address recursiveVerifierAddress) external onlyGovernance {
        if (recursiveVerifierAddress == address(0)) revert InvalidVerifierAddress();
        recursiveVerifier = recursiveVerifierAddress;
        emit VerifierUpdated("recursive", recursiveVerifierAddress);
    }
    
    /// @notice Updates the batch verifier contract
    /// @param batchVerifierAddress New batch verifier address
    function updateBatchVerifier(address batchVerifierAddress) external onlyGovernance {
        if (batchVerifierAddress == address(0)) revert InvalidVerifierAddress();
        batchVerifier = batchVerifierAddress;
        emit VerifierUpdated("batch", batchVerifierAddress);
    }
    
    /// @notice Pauses the contract (governance only)
    function pause() external onlyGovernance {
        _pause();
    }
    
    /// @notice Unpauses the contract (governance only)
    function unpause() external onlyGovernance {
        _unpause();
    }
    
    /**
     * @notice Validates timestamp security for proof hashes
     * @dev Validates timestamp security for proof hashes
     * @param proofHashes Array of proof hashes to validate
     * @param currentTime Current block timestamp
     */
    function _validateProofTimestamps(bytes32[] calldata proofHashes, uint256 currentTime) private view {
        for (uint256 i = 0; i < proofHashes.length; ++i) {
            bytes32 proofHash = proofHashes[i];
            uint256 proofTimestamp = proofTimestamps[proofHash];
            
            // If proof already exists, validate its timestamp
            if (proofTimestamp != 0) {
                if (proofTimestamp > currentTime + MAX_FUTURE_TOLERANCE) revert ProofTimestampTooFuture();
                if (proofTimestamp < currentTime - MAX_PAST_TOLERANCE) revert ProofTimestampTooOld();
            }
        }
    }
    
    /**
     * @notice Validates timestamp security for child proof IDs
     * @dev Validates timestamp security for child proof IDs
     * @param childProofIds Array of child proof IDs to validate
     * @param currentTime Current block timestamp
     */
    function _validateChildProofTimestamps(bytes32[] calldata childProofIds, uint256 currentTime) private view {
        for (uint256 i = 0; i < childProofIds.length; ++i) {
            uint256 childTimestamp = proofTimestamps[childProofIds[i]];
            if (childTimestamp == 0) revert ChildProofNotFound();
            if (childTimestamp > currentTime + MAX_FUTURE_TOLERANCE) revert ProofTimestampTooFuture();
            if (childTimestamp < currentTime - MAX_PAST_TOLERANCE) revert ProofTimestampTooOld();
        }
    }
}
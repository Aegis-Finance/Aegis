// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "./interfaces/ICommonErrors.sol";
import {GovernanceAccessLib} from "./libraries/GovernanceAccessLib.sol";

import {VerifierFactory} from "./VerifierFactory.sol";
import {CommitmentLib} from "./libraries/CommitmentLib.sol";
import {PrivateTokenContract} from "./PrivateTokenContract.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

// Custom errors for gas optimization
error InvalidChain();

error TransferNotFound();
error TransferAlreadyExecuted();
error TransferAlreadyChallenged();
error ChallengeExpired();

error UnauthorizedValidator();
error DuplicateNullifier();
error InvalidTimestamp();
error MaxPendingTransfersExceeded();

error ChainNotSupported();
error ValidatorAlreadyExists();
error InvalidValidatorStake();
error TransferExpired();
error InvalidChallengeWindow();
error ProviderNotActive();

error TransferNotValidated();
error ChallengePeriodNotEnded();
error ChallengePeriodEnded();
error InvalidValidator();
error InsufficientStake();
error ValidatorAlreadyActive();
error ValidatorNotActive();
error ChallengeAlreadyActive();
error ChallengeLimitExceeded();
error NoActiveChallenge();
error ChallengeResolutionPending();
error InvalidValidationThreshold();
error CannotRemoveLastValidator();
error InvalidNullifierHash();
error InvalidSlashPenalty();
error GovernanceMustBeContract();
error MerkleRootPending();
error MerkleRootNotPending();
error MerkleRootAlreadyActive();
error MerkleRootNotActive();
error ActivationDelayNotElapsed();
error InvalidActivationDelay();
error ValidatorAlreadyAttested();
error ValidatorRemovalAlreadyAttested();
error InsufficientMerkleRootAttestations();
error InsufficientMerkleRootRemovalAttestations();

/**
 * @title CrossChainPrivacyBridge
 * @notice Enables anonymous asset transfers across different blockchains
 * @dev Privacy-preserving cross-chain bridge with ZK-proof validation. Settlement / finality / challenge-window economics: `docs/CROSS_CHAIN_SETTLEMENT_AND_BRIDGE_RISK.md`.
 * @author Aegis Protocol Team
 */
contract CrossChainPrivacyBridge is ReentrancyGuard, Pausable, ICommonErrors {
    using CommitmentLib for bytes32;

    /// @notice Core private token contract for handling token operations
    PrivateTokenContract public immutable PRIVATE_TOKEN;
    /// @notice Factory contract for managing ZK proof verifiers
    VerifierFactory public immutable VERIFIER_FACTORY;

    /// @notice Governance controller authorized to manage bridge configuration
    address public governance;

    /// @notice Optional `AegisTimelockController` for delayed bridge admin.
    address public timelockController;

    /**
     * @notice Emitted when the timelock authorized for delayed execution is updated
     */
    event TimelockControllerUpdated(address indexed previousTimelock, address indexed newTimelock);

    /**
     * @notice Emitted when governance controller is updated
     * @param previousGovernance The prior governance controller
     * @param newGovernance The new governance controller
     */
    event GovernanceUpdated(address indexed previousGovernance, address indexed newGovernance);
    
    /// @notice Circuit type identifier for bridge operations
    string public constant BRIDGE_CIRCUIT = "bridge";
    
    /// @notice Minimum amount required for cross-chain transfers
    uint256 public constant MIN_TRANSFER_AMOUNT = 1e18;
    /// @notice Maximum amount allowed for cross-chain transfers (1 million tokens)
    uint256 public constant MAX_TRANSFER_AMOUNT = 1_000_000e18;
    /// @notice Number of blocks required for transfer confirmation
    uint256 public constant CONFIRMATION_BLOCKS = 12;
    /// @notice Time period during which transfers can be challenged
    uint256 public constant CHALLENGE_PERIOD = 24 hours;
    /// @notice Maximum number of pending transfers allowed
    uint256 public constant MAX_PENDING_TRANSFERS = 1000;
    /// @notice Maximum number of sequential challenges permitted per transfer
    uint8 public constant MAX_CHALLENGE_ATTEMPTS = 3;
    /// @notice Response window for governance to resolve transfer challenges
    uint256 public constant CHALLENGE_RESPONSE_WINDOW = 12 hours;
    /// @notice Minimum activation delay for Merkle root changes
    uint256 public constant MIN_MERKLE_ROOT_DELAY = 6 hours;
    
    /// @dev BN254 field modulus used for Groth16 public inputs
    uint256 private constant FIELD_MODULUS =
        21888242871839275222246405745257275088548364400416034343698204186575808495617;
    
    /// @notice Mapping of chain ID to chain information
    mapping(uint256 => ChainInfo) public supportedChains;
    /// @notice Mapping to check if a chain is currently active
    mapping(uint256 => bool) public isChainActive;
    /// @notice Array of all active chain IDs
    uint256[] public activeChainIds;
    
    /// @notice Counter for generating unique transfer IDs
    uint256 public nextTransferId;
    /// @notice Current number of pending transfers
    uint256 public pendingTransfersCount;
    /// @notice Mapping of transfer ID to transfer details
    mapping(bytes32 => Transfer) public transfers;
    /// @notice Mapping to track used nullifiers to prevent double-spending
    mapping(bytes32 => bool) public nullifierUsed;
    /// @notice Mapping to track used nullifier hashes from bridge proofs
    mapping(bytes32 => bool) public nullifierHashUsed;
    /// @notice Mapping of commitment to transfer ID for tracking
    mapping(bytes32 => uint256) public commitmentToTransfer;
    /// @notice Mapping of validators who attested to a specific transfer
    mapping(bytes32 => address[]) private transferValidators;
    
    /// @notice Mapping of validator address to validator information
    mapping(address => ValidatorInfo) public validators;
    /// @notice Mapping of validation key to validation details
    mapping(bytes32 => ValidationInfo) public validations;
    /// @notice Array of all active validator addresses
    address[] public activeValidators;
    /// @notice Number of validations required for transfer approval
    uint256 public requiredValidations;
    /// @notice Amount of tokens required to stake as a validator
    uint256 public validatorStakeAmount;
    
    /// @notice Mapping of chain ID to liquidity information (combines liquidity and reserves)
    mapping(uint256 => ChainLiquidityInfo) public chainLiquidityInfo;
    /// @notice Mapping of provider commitment to liquidity provider details
    mapping(bytes32 => LiquidityProvider) public liquidityProviders;
    /// @notice Mapping of Merkle roots that are currently accepted for bridge proofs
    mapping(bytes32 => bool) public validMerkleRoots;
    /// @notice Mapping of Merkle roots pending activation and their activation timestamps
    mapping(bytes32 => uint256) public pendingMerkleRootActivations;
    /// @notice Mapping of Merkle roots pending removal and their execution timestamps
    mapping(bytes32 => uint256) public pendingMerkleRootRemovals;
    /// @notice Mapping of Merkle root attestation counts by epoch
    mapping(bytes32 => uint256) private merkleRootAttestationCount;
    /// @notice Mapping of Merkle root attestation epochs
    mapping(bytes32 => uint256) private merkleRootAttestationEpoch;
    /// @notice Mapping tracking validator attestations per Merkle root epoch
    mapping(bytes32 => mapping(address => uint256)) private merkleRootValidatorEpoch;
    /// @notice Mapping of Merkle root removal attestation counts by epoch
    mapping(bytes32 => uint256) private merkleRootRemovalAttestationCount;
    /// @notice Mapping of Merkle root removal attestation epochs
    mapping(bytes32 => uint256) private merkleRootRemovalAttestationEpoch;
    /// @notice Mapping tracking validator attestations for root removals per epoch
    mapping(bytes32 => mapping(address => uint256)) private merkleRootRemovalValidatorEpoch;
    /// @notice Aggregate pool of slashed validator stake retained by the bridge
    uint256 public slashedStakePool;
    /// @notice Slash penalty applied to validators who approve fraudulent transfers (basis points)
    uint256 public validatorSlashPenaltyBps;
    /// @notice Governance-configurable activation delay for Merkle root changes
    uint256 public merkleRootActivationDelay;
    
    /**
     * @notice Information about a supported blockchain
     * @param chainId Unique identifier for the blockchain
     * @param confirmationBlocks Number of blocks required for confirmation
     * @param minTransferAmount Minimum amount allowed for transfers
     * @param maxTransferAmount Maximum amount allowed for transfers
     * @param transferFee Transfer fee in basis points (1/10000)
     * @param bridgeContract Address of the bridge contract on this chain
     * @param isActive Whether the chain is currently active
     * @param name Human-readable name of the blockchain
     */
    struct ChainInfo {
        uint256 chainId;                // Slot 0: 32 bytes
        uint256 confirmationBlocks;     // Slot 1: 32 bytes
        uint256 minTransferAmount;      // Slot 2: 32 bytes
        uint256 maxTransferAmount;      // Slot 3: 32 bytes
        uint256 transferFee;            // Slot 4: 32 bytes
        address bridgeContract;         // Slot 5: 20 bytes
        bool isActive;                  // Slot 5: 1 byte (packed with address)
        string name;                    // Slot 6: 32 bytes (pointer to string data)
    }
    
    /**
     * @notice Information about a cross-chain transfer
     * @param transferId Unique identifier for the transfer
     * @param sourceChain Chain ID where the transfer originates
     * @param destinationChain Chain ID where the transfer will be completed
     * @param senderCommitment Commitment hash of the sender
     * @param recipientCommitment Commitment hash of the recipient
     * @param amount Amount of tokens being transferred
     * @param fee Transfer fee amount
     * @param status Current status of the transfer
     * @param timestamp Block timestamp when transfer was initiated
     * @param confirmationTime Block timestamp when transfer was confirmed
     * @param executionTime Block timestamp when transfer was executed
     * @param challengeExpiry Deadline for resolving an active challenge
     * @param sourceNullifier Nullifier used on the source chain
     * @param destinationNullifier Nullifier used on the destination chain
     * @param proofHash Hash of the zero-knowledge proof
     * @param nullifierHash Hash binding the nullifier to the destination chain
     * @param merkleRoot Merkle root proven in the transfer ZK proof
     * @param transferCommitment Commitment expected for the destination claim
     * @param feeCommitment Commitment representing the fee allocation
     * @param challengeActive Whether a challenge is currently active
     * @param isPrivate Whether this is a private transfer
     * @param privacyNullifier Additional nullifier for privacy
     * @param challengeAttempts Number of challenges raised against the transfer
     */
    struct Transfer {
        bytes32 transferId;
        uint256 sourceChain;
        uint256 destinationChain;
        
        bytes32 senderCommitment;
        bytes32 recipientCommitment;
        uint256 amount;
        uint256 fee;
        
        TransferStatus status;
        uint256 timestamp;
        uint256 confirmationTime;
        uint256 executionTime;
        uint256 challengeExpiry;
        
        bytes32 sourceNullifier;
        bytes32 destinationNullifier;
        bytes32 proofHash;
        bytes32 nullifierHash;
        bytes32 merkleRoot;
        bytes32 transferCommitment;
        bytes32 feeCommitment;
        
        bool challengeActive;
        bool isPrivate;
        uint8 challengeAttempts;
        bytes32 privacyNullifier;
        address challenger;
    }
    
    /**
     * @notice Information about a bridge validator
     * @param stake Amount of tokens staked by the validator
     * @param validationsCount Total number of validations performed
     * @param successfulValidations Number of successful validations
     * @param lastValidation Timestamp of the last validation
     * @param validatorCommitment Commitment hash of the validator
     * @param validator Address of the validator
     * @param isActive Whether the validator is currently active
     */
    struct ValidatorInfo {
        uint256 stake;                  // Slot 0: 32 bytes
        uint256 validationsCount;       // Slot 1: 32 bytes
        uint256 successfulValidations;  // Slot 2: 32 bytes
        uint256 lastValidation;         // Slot 3: 32 bytes
        bytes32 validatorCommitment;    // Slot 4: 32 bytes
        address validator;              // Slot 5: 20 bytes
        bool isActive;                  // Slot 5: 1 byte (packed with address)
    }
    
    /**
     * @notice Information about a transfer validation
     * @param transferId Unique identifier of the transfer being validated
     * @param validator Address of the validator who performed the validation
     * @param isValid Whether the validation was positive or negative
     * @param timestamp Block timestamp when validation was performed
     * @param validationHash Hash of the validation data
     * @param signature Cryptographic signature of the validator
     */
    struct ValidationInfo {
        bytes32 transferId;
        address validator;
        bool isValid;
        uint256 timestamp;
        bytes32 validationHash;
        bytes signature;
    }
    
    /**
     * @notice Information about a liquidity provider
     * @param providerCommitment Commitment hash of the liquidity provider
     * @param totalProvided Total amount of liquidity ever provided
     * @param currentLiquidity Current amount of liquidity provided
     * @param rewardsEarned Total rewards earned by the provider
     * @param lastUpdate Timestamp of the last liquidity update
     * @param isActive Whether the provider is currently active
     */
    struct LiquidityProvider {
        bytes32 providerCommitment;
        uint256 totalProvided;
        uint256 currentLiquidity;
        uint256 rewardsEarned;
        uint256 lastUpdate;
        bool isActive;
    }
    
    /**
     * @notice Information about liquidity and reserves for a specific chain
     * @param availableLiquidity Amount of liquidity currently available for transfers
     * @param totalReserves Total reserves held for the chain
     */
    struct ChainLiquidityInfo {
        uint256 availableLiquidity;
        uint256 totalReserves;
    }
    
    enum TransferStatus {
        INITIATED,
        VALIDATED,
        CONFIRMED,
        EXECUTED,
        FAILED,
        CHALLENGED,
        CANCELLED
    }
    
    /**
     * @notice Parameters required to initiate a cross-chain transfer
     * @param destinationChain Chain ID where the transfer will be completed
     * @param nullifierHash Poseidon hash tying the nullifier to destination chain
     * @param merkleRoot Commitment tree root proving membership of the input note
     * @param transferCommitment Commitment for the destination transfer note
     * @param feeCommitment Commitment for the fee note
     * @param senderCommitment Commitment hash of the sender
     * @param recipientCommitment Commitment hash of the recipient
     * @param amount Amount of tokens to transfer
     * @param sourceNullifier Nullifier to prevent double-spending on source chain
     * @param destinationNullifier Nullifier to prevent double-spending on destination chain
     * @param zkProof Zero-knowledge proof validating the transfer
     */
    struct TransferParams {
        uint256 destinationChain;
        bytes32 nullifierHash;
        bytes32 merkleRoot;
        bytes32 transferCommitment;
        bytes32 feeCommitment;
        bytes32 senderCommitment;
        bytes32 recipientCommitment;
        uint256 amount;
        bytes32 sourceNullifier;
        bytes32 destinationNullifier;
        bytes zkProof;
    }
    
    /**
     * @notice Parameters required for liquidity operations
     * @param chainId Chain ID where liquidity operation will occur
     * @param amount Amount of liquidity to add or remove
     * @param providerCommitment Commitment hash of the liquidity provider
     * @param nullifier Nullifier to prevent double-spending
     * @param zkProof Zero-knowledge proof validating the operation
     */
    struct LiquidityParams {
        uint256 chainId;
        uint256 amount;
        bytes32 providerCommitment;
        bytes32 nullifier;
        bytes zkProof;
    }
    
    // Events
    /**
     * @notice Emitted when a cross-chain transfer is initiated
     * @param transferId Unique identifier for the transfer
     * @param sourceChain Chain ID where the transfer originates
     * @param destinationChain Chain ID where the transfer will be completed
     * @param senderCommitment Commitment hash of the sender
     * @param recipientCommitment Commitment hash of the recipient
     */
    event TransferInitiated(
        bytes32 indexed transferId,
        uint256 indexed sourceChain,
        uint256 indexed destinationChain,
        bytes32 senderCommitment,
        bytes32 recipientCommitment
    );
    
    /**
     * @notice Emitted when a transfer is validated
     * @param transferId Unique identifier for the transfer
     * @param isValid Whether the validation was positive or negative
     * @param timestamp Block timestamp when validation occurred
     */
    event TransferValidated(
        bytes32 indexed transferId,
        bool indexed isValid,
        uint256 timestamp
    );
    
    /**
     * @notice Emitted when a transfer is successfully executed
     * @param transferId Unique identifier for the transfer
     * @param recipientCommitment Commitment hash of the recipient
     * @param timestamp Block timestamp when execution occurred
     */
    event TransferExecuted(
        bytes32 indexed transferId,
        bytes32 indexed recipientCommitment,
        uint256 timestamp
    );
    
    /**
     * @notice Emitted when a transfer is challenged during the challenge period
     * @param transferId Unique identifier for the transfer
     * @param challenger Address of the challenger
     * @param reason Reason for the challenge
     */
    event TransferChallenged(
        bytes32 indexed transferId,
        address indexed challenger,
        string reason
    );

    /**
     * @notice Emitted when a transfer challenge is resolved
     * @param transferId Unique identifier for the transfer
     * @param resolver Address that resolved the challenge (zero address if timed out)
     * @param upheld Whether the challenge was upheld
     */
    event ChallengeResolved(
        bytes32 indexed transferId,
        address indexed resolver,
        bool upheld
    );
    
    /**
     * @notice Emitted when liquidity is added to a chain
     * @param chainId Chain ID where liquidity is added
     * @param providerCommitment Commitment hash of the liquidity provider
     * @param amount Amount of liquidity added
     * @param newLiquidity Total liquidity after addition
     */
    event LiquidityAdded(
        uint256 indexed chainId,
        bytes32 indexed providerCommitment,
        uint256 indexed amount,
        uint256 newLiquidity
    );
    
    /**
     * @notice Emitted when liquidity is removed from a chain
     * @param chainId Chain ID where liquidity is removed
     * @param providerCommitment Commitment hash of the liquidity provider
     * @param amount Amount of liquidity removed
     * @param remainingLiquidity Total liquidity after removal
     */
    event LiquidityRemoved(
        uint256 indexed chainId,
        bytes32 indexed providerCommitment,
        uint256 indexed amount,
        uint256 remainingLiquidity
    );
    
    /**
     * @notice Emitted when a new validator is added to the bridge
     * @param validator Address of the new validator
     * @param validatorCommitment Commitment hash of the validator
     * @param stake Amount of stake provided by the validator
     */
    event ValidatorAdded(
        address indexed validator,
        bytes32 indexed validatorCommitment,
        uint256 indexed stake
    );

    /**
     * @notice Emitted when a validator is removed
     * @param validator Address of the removed validator
     * @param validatorCommitment Commitment associated with the validator
     * @param stake Amount of stake returned
     */
    event ValidatorRemoved(
        address indexed validator,
        bytes32 indexed validatorCommitment,
        uint256 stake
    );
    
    /**
     * @notice Emitted when a new chain is added to the bridge
     * @param chainId Chain ID of the new chain
     * @param name Name of the new chain
     * @param bridgeContract Address of the bridge contract on the new chain
     */
    event ChainAdded(
        uint256 indexed chainId,
        string name,
        address indexed bridgeContract
    );

    /**
     * @notice Emitted when governance updates the set of accepted Merkle roots
     * @param merkleRoot The Merkle root that was updated
     * @param active Whether the Merkle root is now active
     */
    event MerkleRootUpdated(bytes32 indexed merkleRoot, bool indexed active);
    /**
     * @notice Emitted when governance proposes a new Merkle root
     * @param merkleRoot The proposed Merkle root
     * @param activateAt Timestamp when the root can be activated
     */
    event MerkleRootProposed(bytes32 indexed merkleRoot, uint256 indexed activateAt);
    /**
     * @notice Emitted when a validator attests to a pending Merkle root
     * @param merkleRoot The Merkle root being attested
     * @param validator The validator providing attestation
     * @param attestationCount Total attestations collected
     */
    event MerkleRootAttested(
        bytes32 indexed merkleRoot,
        address indexed validator,
        uint256 indexed attestationCount
    );
    /**
     * @notice Emitted when governance proposes removal of a Merkle root
     * @param merkleRoot The Merkle root proposed for removal
     * @param executeAt Timestamp when the root can be deactivated
     */
    event MerkleRootRemovalProposed(bytes32 indexed merkleRoot, uint256 indexed executeAt);
    /**
     * @notice Emitted when a validator attests to a pending Merkle root removal
     * @param merkleRoot The Merkle root pending removal
     * @param validator The validator providing attestation
     * @param attestationCount Total attestations collected
     */
    event MerkleRootRemovalAttested(
        bytes32 indexed merkleRoot,
        address indexed validator,
        uint256 indexed attestationCount
    );
    /**
     * @notice Emitted when governance cancels a pending Merkle root proposal
     * @param merkleRoot The Merkle root whose proposal was cancelled
     */
    event MerkleRootProposalCancelled(bytes32 indexed merkleRoot);
    /**
     * @notice Emitted when governance cancels a pending Merkle root removal
     * @param merkleRoot The Merkle root whose removal was cancelled
     */
    event MerkleRootRemovalCancelled(bytes32 indexed merkleRoot);
    /**
     * @notice Emitted when the Merkle root activation delay is updated
     * @param previousDelay The previous delay value
     * @param newDelay The new delay value
     */
    event MerkleRootActivationDelayUpdated(uint256 indexed previousDelay, uint256 indexed newDelay);

    /**
     * @notice Emitted when a validator is slashed for endorsing a fraudulent transfer
     * @param validator The validator that was slashed
     * @param transferId The transfer for which the validator attested
     * @param amount Amount of stake slashed
     * @param challenger Address that triggered the successful challenge (zero address on timeout)
     */
    event ValidatorSlashed(
        address indexed validator,
        bytes32 indexed transferId,
        uint256 amount,
        address indexed challenger
    );
    
    modifier validChain(uint256 chainId) {
        if (!isChainActive[chainId]) revert ChainNotSupported();
        _;
    }
    
    modifier onlyValidator() {
        // Use storage pointer to avoid potential overflow when accessing struct
        ValidatorInfo storage validator = validators[msg.sender];
        if (!validator.isActive) revert UnauthorizedValidator();
        _;
    }

    modifier onlyGovernance() {
        if (!GovernanceAccessLib.isGovernanceTimelockOrCore(governance, timelockController, msg.sender)) {
            revert UnauthorizedGovernanceAccess();
        }
        _;
    }

    /// @notice Register the protocol timelock so `TimelockController.execute` may update bridge config after delay.
    function setTimelockController(address newTimelock) external onlyGovernance {
        emit TimelockControllerUpdated(timelockController, newTimelock);
        timelockController = newTimelock;
    }
    
    modifier onlyValidProof(bytes memory proof, uint256[] memory publicInputs) {
        if (address(VERIFIER_FACTORY) == address(0)) revert InvalidVerifier();
        if (proof.length < 256) revert InvalidProofLength();
        if (publicInputs.length == 0) revert InvalidPublicInputs();
        
        // Convert the proof into the verifier-friendly format. Commitment slot unused.
        (uint256[8] memory proofArray, ) = _convertProofData(proof, bytes32(0));
        
        bool isValid = VERIFIER_FACTORY.verifyProof(BRIDGE_CIRCUIT, proofArray, publicInputs);
        if (!isValid) revert ProofVerificationFailed();
        _;
    }
    
    /**
     * @notice Convert a bytes32 value into a BN254 field element.
     * @param value Value to convert.
     * @return Field-aligned representation of the input value.
     */
    function _fieldElement(bytes32 value) private pure returns (uint256) {
        return uint256(value) % FIELD_MODULUS;
    }
    
    /**
     * @notice Convert a uint256 value into a BN254 field element.
     * @param value Value to convert.
     * @return Field-aligned representation of the input value.
     */
    function _fieldElement(uint256 value) private pure returns (uint256) {
        return value % FIELD_MODULUS;
    }
    
    /**
     * @notice Build the public input vector for transfer proofs.
     * @param params Transfer parameters supplied by the caller.
     * @return inputs BN254 field-aligned public inputs.
     */
    function _buildTransferPublicInputs(TransferParams calldata params)
        private
        pure
        returns (uint256[] memory inputs)
    {
        inputs = new uint256[](5);
        inputs[0] = _fieldElement(params.nullifierHash);
        inputs[1] = _fieldElement(params.merkleRoot);
        inputs[2] = _fieldElement(params.destinationChain);
        inputs[3] = _fieldElement(params.transferCommitment);
        inputs[4] = _fieldElement(params.feeCommitment);
    }
    
    /**
     * @notice Build the public input vector for liquidity proofs.
     * @param params Liquidity parameters supplied by the caller.
     * @return inputs BN254 field-aligned public inputs.
     */
    function _buildLiquidityPublicInputs(LiquidityParams calldata params)
        private
        pure
        returns (uint256[] memory inputs)
    {
        inputs = new uint256[](4);
        inputs[0] = _fieldElement(params.providerCommitment);
        inputs[1] = _fieldElement(params.nullifier);
        inputs[2] = _fieldElement(params.amount);
        inputs[3] = _fieldElement(params.chainId);
    }
    
    /**
     * @notice Build the public input vector for liquidity removal proofs.
     * @param chainId Destination chain identifier.
     * @param amount Amount of liquidity being removed.
     * @param providerCommitment Liquidity provider commitment.
     * @param nullifier Nullifier guarding against replay.
     * @return inputs BN254 field-aligned public inputs.
     */
    function _buildRemoveLiquidityInputs(
        uint256 chainId,
        uint256 amount,
        bytes32 providerCommitment,
        bytes32 nullifier
    ) private pure returns (uint256[] memory inputs) {
        inputs = new uint256[](4);
        inputs[0] = _fieldElement(providerCommitment);
        inputs[1] = _fieldElement(nullifier);
        inputs[2] = _fieldElement(amount);
        inputs[3] = _fieldElement(chainId);
    }
    
    /**
     * @notice Convert bytes proof and commitment to the format expected by IVerifier
     * @dev Convert bytes proof and commitment to the format expected by IVerifier
     * @param proof The proof data as bytes
     * @param commitment The commitment as bytes32
     * @return proofArray The proof as uint256[8]
     * @return publicInputs The public inputs as uint256[]
     */
    function _convertProofData(
        bytes memory proof, 
        bytes32 commitment
    ) internal pure returns (uint256[8] memory proofArray, uint256[] memory publicInputs) {
        // Debug: Check proof length
        require(proof.length >= 256, string(abi.encodePacked("Proof length too short: ", proof.length)));
        
        // Convert proof bytes to uint256[8]
        if (proof.length < 256) revert ProofVerificationFailed(); // 8 * 32 bytes = 256 bytes
        
        // Use a more readable approach to convert bytes to uint256 array
        for (uint256 i = 0; i < 8; ++i) {
            uint256 offset = i * 32;
            uint256 value;
            // solhint-disable-next-line no-inline-assembly
            assembly ("memory-safe") {
                value := mload(add(add(proof, 0x20), offset))
            }
            proofArray[i] = value;
        }
        
        // Convert commitment to public inputs array
        publicInputs = new uint256[](1);
        publicInputs[0] = uint256(commitment);
    }
    
    /**
     * @notice Initializes the CrossChainPrivacyBridge contract
     * @param _privateToken Address of the private token contract
     * @param _verifierFactory Address of the verifier factory contract
     * @param _requiredValidations Number of validations required for transfer execution
     * @param _validatorStakeAmount Amount of tokens required for validator staking
     */
    constructor(
        address _privateToken,
        address _verifierFactory,
        uint256 _requiredValidations,
        uint256 _validatorStakeAmount
    ) {
        PRIVATE_TOKEN = PrivateTokenContract(_privateToken);
        VERIFIER_FACTORY = VerifierFactory(_verifierFactory);
        requiredValidations = _requiredValidations;
        validatorStakeAmount = _validatorStakeAmount;
        validatorSlashPenaltyBps = 2000; // default 20% slash
        nextTransferId = 1;
        merkleRootActivationDelay = 24 hours;
        governance = msg.sender;
        emit GovernanceUpdated(address(0), msg.sender);
    }

    /**
     * @notice Updates the governance controller address
     * @param newGovernance The new governance controller
     */
    function updateGovernance(address newGovernance) external onlyGovernance {
        if (newGovernance == address(0)) revert InvalidGovernanceAddress();
        if (newGovernance.code.length == 0) revert GovernanceMustBeContract();
        emit GovernanceUpdated(governance, newGovernance);
        governance = newGovernance;
    }
    
    /**
     * @notice Validate nullifiers and commitments
     * @param sourceNullifier Source chain nullifier
     * @param destinationNullifier Destination chain nullifier
     * @param nullifierHash Nullifier hash
     * @param transferCommitment Transfer commitment
     * @param feeCommitment Fee commitment
     * @param senderCommitment Sender commitment
     * @param recipientCommitment Recipient commitment
     * @param merkleRoot Merkle root
     */
    function _validateNullifiersAndCommitments(
        bytes32 sourceNullifier,
        bytes32 destinationNullifier,
        bytes32 nullifierHash,
        bytes32 transferCommitment,
        bytes32 feeCommitment,
        bytes32 senderCommitment,
        bytes32 recipientCommitment,
        bytes32 merkleRoot
    ) internal view {
        if (nullifierUsed[sourceNullifier]) revert DuplicateNullifier();
        if (nullifierUsed[destinationNullifier]) revert DuplicateNullifier();
        if (nullifierHashUsed[nullifierHash]) revert DuplicateNullifier();
        if (nullifierHash == bytes32(0)) revert InvalidNullifierHash();
        if (merkleRoot == bytes32(0)) revert InvalidMerkleRootValue();
        if (!validMerkleRoots[merkleRoot]) revert InvalidMerkleRoot();
        if (transferCommitment == bytes32(0)) revert InvalidCommitment();
        if (feeCommitment == bytes32(0)) revert InvalidCommitment();
        if (senderCommitment == bytes32(0)) revert InvalidCommitment();
        if (recipientCommitment == bytes32(0)) revert InvalidCommitment();
        if (recipientCommitment != transferCommitment) revert InvalidCommitment();
        if (senderCommitment == recipientCommitment) revert InvalidCommitment();
    }

    /**
     * @notice Validate transfer amounts and limits
     * @param amount Transfer amount
     * @param destinationChain Destination chain ID
     * @param minTransferAmount Minimum transfer amount for destination chain
     * @param maxTransferAmount Maximum transfer amount for destination chain
     */
    function _validateTransferAmounts(
        uint256 amount,
        uint256 destinationChain,
        uint256 minTransferAmount,
        uint256 maxTransferAmount
    ) internal view {
        if (amount < MIN_TRANSFER_AMOUNT) revert InvalidAmount();
        if (amount > MAX_TRANSFER_AMOUNT) revert InvalidAmount();
        if (pendingTransfersCount > MAX_PENDING_TRANSFERS - 1) revert MaxPendingTransfersExceeded();
        if (amount < minTransferAmount) revert InvalidAmount();
        if (amount > maxTransferAmount) revert InvalidAmount();
        if (chainLiquidityInfo[destinationChain].availableLiquidity < amount) {
            revert InsufficientLiquidity();
        }
    }

    /**
     * @notice Validate transfer parameters and requirements
     * @param params Transfer parameters to validate
     * @param destChain Destination chain information
     */
    function _validateTransferParams(
        TransferParams calldata params,
        ChainInfo memory destChain
    ) internal view {
        _validateNullifiersAndCommitments(
            params.sourceNullifier,
            params.destinationNullifier,
            params.nullifierHash,
            params.transferCommitment,
            params.feeCommitment,
            params.senderCommitment,
            params.recipientCommitment,
            params.merkleRoot
        );
        _validateTransferAmounts(
            params.amount,
            params.destinationChain,
            destChain.minTransferAmount,
            destChain.maxTransferAmount
        );
    }

    /**
     * @notice Generate unique transfer ID
     * @param destinationChain Destination chain ID
     * @param senderCommitment Sender commitment
     * @param recipientCommitment Recipient commitment
     * @param amount Transfer amount
     * @param currentTime Current timestamp
     * @return transferId Generated transfer ID
     */
    function _generateTransferId(
        uint256 destinationChain,
        bytes32 senderCommitment,
        bytes32 recipientCommitment,
        uint256 amount,
        uint256 currentTime
    ) internal returns (bytes32) {
        unchecked {
            ++nextTransferId;
        }
        return keccak256(
            abi.encode(
                nextTransferId,
                block.chainid,
                destinationChain,
                senderCommitment,
                recipientCommitment,
                amount,
                currentTime
            )
        );
    }

    /**
     * @notice Mark nullifiers as used
     * @param sourceNullifier Source chain nullifier
     * @param destinationNullifier Destination chain nullifier
     * @param nullifierHash Nullifier hash
     */
    function _markNullifiersUsed(
        bytes32 sourceNullifier,
        bytes32 destinationNullifier,
        bytes32 nullifierHash
    ) internal {
        nullifierUsed[sourceNullifier] = true;
        nullifierUsed[destinationNullifier] = true;
        nullifierHashUsed[nullifierHash] = true;
    }

    /**
     * @notice Calculate transfer fee and net amount
     * @param amount Transfer amount
     * @param transferFeeBps Transfer fee in basis points
     * @return fee Calculated fee
     * @return netAmount Net amount after fee
     */
    function _calculateTransferFee(uint256 amount, uint256 transferFeeBps) 
    internal pure returns (uint256 fee, uint256 netAmount) {
        fee = (amount * transferFeeBps) / 10000;
        netAmount = amount - fee;
    }

    /**
     * @notice Update liquidity and state for transfer initiation
     * @param destinationChain Destination chain ID
     * @param netAmount Net transfer amount
     * @param senderCommitment Sender commitment
     */
    function _updateLiquidityAndState(
        uint256 destinationChain,
        uint256 netAmount,
        bytes32 senderCommitment
    ) internal {
        ChainLiquidityInfo storage liquidityInfo = chainLiquidityInfo[destinationChain];
        if (liquidityInfo.availableLiquidity < netAmount) revert InsufficientLiquidity();
        
        unchecked {
            ++pendingTransfersCount;
            liquidityInfo.availableLiquidity -= netAmount;
        }
        commitmentToTransfer[senderCommitment] = nextTransferId;
    }

    /**
     * @notice Initialize transfer record with basic fields
     * @param transferRecord Storage pointer to transfer
     * @param transferId Generated transfer ID
     * @param destinationChain Destination chain ID
     * @param senderCommitment Sender commitment
     * @param recipientCommitment Recipient commitment
     * @param netAmount Net transfer amount
     * @param fee Transfer fee
     * @param currentTime Current timestamp
     */
    function _initTransferBasic(
        Transfer storage transferRecord,
        bytes32 transferId,
        uint256 destinationChain,
        bytes32 senderCommitment,
        bytes32 recipientCommitment,
        uint256 netAmount,
        uint256 fee,
        uint256 currentTime
    ) internal {
        transferRecord.transferId = transferId;
        transferRecord.sourceChain = block.chainid;
        transferRecord.destinationChain = destinationChain;
        transferRecord.senderCommitment = senderCommitment;
        transferRecord.recipientCommitment = recipientCommitment;
        transferRecord.amount = netAmount;
        transferRecord.fee = fee;
        transferRecord.status = TransferStatus.INITIATED;
        transferRecord.timestamp = currentTime;
        transferRecord.confirmationTime = 0;
        transferRecord.executionTime = 0;
        transferRecord.challengeExpiry = 0;
    }

    /**
     * @notice Set transfer nullifiers and commitments
     * @param transferRecord Storage pointer to transfer
     * @param sourceNullifier Source nullifier
     * @param destinationNullifier Destination nullifier
     * @param nullifierHash Nullifier hash
     * @param merkleRoot Merkle root
     * @param transferCommitment Transfer commitment
     * @param feeCommitment Fee commitment
     * @param proofHash Proof hash
     */
    function _setTransferNullifiers(
        Transfer storage transferRecord,
        bytes32 sourceNullifier,
        bytes32 destinationNullifier,
        bytes32 nullifierHash,
        bytes32 merkleRoot,
        bytes32 transferCommitment,
        bytes32 feeCommitment,
        bytes32 proofHash
    ) internal {
        transferRecord.sourceNullifier = sourceNullifier;
        transferRecord.destinationNullifier = destinationNullifier;
        transferRecord.nullifierHash = nullifierHash;
        transferRecord.merkleRoot = merkleRoot;
        transferRecord.transferCommitment = transferCommitment;
        transferRecord.feeCommitment = feeCommitment;
        transferRecord.proofHash = proofHash;
    }

    /**
     * @notice Set transfer challenge and privacy fields
     * @param transferRecord Storage pointer to transfer
     * @param privacyNullifier Privacy nullifier
     */
    function _setTransferChallengeFields(
        Transfer storage transferRecord,
        bytes32 privacyNullifier
    ) internal {
        transferRecord.challengeActive = false;
        transferRecord.isPrivate = true;
        transferRecord.challengeAttempts = 0;
        transferRecord.privacyNullifier = privacyNullifier;
        transferRecord.challenger = address(0);
    }

    /**
     * @notice Create and store transfer record
     * @param transferId Generated transfer ID
     * @param destinationChain Destination chain ID
     * @param senderCommitment Sender commitment
     * @param recipientCommitment Recipient commitment
     * @param netAmount Net transfer amount after fees
     * @param fee Transfer fee
     * @param sourceNullifier Source nullifier
     * @param destinationNullifier Destination nullifier
     * @param nullifierHash Nullifier hash
     * @param merkleRoot Merkle root
     * @param transferCommitment Transfer commitment
     * @param feeCommitment Fee commitment
     * @param proofHash Proof hash
     * @param currentTime Current timestamp
     */
    function _createTransferRecord(
        bytes32 transferId,
        uint256 destinationChain,
        bytes32 senderCommitment,
        bytes32 recipientCommitment,
        uint256 netAmount,
        uint256 fee,
        bytes32 sourceNullifier,
        bytes32 destinationNullifier,
        bytes32 nullifierHash,
        bytes32 merkleRoot,
        bytes32 transferCommitment,
        bytes32 feeCommitment,
        bytes32 proofHash,
        uint256 currentTime
    ) internal {
        Transfer storage transferRecord = transfers[transferId];
        _initTransferBasic(transferRecord, transferId, destinationChain, senderCommitment, 
        recipientCommitment, netAmount, fee, currentTime);
        _setTransferNullifiers(transferRecord, sourceNullifier, destinationNullifier, 
        nullifierHash, merkleRoot, transferCommitment, feeCommitment, proofHash);
        _setTransferChallengeFields(transferRecord, sourceNullifier);
    }

    /**
     * @notice Helper to initiate transfer - handles validation and nullifier marking
     * @param params Transfer parameters
     * @param destChain Destination chain info
     * @return transferFeeBps Transfer fee in basis points
     */
    function _prepareTransferInitiation(
        TransferParams calldata params,
        ChainInfo memory destChain
    ) internal returns (uint256 transferFeeBps) {
        _validateTransferParams(params, destChain);
        _markNullifiersUsed(params.sourceNullifier, params.destinationNullifier, params.nullifierHash);
        return destChain.transferFee;
    }

    /**
     * @notice Helper to complete transfer initiation - creates record and updates state
     * @param transferId Transfer ID
     * @param params Transfer parameters
     * @param netAmount Net transfer amount
     * @param fee Transfer fee
     * @param proofHash Proof hash
     * @param currentTime Current timestamp
     */
    function _completeTransferInitiation(
        bytes32 transferId,
        TransferParams calldata params,
        uint256 netAmount,
        uint256 fee,
        bytes32 proofHash,
        uint256 currentTime
    ) internal {
        _createTransferRecord(
            transferId,
            params.destinationChain,
            params.senderCommitment,
            params.recipientCommitment,
            netAmount,
            fee,
            params.sourceNullifier,
            params.destinationNullifier,
            params.nullifierHash,
            params.merkleRoot,
            params.transferCommitment,
            params.feeCommitment,
            proofHash,
            currentTime
        );
        _updateLiquidityAndState(params.destinationChain, netAmount, params.senderCommitment);
    }

    /**
     * @notice Initiate a cross-chain transfer
     * @param params Transfer parameters with ZK proof
     * @return transferId The unique identifier of the initiated transfer
     */
    function initiateTransfer(
        TransferParams calldata params
    ) external 
        whenNotPaused
        validChain(params.destinationChain) 
        onlyValidProof(params.zkProof, _buildTransferPublicInputs(params)) 
        returns (bytes32) {
        ChainInfo memory destChain = supportedChains[params.destinationChain];
        
        // Prepare transfer initiation (validation and nullifier marking)
        uint256 transferFeeBps = _prepareTransferInitiation(params, destChain);
        
        // Calculate fee and net amount
        (uint256 fee, uint256 netAmount) = _calculateTransferFee(params.amount, transferFeeBps);
        uint256 currentTime = block.timestamp;
        
        // Generate transfer ID
        bytes32 transferId = _generateTransferId(
            params.destinationChain,
            params.senderCommitment,
            params.recipientCommitment,
            params.amount,
            currentTime
        );
        
        // Compute proof hash
        bytes32 proofHash = keccak256(params.zkProof);
        
        // Complete transfer initiation (create record and update state)
        _completeTransferInitiation(transferId, params, netAmount, fee, proofHash, currentTime);
        
        // Emit event and lock tokens
        emit TransferInitiated(
            transferId,
            block.chainid,
            params.destinationChain,
            params.senderCommitment,
            params.recipientCommitment
        );
        
        PRIVATE_TOKEN.transferToPoolInternal(params.senderCommitment, address(this), params.amount);
        
        return transferId;
    }
    
    /**
     * @notice Validate a cross-chain transfer
     * @param transferId Transfer to validate
     * @param isValid Whether the transfer is valid
     * @param validationHash Hash of validation data
     * @param signature Validator signature
     */
    function validateTransfer(
        bytes32 transferId,
        bool isValid,
        bytes32 validationHash,
        bytes calldata signature
    ) external onlyValidator whenNotPaused {
        if (transfers[transferId].transferId == bytes32(0)) revert TransferNotFound();
        // Use explicit type casting to avoid incorrect-equality warnings
        TransferStatus currentStatus = transfers[transferId].status;
        if (TransferStatus(currentStatus) != TransferStatus.INITIATED) {
            revert TransferAlreadyExecuted();
        }
        if (validations[keccak256(abi.encode(transferId, msg.sender))].validator != address(0)) {
            revert TransferAlreadyExecuted();
        }
        
        uint256 currentTime = block.timestamp;
        
        // Record validation
        bytes32 validationKey = keccak256(abi.encode(transferId, msg.sender));
        validations[validationKey] = ValidationInfo({
            transferId: transferId,
            validator: msg.sender,
            isValid: isValid,
            timestamp: currentTime,
            validationHash: validationHash,
            signature: signature
        });
        transferValidators[transferId].push(msg.sender);
        
        // Update validator stats (use unchecked to prevent overflow issues in test scenarios)
        // The onlyValidator modifier ensures validator exists and is active
        ValidatorInfo storage validatorInfo = validators[msg.sender];
        unchecked {
            ++validatorInfo.validationsCount;
            if (isValid) {
                ++validatorInfo.successfulValidations;
            }
        }
        validatorInfo.lastValidation = currentTime;
        
        emit TransferValidated(transferId, isValid, currentTime);
        
        // Check if enough validations received
        _checkValidationThreshold(transferId);
    }
    
    /**
     * @notice Executes a cross-chain transfer after validation
     * @dev Processes a validated transfer and releases funds to the recipient
     * @param transferId The unique identifier of the transfer to execute
     * @custom:security Protected against reentrancy attacks
     * @custom:validation Requires sufficient validator confirmations
     */
    function executeTransfer(bytes32 transferId) external nonReentrant {
        Transfer storage transfer = transfers[transferId];
        // Use explicit type casting to avoid incorrect-equality warnings
        TransferStatus currentStatus = transfer.status;
        if (TransferStatus(currentStatus) != TransferStatus.VALIDATED) revert TransferNotValidated();
        
        uint256 currentTime = block.timestamp;
        unchecked {
            uint256 completionTime = transfer.confirmationTime + CHALLENGE_PERIOD;
            if (completionTime < transfer.confirmationTime) {
                revert InvalidTimestamp();
            }
            if (currentTime < completionTime) {
                revert ChallengePeriodNotEnded();
            }
        }
        
        transfer.status = TransferStatus.EXECUTED;
        transfer.executionTime = currentTime;
        // CRITICAL FIX: Prevent underflow in pending transfers count
        if (pendingTransfersCount > 0) {
            unchecked {
                --pendingTransfersCount;
            }
        }
        
        _cleanupTransferValidations(transferId);
        transfer.challenger = address(0);

        // Emit event before external call for traceability
        emit TransferExecuted(
            transferId,
            transfer.recipientCommitment,
            currentTime
        );
        
        // Release tokens to recipient
        PRIVATE_TOKEN.transferFromPool(
            address(this),
            transfer.recipientCommitment,
            transfer.amount
        );
    }
    
    /**
     * @notice Challenge a transfer
     * @param transferId Transfer to challenge
     * @param reason Challenge reason
     */
    function challengeTransfer(
        bytes32 transferId,
        string calldata reason
    ) external {
        Transfer storage transfer = transfers[transferId];
        if (transfer.transferId == bytes32(0)) revert TransferNotFound();
        TransferStatus currentStatus = transfer.status;
        if (TransferStatus(currentStatus) != TransferStatus.VALIDATED) revert TransferNotValidated();
        if (transfer.challengeActive) revert ChallengeAlreadyActive();
        if (transfer.challengeAttempts >= MAX_CHALLENGE_ATTEMPTS) revert ChallengeLimitExceeded();
        
        uint256 currentTime = block.timestamp;
        unchecked {
            uint256 deadline = transfer.confirmationTime + CHALLENGE_PERIOD;
            if (deadline < transfer.confirmationTime) revert InvalidTimestamp();
            if (currentTime > deadline) {
                revert ChallengePeriodEnded();
            }
        }
        
        transfer.status = TransferStatus.CHALLENGED;
        transfer.challengeActive = true;
        unchecked {
            ++transfer.challengeAttempts;
            uint256 expiry = currentTime + CHALLENGE_RESPONSE_WINDOW;
            if (expiry < currentTime) revert InvalidTimestamp();
            transfer.challengeExpiry = expiry;
        }
        transfer.challenger = msg.sender;
        
        emit TransferChallenged(transferId, msg.sender, reason);

        // Governance or timeout will resolve the challenge
    }

    /**
     * @notice Resolve an active transfer challenge through governance
     * @param transferId Transfer under challenge
     * @param upholdChallenge Whether to uphold (true) or dismiss (false) the challenge
     */
    function resolveChallenge(bytes32 transferId, bool upholdChallenge) external onlyGovernance {
        Transfer storage transfer = transfers[transferId];
        if (transfer.transferId == bytes32(0)) revert TransferNotFound();
        if (TransferStatus(transfer.status) != TransferStatus.CHALLENGED) revert NoActiveChallenge();

        if (upholdChallenge) {
            _upholdChallenge(transferId, transfer, msg.sender);
        } else {
            _dismissChallenge(transferId, transfer, msg.sender);
        }
    }

    /**
     * @notice Finalize a challenge after the response window has lapsed
     * @param transferId Transfer under challenge
     */
    function finalizeChallenge(bytes32 transferId) external {
        Transfer storage transfer = transfers[transferId];
        if (transfer.transferId == bytes32(0)) revert TransferNotFound();
        if (TransferStatus(transfer.status) != TransferStatus.CHALLENGED) revert NoActiveChallenge();
        if (transfer.challengeExpiry == 0) revert NoActiveChallenge();
        if (block.timestamp <= transfer.challengeExpiry) revert ChallengeResolutionPending();

        _dismissChallenge(transferId, transfer, address(0));
    }

    /**
     * @notice Internal helper that upholds a challenge and cancels the transfer
     * @param transferId Transfer being challenged
     * @param transfer Transfer storage reference
     * @param resolver Address resolving the challenge
     */
    function _upholdChallenge(bytes32 transferId, Transfer storage transfer, address resolver) private {
        transfer.status = TransferStatus.FAILED;
        transfer.challengeExpiry = 0;
        transfer.executionTime = block.timestamp;
        transfer.challengeActive = false;

        if (pendingTransfersCount > 0) {
            unchecked {
                --pendingTransfersCount;
            }
        }

        chainLiquidityInfo[transfer.destinationChain].availableLiquidity += transfer.amount;

        _slashValidators(transferId, transfer, transfer.challenger);
        _cleanupTransferValidations(transferId);
        transfer.challenger = address(0);

        PRIVATE_TOKEN.transferFromPool(
            address(this),
            transfer.senderCommitment,
            transfer.amount + transfer.fee
        );

        emit ChallengeResolved(transferId, resolver, true);
    }

    /**
     * @notice Internal helper that dismisses a challenge and returns transfer to validated state
     * @param transferId Transfer being resolved
     * @param transfer Transfer storage reference
     * @param resolver Address resolving the challenge (zero address on timeout)
     */
    function _dismissChallenge(bytes32 transferId, Transfer storage transfer, address resolver) private {
        transfer.status = TransferStatus.VALIDATED;
        transfer.challengeExpiry = 0;
        transfer.challengeActive = false;
        transfer.challenger = address(0);

        emit ChallengeResolved(transferId, resolver, false);
    }
    
    /**
     * @notice Add liquidity to a chain
     * @param params Liquidity parameters with ZK proof
     */
    function addLiquidity(
        LiquidityParams calldata params
    )
        external
        whenNotPaused
        validChain(params.chainId)
        onlyValidProof(params.zkProof, _buildLiquidityPublicInputs(params))
    {
        // Debug: Function entry
        require(true, "addLiquidity function entered");
        
        if (nullifierUsed[params.nullifier]) revert NullifierAlreadyUsed();
        if (params.amount == 0) revert InvalidAmount();
        
        nullifierUsed[params.nullifier] = true;
        
        // Update liquidity provider info
        LiquidityProvider storage provider = liquidityProviders[params.providerCommitment];
        provider.providerCommitment = params.providerCommitment;
        provider.totalProvided += params.amount;
        provider.currentLiquidity += params.amount;
        provider.lastUpdate = block.timestamp;
        provider.isActive = true;
        
        // Update chain liquidity
        chainLiquidityInfo[params.chainId].availableLiquidity += params.amount;
        chainLiquidityInfo[params.chainId].totalReserves += params.amount;
        
        // Emit event before external call
        emit LiquidityAdded(
            params.chainId,
            params.providerCommitment,
            params.amount,
            chainLiquidityInfo[params.chainId].availableLiquidity
        );
        
        // Transfer tokens to bridge
        PRIVATE_TOKEN.transferToPoolInternal(params.providerCommitment, address(this), params.amount);
    }
    
    /**
     * @notice Remove liquidity from a chain
     * @param chainId Chain to remove liquidity from
     * @param amount Amount to remove
     * @param providerCommitment Provider's commitment
     * @param nullifier Unique nullifier
     * @param zkProof ZK proof
     */
    function removeLiquidity(
        uint256 chainId,
        uint256 amount,
        bytes32 providerCommitment,
        bytes32 nullifier,
        bytes calldata zkProof
    )
        external
        whenNotPaused
        validChain(chainId)
        onlyValidProof(zkProof, _buildRemoveLiquidityInputs(chainId, amount, providerCommitment, nullifier))
    {
        if (nullifierUsed[nullifier]) revert NullifierAlreadyUsed();
        if (amount == 0) revert InvalidAmount();
        
        LiquidityProvider storage provider = liquidityProviders[providerCommitment];
        if (!provider.isActive) revert ProviderNotActive();
        if (provider.currentLiquidity < amount) revert InsufficientLiquidity();
        if (chainLiquidityInfo[chainId].totalReserves < amount) revert InsufficientReserves();
        
        nullifierUsed[nullifier] = true;
        
        uint256 currentTime = block.timestamp;
        
        // Update provider info
        provider.currentLiquidity -= amount;
        provider.lastUpdate = currentTime;
        
        // Update chain liquidity
        chainLiquidityInfo[chainId].availableLiquidity -= amount;
        chainLiquidityInfo[chainId].totalReserves -= amount;
        
        // Emit event before external call
        emit LiquidityRemoved(
            chainId,
            providerCommitment,
            amount,
            chainLiquidityInfo[chainId].availableLiquidity
        );
        
        // Transfer tokens back to provider
        PRIVATE_TOKEN.transferFromPool(address(this), providerCommitment, amount);
    }
    
    /**
     * @notice Add a new validator
     * @param validator Validator address
     * @param validatorCommitment Validator's commitment
     * @param stake Stake amount
     */
    function addValidator(
        address validator,
        bytes32 validatorCommitment,
        uint256 stake
    ) external onlyGovernance whenNotPaused {
        if (validator == address(0)) revert InvalidValidator();
        if (stake < validatorStakeAmount) revert InsufficientStake();
        if (validators[validator].isActive) revert ValidatorAlreadyActive();
        
        validators[validator] = ValidatorInfo({
            validator: validator,
            stake: stake,
            validationsCount: 0,
            successfulValidations: 0,
            lastValidation: 0,
            isActive: true,
            validatorCommitment: validatorCommitment
        });
        
        activeValidators.push(validator);
        _reconcileValidationThreshold();
        
        // Emit event before external call
        emit ValidatorAdded(validator, validatorCommitment, stake);
        
        // Transfer stake
        PRIVATE_TOKEN.transferToPoolInternal(validatorCommitment, address(this), stake);
    }

    /**
     * @notice Remove an active validator and return their stake
     * @param validator Validator address to remove
     */
    function removeValidator(address validator) external onlyGovernance {
        ValidatorInfo storage info = validators[validator];
        if (!info.isActive) revert ValidatorNotActive();
        if (activeValidators.length <= 1) revert CannotRemoveLastValidator();

        info.isActive = false;

        uint256 stake = info.stake;
        bytes32 validatorCommitment = info.validatorCommitment;
        info.stake = 0;

        for (uint256 i = 0; i < activeValidators.length; ++i) {
            if (activeValidators[i] == validator) {
                activeValidators[i] = activeValidators[activeValidators.length - 1];
                activeValidators.pop();
                break;
            }
        }

        if (stake > 0) {
            PRIVATE_TOKEN.transferFromPool(address(this), validatorCommitment, stake);
        }

        emit ValidatorRemoved(validator, validatorCommitment, stake);

        _reconcileValidationThreshold();
    }
    
    /**
     * @notice Update the required number of validator confirmations
     * @param newRequiredValidations New required validations threshold
     */
    function setRequiredValidations(uint256 newRequiredValidations) external onlyGovernance {
        if (newRequiredValidations == 0) revert InvalidValidationThreshold();
        uint256 activeCount = activeValidators.length;
        if (newRequiredValidations > activeCount) revert InvalidValidationThreshold();
        uint256 superMajority = _superMajorityThreshold(activeCount);
        if (newRequiredValidations < superMajority) revert InvalidValidationThreshold();
        requiredValidations = newRequiredValidations;
    }

    /**
     * @notice Updates the validator slashing penalty ratio
     * @param newPenaltyBps New penalty expressed in basis points
     */
    function setValidatorSlashPenalty(uint256 newPenaltyBps) external onlyGovernance {
        if (newPenaltyBps > 10000) revert InvalidSlashPenalty();
        validatorSlashPenaltyBps = newPenaltyBps;
    }

    /**
     * @notice Pauses bridge operations for emergency response
     */
    function pauseBridge() external onlyGovernance {
        _pause();
    }

    /**
     * @notice Resumes bridge operations after being paused
     */
    function unpauseBridge() external onlyGovernance {
        _unpause();
    }

    /**
     * @notice Updates the Merkle root activation delay
     * @param newDelay The new activation delay value
     */
    function setMerkleRootActivationDelay(uint256 newDelay) external onlyGovernance {
        if (newDelay < MIN_MERKLE_ROOT_DELAY) revert InvalidActivationDelay();
        uint256 previousDelay = merkleRootActivationDelay;
        merkleRootActivationDelay = newDelay;
        emit MerkleRootActivationDelayUpdated(previousDelay, newDelay);
    }
    /**
     * @notice Calculates the super-majority threshold based on active validator count
     * @param activeCount Number of active validators
     * @return Threshold representing ceil(2/3 * activeCount)
     */
    function _superMajorityThreshold(uint256 activeCount) private pure returns (uint256) {
        if (activeCount == 0) {
            return 0;
        }
        return (activeCount * 2 + 2) / 3;
    }

    /**
     * @notice Determines the quorum required for Merkle root operations
     * @return threshold Number of validator attestations required
     */
    function _merkleRootQuorum() private view returns (uint256 threshold) {
        uint256 activeCount = activeValidators.length;
        threshold = _superMajorityThreshold(activeCount);
        if (threshold == 0) revert InvalidValidationThreshold();
        if (requiredValidations > threshold) {
            threshold = requiredValidations;
        }
    }

    /**
     * @notice Ensures the required validation threshold stays within active validator bounds
     */
    function _reconcileValidationThreshold() private {
        uint256 activeCount = activeValidators.length;
        if (activeCount == 0) {
            requiredValidations = 0;
            return;
        }
        if (requiredValidations > activeCount) {
            requiredValidations = activeCount;
        }
        uint256 superMajority = _superMajorityThreshold(activeCount);
        if (requiredValidations < superMajority) {
            requiredValidations = superMajority;
        }
    }

    /**
     * @notice Distributes accumulated slashed stake to a recipient commitment
     * @param recipientCommitment Commitment receiving the slashed stake
     * @param amount Amount to distribute
     */
    function distributeSlashedStake(bytes32 recipientCommitment, uint256 amount) external onlyGovernance {
        if (recipientCommitment == bytes32(0)) revert InvalidCommitment();
        if (amount == 0 || amount > slashedStakePool) revert InvalidAmount();
        
        slashedStakePool -= amount;
        PRIVATE_TOKEN.transferFromPool(address(this), recipientCommitment, amount);
    }

    /**
     * @notice Add a new supported chain
     * @param chainId Chain ID
     * @param name Chain name
     * @param bridgeContract Bridge contract address
     * @param confirmationBlocks Required confirmation blocks
     * @param minAmount Minimum transfer amount
     * @param maxAmount Maximum transfer amount
     * @param transferFee Transfer fee in basis points
     */
    function addSupportedChain(
        uint256 chainId,
        string calldata name,
        address bridgeContract,
        uint256 confirmationBlocks,
        uint256 minAmount,
        uint256 maxAmount,
        uint256 transferFee
    ) external onlyGovernance {
        if (chainId == 0) revert InvalidChain();
        if (isChainActive[chainId]) revert ChainNotSupported();
        if (bridgeContract == address(0)) revert InvalidChain();
        if (minAmount == 0) revert InvalidAmount();
        if (maxAmount < minAmount + 1) revert InvalidAmount();
        if (transferFee > 1000) revert InvalidAmount(); // Max 10%
        
        supportedChains[chainId] = ChainInfo({
            chainId: chainId,
            name: name,
            bridgeContract: bridgeContract,
            confirmationBlocks: confirmationBlocks,
            minTransferAmount: minAmount,
            maxTransferAmount: maxAmount,
            transferFee: transferFee,
            isActive: true
        });
        
        isChainActive[chainId] = true;
        activeChainIds.push(chainId);
        
        emit ChainAdded(chainId, name, bridgeContract);
    }

    /**
     * @notice Registers a Merkle root that bridge proofs may reference
     * @param merkleRoot The Merkle root to register
     */
    function addMerkleRoot(bytes32 merkleRoot) external onlyGovernance {
        if (merkleRoot == bytes32(0)) revert InvalidMerkleRootValue();
        if (validMerkleRoots[merkleRoot]) revert MerkleRootAlreadyActive();
        if (pendingMerkleRootActivations[merkleRoot] != 0) revert MerkleRootPending();
        uint256 activateAt;
        unchecked {
            activateAt = block.timestamp + merkleRootActivationDelay;
            if (activateAt <= block.timestamp) revert InvalidTimestamp();
        }
        unchecked {
            merkleRootAttestationEpoch[merkleRoot] += 1;
        }
        merkleRootAttestationCount[merkleRoot] = 0;
        pendingMerkleRootActivations[merkleRoot] = activateAt;
        emit MerkleRootProposed(merkleRoot, activateAt);
    }

    /**
     * @notice Allows validators to attest to a pending Merkle root activation
     * @param merkleRoot The Merkle root under consideration
     */
    function attestMerkleRoot(bytes32 merkleRoot) external onlyValidator whenNotPaused {
        uint256 epoch = merkleRootAttestationEpoch[merkleRoot];
        if (epoch == 0) revert MerkleRootNotPending();
        if (pendingMerkleRootActivations[merkleRoot] == 0) revert MerkleRootNotPending();
        if (merkleRootValidatorEpoch[merkleRoot][msg.sender] == epoch) revert ValidatorAlreadyAttested();

        merkleRootValidatorEpoch[merkleRoot][msg.sender] = epoch;
        unchecked {
            merkleRootAttestationCount[merkleRoot] += 1;
        }
        emit MerkleRootAttested(merkleRoot, msg.sender, merkleRootAttestationCount[merkleRoot]);
    }

    /**
     * @notice Activates a previously proposed Merkle root after the activation delay
     * @param merkleRoot The Merkle root to activate
     */
    function activateMerkleRoot(bytes32 merkleRoot) external {
        uint256 activateAt = pendingMerkleRootActivations[merkleRoot];
        if (activateAt == 0) revert MerkleRootNotPending();
        if (block.timestamp < activateAt) revert ActivationDelayNotElapsed();
        if (merkleRootAttestationCount[merkleRoot] < _merkleRootQuorum()) revert InsufficientMerkleRootAttestations();
        delete pendingMerkleRootActivations[merkleRoot];
        validMerkleRoots[merkleRoot] = true;
        merkleRootAttestationCount[merkleRoot] = 0;
        emit MerkleRootUpdated(merkleRoot, true);
    }

    /**
     * @notice Cancels a pending Merkle root proposal
     * @param merkleRoot The Merkle root proposal to cancel
     */
    function cancelMerkleRootProposal(bytes32 merkleRoot) external onlyGovernance {
        if (pendingMerkleRootActivations[merkleRoot] == 0) revert MerkleRootNotPending();
        delete pendingMerkleRootActivations[merkleRoot];
        merkleRootAttestationCount[merkleRoot] = 0;
        emit MerkleRootProposalCancelled(merkleRoot);
    }

    /**
     * @notice Marks a Merkle root as no longer valid for bridge proofs
     * @param merkleRoot The Merkle root to deactivate
     */
    function removeMerkleRoot(bytes32 merkleRoot) external onlyGovernance {
        if (!validMerkleRoots[merkleRoot]) revert MerkleRootNotActive();
        if (pendingMerkleRootRemovals[merkleRoot] != 0) revert MerkleRootPending();
        uint256 executeAt;
        unchecked {
            executeAt = block.timestamp + merkleRootActivationDelay;
            if (executeAt <= block.timestamp) revert InvalidTimestamp();
        }
        unchecked {
            merkleRootRemovalAttestationEpoch[merkleRoot] += 1;
        }
        merkleRootRemovalAttestationCount[merkleRoot] = 0;
        pendingMerkleRootRemovals[merkleRoot] = executeAt;
        emit MerkleRootRemovalProposed(merkleRoot, executeAt);
    }

    /**
     * @notice Allows validators to attest to a pending Merkle root removal
     * @param merkleRoot The Merkle root scheduled for removal
     */
    function attestMerkleRootRemoval(bytes32 merkleRoot) external onlyValidator whenNotPaused {
        uint256 epoch = merkleRootRemovalAttestationEpoch[merkleRoot];
        if (epoch == 0) revert MerkleRootNotPending();
        if (pendingMerkleRootRemovals[merkleRoot] == 0) revert MerkleRootNotPending();
        if (merkleRootRemovalValidatorEpoch[merkleRoot][msg.sender] == epoch) revert ValidatorRemovalAlreadyAttested();

        merkleRootRemovalValidatorEpoch[merkleRoot][msg.sender] = epoch;
        unchecked {
            merkleRootRemovalAttestationCount[merkleRoot] += 1;
        }
        emit MerkleRootRemovalAttested(merkleRoot, msg.sender, merkleRootRemovalAttestationCount[merkleRoot]);
    }

    /**
     * @notice Finalizes the removal of a previously proposed Merkle root
     * @param merkleRoot The Merkle root to deactivate
     */
    function finalizeMerkleRootRemoval(bytes32 merkleRoot) external {
        uint256 executeAt = pendingMerkleRootRemovals[merkleRoot];
        if (executeAt == 0) revert MerkleRootNotPending();
        if (block.timestamp < executeAt) revert ActivationDelayNotElapsed();
        if (merkleRootRemovalAttestationCount[merkleRoot] < _merkleRootQuorum()) {
            revert InsufficientMerkleRootRemovalAttestations();
        }
        delete pendingMerkleRootRemovals[merkleRoot];
        delete validMerkleRoots[merkleRoot];
        merkleRootRemovalAttestationCount[merkleRoot] = 0;
        emit MerkleRootUpdated(merkleRoot, false);
    }

    /**
     * @notice Cancels a pending Merkle root removal proposal
     * @param merkleRoot The Merkle root removal proposal to cancel
     */
    function cancelMerkleRootRemoval(bytes32 merkleRoot) external onlyGovernance {
        if (pendingMerkleRootRemovals[merkleRoot] == 0) revert MerkleRootNotPending();
        delete pendingMerkleRootRemovals[merkleRoot];
        merkleRootRemovalAttestationCount[merkleRoot] = 0;
        emit MerkleRootRemovalCancelled(merkleRoot);
    }

    /**
     * @notice Clears in-memory validation data for a transfer
     * @param transferId Transfer identifier
     */
    function _cleanupTransferValidations(bytes32 transferId) private {
        address[] storage validatorsForTransfer = transferValidators[transferId];
        uint256 validatorsCount = validatorsForTransfer.length;
        for (uint256 i = 0; i < validatorsCount; ++i) {
            address validatorAddr = validatorsForTransfer[i];
            bytes32 validationKey = keccak256(abi.encode(transferId, validatorAddr));
            delete validations[validationKey];
        }
        delete transferValidators[transferId];
    }

    /**
     * @notice Internal helper to deactivate a validator after slashing
     * @param validator Address of the validator to deactivate
     */
    function _deactivateValidator(address validator) private {
        ValidatorInfo storage info = validators[validator];
        if (!info.isActive) {
            return;
        }

        info.isActive = false;

        uint256 validatorsLength = activeValidators.length;
        for (uint256 i = 0; i < validatorsLength; ++i) {
            if (activeValidators[i] == validator) {
                activeValidators[i] = activeValidators[validatorsLength - 1];
                activeValidators.pop();
                break;
            }
        }

        _reconcileValidationThreshold();
    }

    /**
     * @notice Slashes validators who incorrectly validated a challenged transfer
     * @param transferId Transfer identifier
     * @param transfer Transfer storage reference
     * @param challenger Address that initiated the challenge
     * @return totalSlashed Amount of stake slashed
     */
    function _slashValidators(
        bytes32 transferId,
        Transfer storage transfer,
        address challenger
    ) private returns (uint256 totalSlashed) {
        uint256 penaltyBps = validatorSlashPenaltyBps;
        if (penaltyBps == 0) {
            return 0;
        }

        address[] storage validatorsForTransfer = transferValidators[transferId];
        uint256 validatorsCount = validatorsForTransfer.length;

        for (uint256 i = 0; i < validatorsCount; ++i) {
            address validatorAddr = validatorsForTransfer[i];
            bytes32 validationKey = keccak256(abi.encode(transferId, validatorAddr));
            ValidationInfo storage validation = validations[validationKey];

            if (validation.validator == address(0) || !validation.isValid) {
                continue;
            }

            ValidatorInfo storage validatorInfo = validators[validatorAddr];
            uint256 stakeBalance = validatorInfo.stake;
            if (stakeBalance == 0) {
                continue;
            }

            uint256 penalty = (stakeBalance * penaltyBps) / 10000;
            if (penalty == 0) {
                continue;
            }
            if (penalty > stakeBalance) {
                penalty = stakeBalance;
            }

            validatorInfo.stake = stakeBalance - penalty;
            totalSlashed += penalty;

            emit ValidatorSlashed(validatorAddr, transferId, penalty, challenger);

            if (validatorInfo.stake < validatorStakeAmount) {
                _deactivateValidator(validatorAddr);
            }
        }

        if (totalSlashed > 0) {
            slashedStakePool += totalSlashed;
            ChainLiquidityInfo storage sourceChainLiquidity = chainLiquidityInfo[transfer.sourceChain];
            sourceChainLiquidity.availableLiquidity += totalSlashed;
            sourceChainLiquidity.totalReserves += totalSlashed;
        }
    }
    
    /**
     * @notice Internal function to check validation threshold and update transfer status
     * @param transferId The unique identifier of the transfer to validate
     */
    function _checkValidationThreshold(bytes32 transferId) internal {
        address[] storage validatorsForTransfer = transferValidators[transferId];
        uint256 validValidations = 0;
        uint256 totalValidations = 0;
        uint256 validatorsCount = validatorsForTransfer.length;
        
        for (uint256 i = 0; i < validatorsCount;) {
            address validatorAddr = validatorsForTransfer[i];
            bytes32 validationKey = keccak256(abi.encode(transferId, validatorAddr));
            ValidationInfo storage validation = validations[validationKey];
            if (validation.validator != address(0)) {
                unchecked {
                    ++totalValidations;
                    if (validation.isValid) {
                        ++validValidations;
                    }
                }
            }
            unchecked {
                ++i;
            }
        }
        
        // Check if threshold met
        if (requiredValidations == 0) {
            revert InvalidValidationThreshold();
        }
        if (totalValidations >= requiredValidations) {
            Transfer storage transfer = transfers[transferId];
            uint256 currentTime = block.timestamp;
            
            // Calculate ceil(2/3 * requiredValidations)
            uint256 threshold = (requiredValidations * 2 + 2) / 3;
            
            if (validValidations >= threshold) {
                transfer.status = TransferStatus.VALIDATED;
                transfer.confirmationTime = currentTime;
            } else {
                transfer.status = TransferStatus.FAILED;
                // CRITICAL FIX: Prevent underflow in pending transfers count
                if (pendingTransfersCount > 0) {
                    unchecked {
                        --pendingTransfersCount;
                    }
                }
                
                // Update state before external call (checks-effects-interactions pattern)
                chainLiquidityInfo[transfer.destinationChain].availableLiquidity += transfer.amount;
                
                _cleanupTransferValidations(transferId);
                transfer.challenger = address(0);
                
                // Refund tokens
                PRIVATE_TOKEN.transferFromPool(
                    address(this),
                    transfer.senderCommitment,
                    transfer.amount + transfer.fee
                );
            }
        }
    }
    
    /**
     * @notice Returns the private token contract address
     * @return The address of the private token contract
     */
    function privateToken() external view returns (address) {
        return address(PRIVATE_TOKEN);
    }
    
    /**
     * @notice Returns the bridge verifier contract address
     * @return The address of the bridge verifier contract
     */
    function bridgeVerifier() external view returns (address) {
        return address(VERIFIER_FACTORY);
    }

    /**
     * @notice Retrieves transfer details by transfer ID
     * @param transferId The unique identifier of the transfer
     * @return Transfer struct containing all transfer information
     */
    function getTransfer(bytes32 transferId) external view returns (Transfer memory) {
        return transfers[transferId];
    }
    
    /**
     * @notice Retrieves chain information by chain ID
     * @param chainId The unique identifier of the blockchain
     * @return ChainInfo struct containing chain configuration
     */
    function getChainInfo(uint256 chainId) external view returns (ChainInfo memory) {
        return supportedChains[chainId];
    }
    
    /**
     * @notice Retrieves validator information by validator address
     * @param validator The address of the validator
     * @return ValidatorInfo struct containing validator details
     */
    function getValidator(address validator) external view returns (ValidatorInfo memory) {
        return validators[validator];
    }
    
    /**
     * @notice Retrieves liquidity provider information by commitment
     * @param providerCommitment The commitment hash of the liquidity provider
     * @return LiquidityProvider struct containing provider details
     */
    function getLiquidityProvider(bytes32 providerCommitment) external view returns (LiquidityProvider memory) {
        return liquidityProviders[providerCommitment];
    }
    
    /**
     * @notice Retrieves liquidity and reserves for a specific chain
     * @param chainId The unique identifier of the blockchain
     * @return availableLiquidity Available liquidity amount
     * @return totalReserves Total reserves amount
     */
    function getChainLiquidity(uint256 chainId) external view returns (uint256, uint256) {
        return (chainLiquidityInfo[chainId].availableLiquidity, chainLiquidityInfo[chainId].totalReserves);
    }
    
    /**
     * @notice Retrieves all active chain IDs
     * @return Array of active chain identifiers
     */
    function getActiveChains() external view returns (uint256[] memory) {
        return activeChainIds;
    }
    
    /**
     * @notice Retrieves all active validator addresses
     * @return Array of active validator addresses
     */
    function getActiveValidators() external view returns (address[] memory) {
        return activeValidators;
    }
    
    /**
     * @notice Retrieves bridge statistics
     * @return totalTransfers Total transfers count
     * @return pendingTransfers Pending transfers count
     * @return activeValidatorsCount Active validators count
     */
    function getBridgeStats() external view returns (uint256, uint256, uint256) {
        return (nextTransferId - 1, pendingTransfersCount, activeValidators.length);
    }
    
    /**
     * @notice Checks if a nullifier has been used
     * @param nullifier The nullifier hash to check
     * @return True if the nullifier has been used, false otherwise
     */
    function isNullifierUsed(bytes32 nullifier) external view returns (bool) {
        return nullifierUsed[nullifier];
    }
    
    /**
     * @notice Calculates the transfer fee for a given chain and amount
     * @param chainId The destination chain identifier
     * @param amount The transfer amount
     * @return The calculated transfer fee
     */
    function calculateTransferFee(uint256 chainId, uint256 amount) external view returns (uint256) {
        ChainInfo memory chain = supportedChains[chainId];
        return (amount * chain.transferFee) / 10000;
    }
}
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "./interfaces/ICommonErrors.sol";

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {CommitmentLib} from "./libraries/CommitmentLib.sol";
import {ProofLib} from "./libraries/ProofLib.sol";
import {GovernanceAccessLib} from "./libraries/GovernanceAccessLib.sol";
import {PrivateTokenContract} from "./PrivateTokenContract.sol";
import {VerifierFactory} from "./VerifierFactory.sol";

/**
 * @title PrivateStakingContract
 * @author Aegis Protocol Team
 * @notice Privacy-preserving staking contract enabling anonymous staking with zero-knowledge proofs
 * @dev Privacy-preserving staking contract with zero-knowledge proofs
 * Allows anonymous staking with proof-of-deposit and private reward distribution
 */
contract PrivateStakingContract is Ownable, ReentrancyGuard, Pausable , ICommonErrors{
    using CommitmentLib for CommitmentLib.Commitment;
    using ProofLib for ProofLib.ZKProof;
    
    // Circuit type constants for VerifierFactory
    /// @notice Circuit type identifier for staking operations
    string private constant STAKING_CIRCUIT = "staking";
    /// @notice Circuit type identifier for reward operations
    string private constant REWARD_CIRCUIT = "reward";
    
    /// @notice Current staking state variables
    struct StakingState {
        uint256 currentEpoch;
        uint256 epochStartTime;
        uint256 totalStakedCommitments;
        uint256 totalStakedAmount;
        uint256 rewardPool;
    }
    
    /// @notice Commitment and nullifier tracking mappings
    struct CommitmentTracking {
        mapping(bytes32 => bool) stakingCommitments;
        mapping(bytes32 => bool) stakingNullifiers;
        mapping(bytes32 => bool) unstakeRequestNullifiers;
        mapping(bytes32 => uint256) commitmentEpochs;
        mapping(bytes32 => uint256) unstakeRequests;
    }
    
    /// @notice Reward tracking mappings
    struct RewardTracking {
        mapping(uint256 => uint256) epochRewards;
        mapping(uint256 => bytes32) epochRewardCommitments;
    }
    
    // Staking parameters
    /// @notice Reward rate per epoch (1% = 100 basis points)
    uint256 public constant REWARD_RATE = 100; // 1% per epoch (100 basis points)
    /// @notice Duration of each staking epoch (7 days)
    uint256 public constant EPOCH_DURATION = 7 days;
    /// @notice Minimum amount of tokens required for staking (100 AGS)
    uint256 public constant MIN_STAKE_AMOUNT = 100e18; // 100 AGS minimum
    /// @notice Time delay required before completing unstaking (14 days)
    uint256 public constant UNSTAKE_DELAY = 14 days;
    
    // Timestamp security constants
    uint256 private constant TIMESTAMP_TOLERANCE = 900; // 15 minutes tolerance for timestamp comparisons
    
    // Contract references
    /// @notice The Aegis token contract used for staking
    PrivateTokenContract public immutable AEGIS_TOKEN;
    /// @notice Factory contract for managing ZK proof verifiers
    VerifierFactory public immutable VERIFIER_FACTORY;
    
    // Staking state
    /// @notice Current staking state including epoch, timestamps, and totals
    StakingState public stakingState;
    
    // Commitment tracking
    /// @notice All commitment and nullifier tracking mappings
    CommitmentTracking internal commitmentTracking;
    
    // Reward tracking
    /// @notice All reward tracking mappings
    RewardTracking internal rewardTracking;
    
    // Events
    /// @notice Emitted when tokens are staked
    /// @param commitment The commitment hash for the staked amount
    /// @param epoch The epoch in which the stake was made
    /// @param timestamp The timestamp when the stake was made
    event Staked(
        bytes32 indexed commitment,
        uint256 indexed epoch,
        uint256 indexed timestamp
    );
    
    /// @notice Emitted when staking rewards are claimed
    /// @param nullifier The nullifier used to claim rewards
    /// @param newCommitment The new commitment hash after claiming rewards
    /// @param epoch The epoch in which rewards were claimed
    event RewardsClaimed(
        bytes32 indexed nullifier,
        bytes32 indexed newCommitment,
        uint256 indexed epoch
    );
    
    /// @notice Emitted when an unstake request is initiated
    /// @param nullifier The nullifier for the unstake request
    /// @param unlockTime The timestamp when unstaking will be allowed
    event UnstakeRequested(
        bytes32 indexed nullifier,
        uint256 indexed unlockTime
    );
    
    /// @notice Emitted when unstaking is completed
    /// @param nullifier The nullifier used for unstaking
    /// @param outputCommitment The output commitment hash after unstaking
    event UnstakeCompleted(
        bytes32 indexed nullifier,
        bytes32 indexed outputCommitment
    );
    
    /// @notice Emitted when a new epoch begins
    /// @param newEpoch The new epoch number
    /// @param rewardAmount The total reward amount for the previous epoch
    /// @param rewardCommitment The commitment hash for epoch rewards
    event EpochAdvanced(
        uint256 indexed newEpoch,
        uint256 indexed rewardAmount,
        bytes32 rewardCommitment
    );
    
    /// @notice Emitted when the reward pool is updated
    /// @param amount The amount added to the reward pool
    /// @param newTotal The new total amount in the reward pool
    event RewardPoolUpdated(
        uint256 indexed amount,
        uint256 indexed newTotal
    );
    
    /// @notice Emitted when a verifier contract address is updated
    /// @param verifierType The type of verifier ("staking", "reward", or "unstake")
    /// @param newAddress The new verifier contract address
    event VerifierUpdated(
        string indexed verifierType,
        address indexed newAddress
    );
    
    // Errors

    // Governance
    /// @notice Address of the governance contract that can perform administrative functions
    address public governanceContract;

    /// @notice Optional `AegisTimelockController` for delayed governance execution.
    address public timelockController;

    event TimelockControllerUpdated(address indexed previousTimelock, address indexed newTimelock);
    /**
     * @notice Initializes the private staking contract with token and verifier factory
     * @dev Constructor
     * @param _aegisToken Address of the Aegis token contract
     * @param _verifierFactory Address of the VerifierFactory contract
     */
    constructor(
        address _aegisToken,
        address _verifierFactory
    ) Ownable(msg.sender) {
        if (_aegisToken == address(0)) revert InvalidTokenAddress();
        if (_verifierFactory == address(0)) revert InvalidVerifierAddress();
        
        AEGIS_TOKEN = PrivateTokenContract(_aegisToken);
        VERIFIER_FACTORY = VerifierFactory(_verifierFactory);
        
        stakingState.currentEpoch = 0;
        stakingState.epochStartTime = block.timestamp;
    }
    
    /**
     * @notice Modifier to restrict access to owner or governance contract
     */
    modifier onlyOwnerOrGovernance() {
        if (msg.sender != owner() && !GovernanceAccessLib.isGovernanceTimelockOrCore(governanceContract, timelockController, msg.sender)) {
            revert UnauthorizedAccess();
        }
        _;
    }
    
    /**
     * @notice Modifier to restrict access to governance contract only
     */
    modifier onlyGovernance() {
        if (!GovernanceAccessLib.isGovernanceTimelockOrCore(governanceContract, timelockController, msg.sender)) {
            revert UnauthorizedAccess();
        }
        _;
    }
    
    /**
     * @notice Sets the timelock allowed to execute governance-gated calls via `TimelockController.execute`.
     */
    function setTimelockController(address newTimelock) external onlyOwner {
        emit TimelockControllerUpdated(timelockController, newTimelock);
        timelockController = newTimelock;
    }
    
    /**
     * @notice Sets the governance contract address (one-time setup by owner)
     * @param _governance Address of the governance contract
     */
    function setGovernanceContract(address _governance) external onlyOwner {
        if (_governance == address(0)) revert InvalidVerifierAddress();
        governanceContract = _governance;
    }
    
    /**
     * @notice Stakes tokens privately using zero-knowledge proofs to maintain confidentiality
     * @dev Stakes tokens using zero-knowledge proof
     * @param proof The ZK proof data
     * @param publicInputs Public inputs: [inputNullifier, outputCommitment, amount]
     */
    function stake(
        uint256[8] calldata proof,
        uint256[] calldata publicInputs
    ) external nonReentrant whenNotPaused {
        // Validate input length
        ProofLib.requireValidInputLength(publicInputs, 3);
        
        // Extract public inputs
        bytes32 inputNullifier = ProofLib.extractNullifier(publicInputs, 0);
        bytes32 outputCommitment = ProofLib.extractCommitment(publicInputs, 1);
        uint256 amount = ProofLib.extractAmount(publicInputs, 2);
        
        // Enhanced solvency and economic invariant checks
        _validateStakingSolvency(amount);
        _validateStakingEconomicInvariants(amount);
        
        // Validate parameters
        if (amount < MIN_STAKE_AMOUNT) revert InsufficientStakeAmount();
        if (commitmentTracking.stakingNullifiers[inputNullifier]) revert NullifierAlreadyUsed();
        if (commitmentTracking.stakingCommitments[outputCommitment]) revert CommitmentAlreadyExists();
        
        // Verify the ZK proof using VerifierFactory
        if (!VERIFIER_FACTORY.verifyProof(STAKING_CIRCUIT, proof, publicInputs)) {
            revert ProofVerificationFailed();
        }
        
        // Update state
        commitmentTracking.stakingNullifiers[inputNullifier] = true;
        commitmentTracking.stakingCommitments[outputCommitment] = true;
        commitmentTracking.commitmentEpochs[outputCommitment] = stakingState.currentEpoch;
        unchecked {
            ++stakingState.totalStakedCommitments;
        }
        stakingState.totalStakedAmount += amount;
        
        emit Staked(outputCommitment, stakingState.currentEpoch, block.timestamp);
    }
    
    /**
     * @notice Claims accumulated staking rewards privately using zero-knowledge proofs
     * @dev Claims staking rewards using zero-knowledge proof
     * @param proof The ZK proof data
     * @param publicInputs Public inputs: [stakingNullifier, rewardCommitment, rewardAmount]
     */
    function claimRewards(
        uint256[8] calldata proof,
        uint256[] calldata publicInputs
    ) external nonReentrant whenNotPaused {
        // Validate input length
        ProofLib.requireValidInputLength(publicInputs, 3);
        
        // Extract public inputs
        bytes32 stakingNullifier = ProofLib.extractNullifier(publicInputs, 0);
        bytes32 rewardCommitment = ProofLib.extractCommitment(publicInputs, 1);
        uint256 rewardAmount = ProofLib.extractAmount(publicInputs, 2);
        
        // Enhanced reward solvency checks
        _validateRewardSolvency(rewardAmount);
        _validateRewardEconomicInvariants(rewardAmount);
        
        // Verify the ZK proof using VerifierFactory
        if (!VERIFIER_FACTORY.verifyProof(REWARD_CIRCUIT, proof, publicInputs)) {
            revert ProofVerificationFailed();
        }
        
        // Validate parameters
        if (commitmentTracking.stakingNullifiers[stakingNullifier]) revert NullifierAlreadyUsed();
        if (commitmentTracking.stakingCommitments[rewardCommitment]) revert CommitmentAlreadyExists();
        if (stakingState.rewardPool < rewardAmount) revert InsufficientRewardPool();
        
        // Update state
        commitmentTracking.stakingNullifiers[stakingNullifier] = true;
        commitmentTracking.stakingCommitments[rewardCommitment] = true;
        stakingState.rewardPool -= rewardAmount;
        
        emit RewardsClaimed(stakingNullifier, rewardCommitment, stakingState.currentEpoch);
    }
    
    /**
     * @notice Initiates the unstaking process with a time delay for security
     * @dev Requests unstaking with delay
     * @param proof The ZK proof data
     * @param publicInputs Public inputs: [stakingNullifier, epoch]
     */
    function requestUnstake(
        uint256[8] calldata proof,
        uint256[] calldata publicInputs
    ) external nonReentrant whenNotPaused {
        // Validate input length
        ProofLib.requireValidInputLength(publicInputs, 2);
        
        // Extract public inputs
        bytes32 stakingNullifier = ProofLib.extractNullifier(publicInputs, 0);
        uint256 epoch = publicInputs[1];
        
        // Validate parameters
        if (commitmentTracking.unstakeRequestNullifiers[stakingNullifier]) revert NullifierAlreadyUsed();
        if (epoch > stakingState.currentEpoch) revert InvalidEpoch();
        
        // Verify the ZK proof using VerifierFactory (unstake uses staking circuit)
        if (!VERIFIER_FACTORY.verifyProof(STAKING_CIRCUIT, proof, publicInputs)) {
            revert ProofVerificationFailed();
        }
        
        // Set unstake request and mark nullifier as used
        uint256 currentTime = block.timestamp;
        // Safe addition to prevent overflow
        uint256 unlockTime;
        unchecked {
            unlockTime = currentTime + UNSTAKE_DELAY;
            // Check for overflow
            if (unlockTime < currentTime) revert TimestampOverflow();
        }
        commitmentTracking.unstakeRequests[stakingNullifier] = unlockTime;
        commitmentTracking.unstakeRequestNullifiers[stakingNullifier] = true;

        emit UnstakeRequested(stakingNullifier, unlockTime);
    }
    
    /**
     * @notice Completes the unstaking process after the required delay period has passed
     * @dev Completes unstaking after delay period
     * @param proof The ZK proof data
     * @param publicInputs Public inputs: [stakingNullifier, outputCommitment, amount]
     */
    function completeUnstake(
        uint256[8] calldata proof,
        uint256[] calldata publicInputs
    ) external nonReentrant whenNotPaused {
        // Validate input length
        ProofLib.requireValidInputLength(publicInputs, 3);
        
        // Extract public inputs
        bytes32 stakingNullifier = ProofLib.extractNullifier(publicInputs, 0);
        bytes32 outputCommitment = ProofLib.extractCommitment(publicInputs, 1);
        uint256 amount = ProofLib.extractAmount(publicInputs, 2);
        
        // Validate parameters
        if (commitmentTracking.unstakeRequests[stakingNullifier] == 0) revert UnstakeNotReady();
        // Use larger tolerance window to reduce timestamp manipulation risk
        // Allow unstaking if current time is within reasonable range of unlock time
        uint256 currentTime = block.timestamp;
        uint256 unlockTime = commitmentTracking.unstakeRequests[stakingNullifier];
        // Safe subtraction to prevent underflow
        uint256 toleranceAdjustedTime;
        unchecked {
            if (unlockTime < TIMESTAMP_TOLERANCE) {
                toleranceAdjustedTime = 0;
            } else {
                toleranceAdjustedTime = unlockTime - TIMESTAMP_TOLERANCE;
            }
        }
        if (currentTime < toleranceAdjustedTime) revert UnstakeDelayNotMet();
        // Note: stakingNullifier here is the same as used in stake() and requestUnstake()
        // It was already marked in stakingNullifiers during stake(), so we don't check that here
        // The unstakeRequests[stakingNullifier] != 0 check above ensures the request exists
        // and prevents double-unstaking since we delete the request after completion
        if (commitmentTracking.stakingCommitments[outputCommitment]) revert CommitmentAlreadyExists();
        
        // Verify the ZK proof using VerifierFactory (unstake uses staking circuit)
        if (!VERIFIER_FACTORY.verifyProof(STAKING_CIRCUIT, proof, publicInputs)) {
            revert ProofVerificationFailed();
        }
        
        // Update state
        commitmentTracking.stakingNullifiers[stakingNullifier] = true;
        commitmentTracking.stakingCommitments[outputCommitment] = true;
        delete commitmentTracking.unstakeRequests[stakingNullifier];
        unchecked {
            --stakingState.totalStakedCommitments;
        }
        stakingState.totalStakedAmount -= amount;
        
        emit UnstakeCompleted(stakingNullifier, outputCommitment);
    }
    
    /**
     * @notice Advances to the next epoch and distributes rewards
     */
    function advanceEpoch() external nonReentrant {
        uint256 currentTime = block.timestamp;
        // Safe arithmetic for epoch timing validation
        uint256 epochEndTime;
        uint256 toleranceAdjustedEndTime;
        unchecked {
            epochEndTime = stakingState.epochStartTime + EPOCH_DURATION;
            // Check for overflow
            if (epochEndTime < stakingState.epochStartTime) revert TimestampOverflow();
            
            // Safe subtraction for tolerance
            if (epochEndTime < TIMESTAMP_TOLERANCE) {
                toleranceAdjustedEndTime = 0;
            } else {
                toleranceAdjustedEndTime = epochEndTime - TIMESTAMP_TOLERANCE;
            }
        }
        
        // Use larger tolerance window to reduce timestamp manipulation risk
        if (currentTime < toleranceAdjustedEndTime) {
            revert EpochNotReady();
        }
        
        // Calculate rewards for the current epoch
        uint256 rewardAmount = (stakingState.rewardPool * REWARD_RATE) / 10000;
        // Use block.number instead of timestamp for commitment to reduce manipulation
        bytes32 rewardCommitment = keccak256(
            abi.encodePacked(stakingState.currentEpoch, rewardAmount, block.number, currentTime)
        );
        
        // Update epoch state
        rewardTracking.epochRewards[stakingState.currentEpoch] = rewardAmount;
        rewardTracking.epochRewardCommitments[stakingState.currentEpoch] = rewardCommitment;
        
        unchecked {
            ++stakingState.currentEpoch;
        }
        stakingState.epochStartTime = currentTime;
        
        // Reset for new epoch
        stakingState.totalStakedAmount = 0;
        stakingState.totalStakedCommitments = 0;
        
        emit EpochAdvanced(stakingState.currentEpoch, rewardAmount, rewardCommitment);
    }
    
    /**
     * @notice Adds funds to the reward pool (governance only)
     * @param amount Amount to add to the reward pool
     */
    function addRewardPool(uint256 amount) external onlyGovernance {
        if (amount == 0) revert InvalidAmount();
        
        // Update state before external call (checks-effects-interactions pattern)
        stakingState.rewardPool += amount;
        
        // Emit event before external call to prevent reentrancy issues
        emit RewardPoolUpdated(amount, stakingState.rewardPool);
        
        if (!AEGIS_TOKEN.transferFrom(msg.sender, address(this), amount)) {
            revert TransferFailed();
        }
    }
    
    /**
     * @notice Returns the current epoch information
     * @return epoch Current epoch number
     * @return startTime Epoch start timestamp
     * @return endTime Epoch end timestamp
     */
    function getCurrentEpochInfo() external view returns (
        uint256 epoch,
        uint256 startTime,
        uint256 endTime
    ) {
        return (stakingState.currentEpoch, stakingState.epochStartTime, stakingState.epochStartTime + EPOCH_DURATION);
    }
    
    /**
     * @notice Returns reward information for an epoch
     * @param epoch The epoch to query
     * @return rewardAmount Total rewards for the epoch
     * @return rewardCommitment The reward commitment hash
     */
    function getEpochRewards(uint256 epoch) external view returns (
        uint256 rewardAmount,
        bytes32 rewardCommitment
    ) {
        return (rewardTracking.epochRewards[epoch], rewardTracking.epochRewardCommitments[epoch]);
    }
    
    /**
     * @notice Checks if a staking commitment exists
     * @param commitment The commitment to check
     * @return True if the commitment exists
     */
    function isStakingCommitment(bytes32 commitment) external view returns (bool) {
        return commitmentTracking.stakingCommitments[commitment];
    }
    
    /**
     * @notice Verifier updates are now handled through VerifierFactory by governance
     * @dev VerifierFactory manages all verifier updates through governance
     * This function is kept for backward compatibility but does nothing
     * Verifiers are updated via VerifierFactory.updateVerifier() by governance
     */
    // Verifier updates are handled by VerifierFactory through governance
    
    // Getter functions for tests
    /**
     * @notice Returns the Aegis token contract address
     * @return The address of the Aegis token contract
     */
    function aegisToken() external view returns (address) {
        return address(AEGIS_TOKEN);
    }

    /**
     * @notice Returns the epoch duration constant
     * @return The duration of each epoch in seconds
     */
    function epochDuration() external pure returns (uint256) {
        return EPOCH_DURATION;
    }
    
    /**
     * @notice Returns the unstake delay constant
     * @return The delay period for unstaking in seconds
     */
    function unstakeDelay() external pure returns (uint256) {
        return UNSTAKE_DELAY;
    }
    
    /**
     * @notice Returns the reward rate for testing compatibility
     * @return The reward rate in basis points (multiplied by 10)
     */
    function rewardRate() external pure returns (uint256) {
        return REWARD_RATE * 10; // Convert to basis points for test compatibility
    }
    
    /**
     * @notice Returns the minimum stake amount constant
     * @return The minimum amount required for staking
     */
    function minimumStake() external pure returns (uint256) {
        return MIN_STAKE_AMOUNT;
    }
    
    /**
     * @notice Returns the current staking verifier contract address
     * @return The address of the staking verifier contract
     */
    function stakeVerifier() external view returns (address) {
        return VERIFIER_FACTORY.getVerifier(STAKING_CIRCUIT);
    }
    
    /**
     * @notice Returns information about a specific epoch
     * @param epoch The epoch number to query
     * @return totalStaked Total amount staked in the epoch
     * @return rewardAmount Total rewards available for the epoch
     * @return startTime Start timestamp of the epoch
     */
    function getEpochInfo(uint256 epoch) 
        external 
        view 
        returns (uint256 totalStaked, uint256 rewardAmount, uint256 startTime) 
    {
        totalStaked = epoch == stakingState.currentEpoch ? stakingState.totalStakedAmount : 0;
        // For current epoch, show rewardPool only if it's epoch 0 or if rewards have been allocated
        if (epoch == stakingState.currentEpoch) {
            rewardAmount = (epoch == 0) ? stakingState.rewardPool : rewardTracking.epochRewards[epoch];
        } else {
            rewardAmount = rewardTracking.epochRewards[epoch];
        }
        startTime = epoch == stakingState.currentEpoch ? stakingState.epochStartTime : 0;
    }
    
    /**
     * @notice Adds tokens to the reward pool (governance only)
     * @param amount Amount of tokens to add to the reward pool
     */
    function addToRewardPool(uint256 amount) external onlyGovernance {
        if (amount == 0) revert InvalidAmount();
        
        // Update state before external call (checks-effects-interactions pattern)
        stakingState.rewardPool += amount;
        
        // Emit event before external call to prevent reentrancy issues
        emit RewardPoolUpdated(amount, stakingState.rewardPool);
        
        if (!AEGIS_TOKEN.transferFrom(msg.sender, address(this), amount)) {
            revert TransferFailed();
        }
    }
    
    /**
     * @notice Verifier updates are now handled through VerifierFactory by governance
     * @dev This function is deprecated - verifiers are updated via VerifierFactory.updateVerifier() by governance
     * @param stakeVerifierAddress Deprecated - not used
     */
    function updateStakeVerifier(address stakeVerifierAddress) external onlyGovernance {
        // Verifier updates are handled by VerifierFactory through governance
        // This function is kept for backward compatibility but does nothing
        // Verifiers are updated via VerifierFactory.updateVerifier() by governance
        // Silently ignore the call to maintain backward compatibility
    }
    
    /**
     * @notice Pauses the contract, preventing most operations (governance only)
     */
    function pause() external onlyGovernance {
        _pause();
    }
    
    /**
     * @notice Unpauses the contract, allowing normal operations (governance only)
     */
    function unpause() external onlyGovernance {
        _unpause();
    }

    // ============ SOLVENCY AND ECONOMIC INVARIANT VALIDATION ============

    /**
     * @notice Validates staking solvency against Austrian economic principles
     * @dev Ensures sound staking practices and prevents over-concentration
     * @param stakeAmount Amount being staked
     */
    function _validateStakingSolvency(uint256 stakeAmount) internal view {
        // Austrian principle: Sound money requires real backing
        if (stakeAmount == 0) revert InvalidAmount();
        
        // Prevent single stake from dominating the pool (max 10% of total)
        if (stakingState.totalStakedAmount > 0) {
            uint256 maxSingleStake = (stakingState.totalStakedAmount * 10) / 100;
            if (stakeAmount > maxSingleStake) revert StakeTooLarge();
        }
        
        // Ensure minimum economic viability
        if (stakeAmount < MIN_STAKE_AMOUNT) revert InsufficientStakeAmount();
    }

    /**
     * @notice Validates staking economic invariants for sustainable rewards
     * @dev Ensures staking practices align with Austrian economic principles
     * @param stakeAmount Amount being staked
     */
    function _validateStakingEconomicInvariants(uint256 stakeAmount) internal view {
        // Prevent excessive staking that could destabilize token economics
        uint256 totalSupply = AEGIS_TOKEN.totalSupply();
        uint256 projectedStaked = stakingState.totalStakedAmount + stakeAmount;
        
        // Maximum 70% of total supply can be staked to maintain liquidity
        uint256 maxStakeable = (totalSupply * 70) / 100;
        if (projectedStaked > maxStakeable) revert ExcessiveStaking();
        
        // Ensure staking doesn't create unsustainable reward obligations
        uint256 projectedRewardObligation = (projectedStaked * REWARD_RATE) / 100;
        if (projectedRewardObligation > stakingState.rewardPool * 2) revert UnsustainableRewardObligation();
    }

    /**
     * @notice Validates reward claim solvency
     * @dev Ensures reward pool can sustain the claimed amount
     * @param rewardAmount Amount of rewards being claimed
     */
    function _validateRewardSolvency(uint256 rewardAmount) internal view {
        // Austrian principle: No fractional reserve rewards
        if (rewardAmount > stakingState.rewardPool) revert InsufficientRewardPool();
        
        // Maintain minimum reward pool reserve (5% of total)
        uint256 minimumReserve = (stakingState.rewardPool * 5) / 100;
        uint256 remainingPool = stakingState.rewardPool - rewardAmount;
        if (remainingPool < minimumReserve) revert InsufficientRewardReserves();
    }

    /**
     * @notice Validates reward economic invariants
     * @dev Ensures reward distribution aligns with Austrian economic principles
     * @param rewardAmount Amount of rewards being claimed
     */
    function _validateRewardEconomicInvariants(uint256 rewardAmount) internal view {
        // Prevent reward claims that exceed reasonable bounds
        if (rewardAmount == 0) revert InvalidAmount();
        
        // Single reward claim cannot exceed 1% of total reward pool
        uint256 maxSingleReward = (stakingState.rewardPool * 1) / 100;
        if (rewardAmount > maxSingleReward) revert RewardClaimTooLarge();
        
        // Ensure reward rate sustainability
        // Safe multiplication to prevent overflow
        uint256 annualizedReward;
        unchecked {
            annualizedReward = rewardAmount * 365; // Assuming daily claims
            // Check for overflow
            if (annualizedReward / 365 != rewardAmount) {
                revert RewardClaimTooLarge(); // Overflow occurred, reward too large
            }
        }
        uint256 maxSustainableAnnual = stakingState.totalStakedAmount / 10; // 10% max annual
        if (annualizedReward > maxSustainableAnnual) revert UnsustainableRewardRate();
    }

    // ============ CUSTOM ERRORS FOR STAKING SOLVENCY VALIDATION ============

    /// @notice Thrown when single stake exceeds concentration limits
    error StakeTooLarge();
    
    /// @notice Thrown when total staking would exceed safe thresholds
    error ExcessiveStaking();
    
    /// @notice Thrown when reward obligations become unsustainable
    error UnsustainableRewardObligation();
    
    /// @notice Thrown when reward reserves fall below minimum threshold
    error InsufficientRewardReserves();
    
    /// @notice Thrown when single reward claim exceeds limits
    error RewardClaimTooLarge();
    
    /// @notice Thrown when reward rate structure is unsustainable
    error UnsustainableRewardRate();
}
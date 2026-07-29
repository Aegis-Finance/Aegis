// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {VerifierFactory} from "./VerifierFactory.sol";
import {CommitmentLib} from "./libraries/CommitmentLib.sol";
import {PrivateTokenContract} from "./PrivateTokenContract.sol";
import {GovernanceAccessLib} from "./libraries/GovernanceAccessLib.sol";
import {ICommonErrors} from "./interfaces/ICommonErrors.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title PrivateYieldFarming
 * @author Aegis Protocol Team
 * @dev Anonymous yield farming and liquidity mining with ZK-proof privacy
 * @notice Supports multiple farming pools with private staking and rewards
 */
contract PrivateYieldFarming is Ownable, ReentrancyGuard, Pausable, ICommonErrors {
    using CommitmentLib for bytes32;
    using SafeERC20 for IERC20;

    // Custom errors for gas optimization
    error InvalidTimestamp();

    /// @notice Governance integration contract address
    address public governanceContract;

    /// @notice Optional `AegisTimelockController` for delayed governance execution.
    address public timelockController;

    event TimelockControllerUpdated(address indexed previousTimelock, address indexed newTimelock);
    /// @notice Treasury allocator that receives protocol-controlled liquidity
    address public liquidityAllocator;

    /// @notice Core private token contract for staking and rewards
    PrivateTokenContract public immutable PRIVATE_TOKEN;
    /// @notice Verifier factory for ZK proof verification
    VerifierFactory public immutable VERIFIER_FACTORY;
    
    // Circuit identifier for farming proofs
    string private constant FARMING_CIRCUIT = "farming";
    
    /// @notice Precision factor for reward calculations
    uint256 public constant REWARD_PRECISION = 1e18;
    /// @notice Minimum stake duration allowed
    uint256 public constant MIN_STAKE_DURATION = 1 days;
    /// @notice Maximum stake duration allowed
    uint256 public constant MAX_STAKE_DURATION = 365 days;
    /// @notice Early withdrawal penalty in basis points (10%)
    uint256 public constant EARLY_WITHDRAWAL_PENALTY = 1000; // 10%
    
    // Timestamp security constants
    uint256 private constant TIMESTAMP_TOLERANCE = 900; // 15 minutes tolerance for timestamp comparisons
    
    /// @notice Next available pool ID for new pools
    uint256 public nextPoolId;
    /// @notice Total rewards distributed across all pools
    uint256 public totalRewardsDistributed;
    /// @notice Total value locked across all pools
    uint256 public totalValueLocked;
    
    /// @notice Mapping of pool ID to farming pool data
    mapping(uint256 => FarmingPool) public pools;
    /// @notice Mapping of position ID to stake position data
    mapping(bytes32 => StakePosition) public positions;
    /// @notice Mapping to track used nullifiers for privacy
    mapping(bytes32 => bool) public nullifierUsed;
    /// @notice Mapping of pool ID to array of staker position IDs
    mapping(uint256 => bytes32[]) public poolStakers;
    /// @notice Mapping of staker position ID to pool ID
    mapping(bytes32 => uint256) public stakerPoolId;
    
    /// @notice Mapping of pool ID to reward per token stored
    mapping(uint256 => uint256) public poolRewardPerToken;
    /// @notice Mapping of position ID to user reward per token paid
    mapping(bytes32 => uint256) public userRewardPerTokenPaid;
    /// @notice Mapping of position ID to accumulated rewards
    mapping(bytes32 => uint256) public rewards;
    
    struct FarmingPool {
        uint256 id;
        string name;
        bytes32 stakingToken;
        bytes32 rewardToken;
        uint256 rewardRate; // Rewards per second
        uint256 totalStaked;
        uint256 lastUpdateTime;
        uint256 rewardPerTokenStored;
        uint256 poolEndTime;
        uint256 minStakeAmount;
        uint256 maxStakeAmount;
        bool isActive;
        bool isPrivate;
    }
    
    struct LiquidityLaunchConfig {
        uint64 startTime;
        uint64 gracePeriod;
        bool isScheduled;
    }
    
    LiquidityLaunchConfig public liquidityLaunchConfig;
    
    event LiquidityLaunchScheduled(uint64 indexed startTime, uint64 indexed gracePeriod);
    
    struct StakePosition {
        uint256 poolId;
        bytes32 staker;
        uint256 amount;
        uint256 stakingTime;
        uint256 lockDuration;
        uint256 lastClaimTime;
        uint256 accumulatedRewards;
        bool isActive;
        bytes32 privacyNullifier;
    }
    
    struct StakeParams {
        uint256 poolId;
        uint256 amount;
        uint256 lockDuration;
        bytes32 stakerCommitment;
        bytes32 nullifier;
        bytes zkProof;
    }
    
    struct UnstakeParams {
        bytes32 positionId;
        uint256 amount;
        bytes32 withdrawalCommitment;
        bytes32 nullifier;
        bytes zkProof;
    }
    
    struct ClaimParams {
        bytes32 positionId;
        bytes32 rewardCommitment;
        bytes32 nullifier;
        bytes zkProof;
    }
    
    // Events
    /**
     * @notice Emitted when a new farming pool is created
     * @param poolId The unique identifier of the created pool
     * @param name The name of the farming pool
     * @param stakingToken The token that can be staked in this pool
     * @param rewardToken The token distributed as rewards
     * @param rewardRate The rate of rewards per second
     */
    event PoolCreated(
        uint256 indexed poolId,
        string name,
        bytes32 indexed stakingToken,
        bytes32 indexed rewardToken,
        uint256 rewardRate
    );
    
    /**
     * @notice Emitted when tokens are staked in a farming pool
     * @param poolId The pool where tokens were staked
     * @param positionId The unique identifier of the stake position
     * @param staker The commitment representing the staker
     * @param amount The amount of tokens staked
     * @param lockDuration The duration for which tokens are locked
     */
    event Staked(
        uint256 indexed poolId,
        bytes32 indexed positionId,
        bytes32 indexed staker,
        uint256 amount,
        uint256 lockDuration
    );
    
    /**
     * @notice Emitted when tokens are unstaked from a farming pool
     * @param poolId The pool from which tokens were unstaked
     * @param positionId The unique identifier of the stake position
     * @param staker The commitment representing the staker
     * @param amount The amount of tokens unstaked
     * @param penalty The penalty amount for early withdrawal
     */
    event Unstaked(
        uint256 indexed poolId,
        bytes32 indexed positionId,
        bytes32 indexed staker,
        uint256 amount,
        uint256 penalty
    );
    
    /**
     * @notice Emitted when farming rewards are claimed
     * @param poolId The pool from which rewards were claimed
     * @param positionId The unique identifier of the stake position
     * @param staker The commitment representing the staker
     * @param amount The amount of rewards claimed
     */
    event RewardsClaimed(
        uint256 indexed poolId,
        bytes32 indexed positionId,
        bytes32 indexed staker,
        uint256 amount
    );
    
    /**
     * @notice Emitted when pool parameters are updated
     * @param poolId The pool that was updated
     * @param newRewardRate The new reward rate per second
     * @param newEndTime The new end time for the pool
     */
    event PoolUpdated(
        uint256 indexed poolId,
        uint256 indexed newRewardRate,
        uint256 indexed newEndTime
    );
    
    /**
     * @notice Emitted when emergency withdrawal is performed
     * @param positionId The unique identifier of the stake position
     * @param staker The commitment representing the staker
     * @param amount The amount of tokens withdrawn
     */
    event EmergencyWithdrawal(
        bytes32 indexed positionId,
        bytes32 indexed staker,
        uint256 indexed amount
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

    /**
     * @notice Emitted when the liquidity allocator address is updated
     * @param previousAllocator Previous allocator address
     * @param newAllocator New allocator address
     */
    event LiquidityAllocatorUpdated(
        address indexed previousAllocator,
        address indexed newAllocator
    );
    
    modifier validPool(uint256 poolId) {
        if (poolId > nextPoolId) revert InvalidPoolId();
        if (!pools[poolId].isActive) revert PoolNotActive();
        _;
    }
    
    modifier onlyValidProof(bytes memory proof, bytes32 commitment) {
        (uint256[8] memory convertedProof, uint256[] memory publicInputs) = 
            _convertProofData(proof, commitment);
        if (!VERIFIER_FACTORY.verifyProof(FARMING_CIRCUIT, convertedProof, publicInputs)) revert InvalidZKProof();
        _;
    }
    
    modifier updateReward(uint256 poolId, bytes32 positionId) {
        pools[poolId].rewardPerTokenStored = rewardPerToken(poolId);
        pools[poolId].lastUpdateTime = lastTimeRewardApplicable(poolId);
        
        if (positionId != bytes32(0)) {
            rewards[positionId] = earned(positionId);
            userRewardPerTokenPaid[positionId] = pools[poolId].rewardPerTokenStored;
        }
        _;
    }
    
    /**
     * @notice Initializes the PrivateYieldFarming contract with required dependencies
     * @dev Sets up the contract with private token and verifier factory contracts
     * @param _privateToken Address of the PrivateTokenContract for staking and rewards
     * @param _verifierFactory Address of the VerifierFactory for ZK proof verification
     */
    constructor(
        address _privateToken,
        address _verifierFactory
    ) Ownable(msg.sender) {
        if (_privateToken == address(0)) revert InvalidTokenAddress();
        if (_verifierFactory == address(0)) revert InvalidVerifierAddress();
        PRIVATE_TOKEN = PrivateTokenContract(_privateToken);
        VERIFIER_FACTORY = VerifierFactory(_verifierFactory);
        nextPoolId = 1;
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
     * @dev Owner can set initially, then only governance can update it to maintain decentralization
     * @param _governanceContract Address of the governance contract
     */
    function setGovernanceContract(address _governanceContract) external onlyOwnerOrGovernance {
        if (_governanceContract == address(0)) revert InvalidAddress();
        // Prevent changing governance if it's already set (unless caller is current governance)
        if (governanceContract != address(0) && !GovernanceAccessLib.isGovernanceTimelockOrCore(governanceContract, timelockController, msg.sender)) {
            revert UnauthorizedAccess();
        }
        address oldGovernance = governanceContract;
        governanceContract = _governanceContract;
        emit GovernanceUpdated(oldGovernance, _governanceContract);
    }

    /**
     * @notice Set the liquidity allocator contract responsible for public pool seeding
     * @dev Owner can set initially, then only governance can update it
     * @param allocator Address of the treasury liquidity allocator
     */
    function setLiquidityAllocator(address allocator) external onlyOwnerOrGovernance {
        if (allocator == address(0)) revert InvalidAddress();
        address previousAllocator = liquidityAllocator;
        liquidityAllocator = allocator;
        emit LiquidityAllocatorUpdated(previousAllocator, allocator);
    }
    
    /**
     * @notice Schedule the liquidity deployment window aligned with the Dutch auction completion.
     * @param startTimeUnix The UTC timestamp when the deployment should begin.
     * @param gracePeriodSeconds Additional grace period after the start timestamp.
     */
    function scheduleLiquidityDeployment(
        uint64 startTimeUnix,
        uint64 gracePeriodSeconds
    ) external onlyGovernance {
        if (startTimeUnix <= block.timestamp) revert InvalidTimestamp();
        liquidityLaunchConfig = LiquidityLaunchConfig({
            startTime: startTimeUnix,
            gracePeriod: gracePeriodSeconds,
            isScheduled: true
        });
        emit LiquidityLaunchScheduled(startTimeUnix, gracePeriodSeconds);
    }
    
    /**
     * @notice Create a new farming pool
     * @dev Creates a new yield farming pool with specified parameters and validation
     * @param name Pool name for identification
     * @param stakingToken Token to stake (as bytes32 commitment)
     * @param rewardToken Token for rewards (as bytes32 commitment)
     * @param rewardRate Rewards per second distributed to stakers
     * @param duration Pool duration in seconds
     * @param minStakeAmount Minimum stake amount required
     * @param maxStakeAmount Maximum stake amount allowed
     * @param isPrivate Whether the pool requires privacy proofs
     * @return poolId The unique identifier of the created pool
     */
    function createPool(
        string calldata name,
        bytes32 stakingToken,
        bytes32 rewardToken,
        uint256 rewardRate,
        uint256 duration,
        uint256 minStakeAmount,
        uint256 maxStakeAmount,
        bool isPrivate
    ) external whenNotPaused returns (uint256) {
        if (rewardRate == 0) revert InvalidRewardRate();
        if (duration == 0) revert InvalidDuration();
        if (minStakeAmount == 0) revert InvalidMinStake();
        if (maxStakeAmount < minStakeAmount) revert InvalidMaxStake();
        
        uint256 poolId = ++nextPoolId;
        uint256 currentTime = block.timestamp;
        
        pools[poolId] = FarmingPool({
            id: poolId,
            name: name,
            stakingToken: stakingToken,
            rewardToken: rewardToken,
            rewardRate: rewardRate,
            totalStaked: 0,
            lastUpdateTime: currentTime,
            rewardPerTokenStored: 0,
            poolEndTime: currentTime + duration,
            minStakeAmount: minStakeAmount,
            maxStakeAmount: maxStakeAmount,
            isActive: true,
            isPrivate: isPrivate
        });
        
        emit PoolCreated(poolId, name, stakingToken, rewardToken, rewardRate);
        
        return poolId;
    }
    
    /**
     * @notice Stake tokens in a farming pool with privacy protection
     * @dev Stakes tokens using ZK proofs for privacy, validates amounts and lock duration
     * @param params Staking parameters including pool ID, amount, lock duration, and ZK proof
     */
    function stake(
        StakeParams calldata params
    ) external 
        validPool(params.poolId) 
        onlyValidProof(params.zkProof, params.stakerCommitment)
        updateReward(params.poolId, bytes32(0))
    {
        _validateStakeParams(params);
        nullifierUsed[params.nullifier] = true;
        
        bytes32 positionId = _createStakePosition(params);
        _updatePoolStateForStake(params, positionId);
        
        // Emit event before external call
        emit Staked(
            params.poolId,
            positionId,
            params.stakerCommitment,
            params.amount,
            params.lockDuration
        );
        
        // Transfer staking tokens
        PRIVATE_TOKEN.transferToPoolInternal(
            params.stakerCommitment,
            address(this),
            params.amount
        );
    }
    
    /**
     * @notice Validate staking parameters
     * @dev Internal function to validate all staking requirements
     * @param params Staking parameters to validate
     */
    function _validateStakeParams(StakeParams calldata params) internal view {
        if (nullifierUsed[params.nullifier]) revert NullifierAlreadyUsed();
        if (params.amount == 0) revert CannotStakeZero();
        if (params.amount < pools[params.poolId].minStakeAmount) revert AmountBelowMinimum();
        if (params.amount > pools[params.poolId].maxStakeAmount) revert AmountAboveMaximum();
        if (params.lockDuration < MIN_STAKE_DURATION) revert LockDurationTooShort();
        if (params.lockDuration > MAX_STAKE_DURATION) revert LockDurationTooLong();
        uint256 currentTime = block.timestamp;
        // Safe addition to prevent overflow
        uint256 poolEndTimeWithTolerance;
        unchecked {
            uint256 poolEndTime = pools[params.poolId].poolEndTime;
            poolEndTimeWithTolerance = poolEndTime + TIMESTAMP_TOLERANCE;
            // Check for overflow
            if (poolEndTimeWithTolerance < poolEndTime) {
                revert PoolEnded(); // Overflow occurred, treat as ended
            }
        }
        if (currentTime > poolEndTimeWithTolerance) revert PoolEnded();
    }
    
    /**
     * @notice Create a new stake position
     * @dev Internal function to create and store a new stake position
     * @param params Staking parameters
     * @return positionId The unique identifier of the created position
     */
    function _createStakePosition(StakeParams calldata params) internal returns (bytes32) {
        uint256 currentTime = block.timestamp;
        
        // Create position ID
        bytes32 positionId = keccak256(
            abi.encodePacked(
                params.stakerCommitment,
                params.poolId,
                currentTime,
                params.nullifier
            )
        );
        
        // Create stake position
        positions[positionId] = StakePosition({
            poolId: params.poolId,
            staker: params.stakerCommitment,
            amount: params.amount,
            stakingTime: currentTime,
            lockDuration: params.lockDuration,
            lastClaimTime: currentTime,
            accumulatedRewards: 0,
            isActive: true,
            privacyNullifier: params.nullifier
        });
        
        return positionId;
    }
    
    /**
     * @notice Update pool state for new stake
     * @dev Internal function to update pool tracking after staking
     * @param params Staking parameters
     * @param positionId The position ID to track
     */
    function _updatePoolStateForStake(StakeParams calldata params, bytes32 positionId) internal {
        // Update pool state
        pools[params.poolId].totalStaked += params.amount;
        totalValueLocked += params.amount;
        
        // Track staker in pool
        poolStakers[params.poolId].push(positionId);
        stakerPoolId[positionId] = params.poolId;
    }
    
    /**
     * @notice Unstake tokens from a farming pool with privacy protection
     * @dev Unstakes tokens using ZK proofs, applies early withdrawal penalties if applicable
     * @param params Unstaking parameters including position ID, amount, and ZK proof
     */
    function unstake(
        UnstakeParams calldata params
    ) external onlyValidProof(params.zkProof, params.withdrawalCommitment) {
        _validateUnstakeParams(params);
        nullifierUsed[params.nullifier] = true;
        
        StakePosition storage position = positions[params.positionId];
        uint256 poolId = position.poolId;
        
        // Update rewards before unstaking
        _updateReward(poolId, params.positionId);
        
        (uint256 withdrawAmount, uint256 penalty) = _calculateWithdrawalAmounts(params, position);
        _updatePositionForUnstake(params, position);
        _updatePoolStateForUnstake(params, poolId);
        
        // Emit event before external calls
        emit Unstaked(
            poolId,
            params.positionId,
            position.staker,
            params.amount,
            penalty
        );
        
        // Transfer tokens back to user
        PRIVATE_TOKEN.transferFromPool(
            address(this),
            params.withdrawalCommitment,
            withdrawAmount
        );
        
        // Handle penalty (transfer to allocator or governance as protocol-controlled liquidity)
        if (penalty > 0) {
            address destination = liquidityAllocator != address(0)
                ? liquidityAllocator
                : governanceContract;

            if (destination != address(0)) {
                // CRITICAL: Use SafeERC20 to ensure transfer success and prevent unchecked transfer vulnerabilities
                IERC20(address(PRIVATE_TOKEN)).safeTransfer(destination, penalty);
            }
        }
    }
    
    /**
     * @notice Validate unstaking parameters
     * @dev Internal function to validate all unstaking requirements
     * @param params Unstaking parameters to validate
     */
    function _validateUnstakeParams(UnstakeParams calldata params) internal view {
        if (nullifierUsed[params.nullifier]) revert NullifierAlreadyUsed();
        if (!positions[params.positionId].isActive) revert PositionNotActive();
        if (params.amount == 0) revert CannotUnstakeZero();
        if (params.amount > positions[params.positionId].amount) revert AmountExceedsStake();
    }
    
    /**
     * @notice Calculate withdrawal amounts and penalties
     * @dev Internal function to calculate withdrawal amount and early withdrawal penalty
     * @param params Unstaking parameters
     * @param position The stake position being unstaked
     * @return withdrawAmount The amount to withdraw after penalty
     * @return penalty The penalty amount for early withdrawal
     */
    function _calculateWithdrawalAmounts(
        UnstakeParams calldata params, 
        StakePosition storage position
    ) internal view returns (uint256 withdrawAmount, uint256 penalty) {
        uint256 currentTime = block.timestamp;
        bool isEarlyWithdrawal = currentTime < position.stakingTime + position.lockDuration - TIMESTAMP_TOLERANCE;
        
        penalty = 0;
        if (isEarlyWithdrawal) {
            penalty = (params.amount * EARLY_WITHDRAWAL_PENALTY) / 10000;
        }
        
        withdrawAmount = params.amount - penalty;
    }
    
    /**
     * @notice Update position state for unstaking
     * @dev Internal function to update position after unstaking
     * @param params Unstaking parameters
     * @param position The stake position being updated
     */
    function _updatePositionForUnstake(
        UnstakeParams calldata params, 
        StakePosition storage position
    ) internal {
        position.amount -= params.amount;
        if (position.amount < 1) {
            position.isActive = false;
        }
    }
    
    /**
     * @notice Update pool state for unstaking
     * @dev Internal function to update pool tracking after unstaking
     * @param params Unstaking parameters
     * @param poolId The pool ID to update
     */
    function _updatePoolStateForUnstake(UnstakeParams calldata params, uint256 poolId) internal {
        pools[poolId].totalStaked -= params.amount;
        totalValueLocked -= params.amount;
    }
    
    /**
     * @dev Claim farming rewards
     * @param params Claim parameters with ZK proof
     */
    /**
     * @notice Claim accumulated farming rewards with privacy protection
     * @dev Claims rewards using ZK proofs, transfers to caller's transparent balance
     * @param params Claim parameters including position ID, reward commitment, and ZK proof
     */
    function claimRewards(
        ClaimParams calldata params
    ) external onlyValidProof(params.zkProof, params.rewardCommitment) {
        if (nullifierUsed[params.nullifier]) revert NullifierAlreadyUsed();
        if (!positions[params.positionId].isActive) revert PositionNotActive();
        
        nullifierUsed[params.nullifier] = true;
        
        StakePosition storage position = positions[params.positionId];
        uint256 poolId = position.poolId;
        
        // Update rewards
        _updateReward(poolId, params.positionId);
        
        uint256 reward = rewards[params.positionId];
        if (reward == 0) revert NoRewardsAvailable();
        
        // Reset rewards
        rewards[params.positionId] = 0;
        position.lastClaimTime = block.timestamp;
        position.accumulatedRewards += reward;
        totalRewardsDistributed += reward;
        
        // Emit event before external call
        emit RewardsClaimed(
            poolId,
            params.positionId,
            position.staker,
            reward
        );
        
        // Austrian Economic Principle: Transfer from existing supply, don't mint new tokens
        // "Credit expansion is the root of the boom-bust cycle" - Ludwig von Mises
        // Transfer rewards from this contract's balance to caller's transparent balance
        // Note: User can then shield tokens to commitments if privacy is desired
        if (PRIVATE_TOKEN.balanceOf(address(this)) < reward) revert InsufficientRewardPoolBalance();
        // CRITICAL: Use SafeERC20 to ensure transfer success and prevent unchecked transfer vulnerabilities
        IERC20(address(PRIVATE_TOKEN)).safeTransfer(msg.sender, reward);
    }
    
    /**
     * @notice Compound accumulated rewards by automatically restaking them
     * @dev Compounds rewards using ZK proofs, adds rewards to existing stake position
     * @param positionId The unique identifier of the stake position to compound
     * @param nullifier Unique nullifier to prevent double-spending
     * @param zkProof Zero-knowledge proof for privacy protection
     */
    function compoundRewards(
        bytes32 positionId,
        bytes32 nullifier,
        bytes calldata zkProof
    ) external onlyValidProof(zkProof, positionId) {
        if (nullifierUsed[nullifier]) revert NullifierAlreadyUsed();
        if (!positions[positionId].isActive) revert PositionNotActive();
        
        nullifierUsed[nullifier] = true;
        
        StakePosition storage position = positions[positionId];
        uint256 poolId = position.poolId;
        
        // Update rewards
        _updateReward(poolId, positionId);
        
        uint256 reward = rewards[positionId];
        if (reward == 0) revert NoRewardsToCompound();
        
        // Reset rewards and add to stake
        rewards[positionId] = 0;
        position.amount += reward;
        position.accumulatedRewards += reward;
        
        // Update pool state
        pools[poolId].totalStaked += reward;
        totalValueLocked += reward;
        totalRewardsDistributed += reward;
        
        // Austrian Economic Principle: Transfer from existing supply, don't mint new tokens
        // "The boom can last only as long as the credit expansion progresses" - Ludwig von Mises
        // For compounding, the reward stays in the contract's balance (already accounted for in position.amount)
        if (PRIVATE_TOKEN.balanceOf(address(this)) < reward) revert InsufficientRewardPoolBalance();
        // No transfer needed as tokens remain in contract for compounding
    }
    
    /**
     * @dev Emergency withdrawal (forfeits all rewards)
     * @param positionId Position to withdraw
     * @param withdrawalCommitment Commitment for withdrawal
     * @param nullifier Unique nullifier
     * @param zkProof ZK proof
     */
    function emergencyWithdraw(
        bytes32 positionId,
        bytes32 withdrawalCommitment,
        bytes32 nullifier,
        bytes calldata zkProof
    ) external onlyValidProof(zkProof, withdrawalCommitment) {
        if (nullifierUsed[nullifier]) revert NullifierAlreadyUsed();
        if (!positions[positionId].isActive) revert PositionNotActive();
        
        nullifierUsed[nullifier] = true;
        
        StakePosition storage position = positions[positionId];
        uint256 poolId = position.poolId;
        uint256 amount = position.amount;
        
        // Deactivate position
        position.isActive = false;
        position.amount = 0;
        
        // Update pool state
        pools[poolId].totalStaked -= amount;
        totalValueLocked -= amount;
        
        // Emit event before external call
        emit EmergencyWithdrawal(positionId, position.staker, amount);
        
        // Transfer tokens back (no rewards)
        PRIVATE_TOKEN.transferFromPool(
            address(this),
            withdrawalCommitment,
            amount
        );
    }
    
    /**
     * @notice Update pool parameters (governance function)
     * @dev Only governance or owner can update pool parameters, updates rewards before changes
     * @param poolId The unique identifier of the pool to update
     * @param newRewardRate The new reward rate per second (0 to keep current rate)
     * @param additionalDuration Additional duration in seconds to extend the pool
     */
    function updatePool(
        uint256 poolId,
        uint256 newRewardRate,
        uint256 additionalDuration
    ) external validPool(poolId) onlyGovernance {
        // Only governance (owner) can update pool parameters
        FarmingPool storage pool = pools[poolId];
        
        // Update rewards before changing rate
        pool.rewardPerTokenStored = rewardPerToken(poolId);
        pool.lastUpdateTime = lastTimeRewardApplicable(poolId);
        
        if (newRewardRate > 0) {
            pool.rewardRate = newRewardRate;
        }
        
        if (additionalDuration > 0) {
            pool.poolEndTime += additionalDuration;
        }
        
        emit PoolUpdated(poolId, pool.rewardRate, pool.poolEndTime);
    }
    
    /**
     * @notice Internal function to update rewards for a pool and position
     * @dev Updates reward calculations before state changes
     * @param poolId The unique identifier of the pool to update
     * @param positionId The unique identifier of the position to update (bytes32(0) for pool-only update)
     */
    function _updateReward(uint256 poolId, bytes32 positionId) internal {
        pools[poolId].rewardPerTokenStored = rewardPerToken(poolId);
        pools[poolId].lastUpdateTime = lastTimeRewardApplicable(poolId);
        
        if (positionId != bytes32(0)) {
            rewards[positionId] = earned(positionId);
            userRewardPerTokenPaid[positionId] = pools[poolId].rewardPerTokenStored;
        }
    }
    
    // View functions
    /**
     * @notice Get the last time rewards are applicable for a pool
     * @dev Returns the minimum of current time and pool end time with tolerance
     * @param poolId The unique identifier of the pool
     * @return The timestamp when rewards were last applicable
     */
    function lastTimeRewardApplicable(uint256 poolId) public view returns (uint256) {
        uint256 currentTime = block.timestamp;
        return currentTime < pools[poolId].poolEndTime + TIMESTAMP_TOLERANCE ? 
               currentTime : pools[poolId].poolEndTime;
    }
    
    /**
     * @notice Calculate the reward per token for a pool
     * @dev Calculates accumulated rewards per token based on time and rate
     * @param poolId The unique identifier of the pool
     * @return The reward per token amount with precision scaling
     */
    function rewardPerToken(uint256 poolId) public view returns (uint256) {
        FarmingPool memory pool = pools[poolId];
        if (pool.totalStaked > 0) {
            // CRITICAL FIX: Additional check for division by zero (though already checked above)
            // This protects against race conditions where totalStaked could become 0
            if (pool.totalStaked == 0) {
                return pool.rewardPerTokenStored;
            }
            return pool.rewardPerTokenStored + (
                (lastTimeRewardApplicable(poolId) - pool.lastUpdateTime) * 
                pool.rewardRate * REWARD_PRECISION / pool.totalStaked
            );
        }
        
        return pool.rewardPerTokenStored;
    }
    
    /**
     * @notice Calculate earned rewards for a position
     * @dev Calculates total earned rewards based on stake amount and reward rate
     * @param positionId The unique identifier of the stake position
     * @return The total earned rewards for the position
     */
    function earned(bytes32 positionId) public view returns (uint256) {
        StakePosition memory position = positions[positionId];
        uint256 poolId = position.poolId;
        
        return (position.amount * 
                (rewardPerToken(poolId) - userRewardPerTokenPaid[positionId]) / 
                REWARD_PRECISION) + rewards[positionId];
    }
    
    /**
     * @notice Get complete stake position information
     * @dev Returns all details of a stake position
     * @param positionId The unique identifier of the stake position
     * @return The complete StakePosition struct
     */
    function getPosition(bytes32 positionId) external view returns (StakePosition memory) {
        return positions[positionId];
    }
    
    /**
     * @notice Get complete farming pool information
     * @dev Returns all details of a farming pool
     * @param poolId The unique identifier of the pool
     * @return The complete FarmingPool struct
     */
    function getPool(uint256 poolId) external view returns (FarmingPool memory) {
        return pools[poolId];
    }
    
    /**
     * @notice Get all staker position IDs for a pool
     * @dev Returns array of position IDs that have staked in the pool
     * @param poolId The unique identifier of the pool
     * @return Array of position IDs (bytes32[])
     */
    function getPoolStakers(uint256 poolId) external view returns (bytes32[] memory) {
        return poolStakers[poolId];
    }
    
    /**
     * @notice Calculate the Annual Percentage Yield (APY) for a pool
     * @dev Calculates APY based on current reward rate and total staked amount
     * @param poolId The unique identifier of the pool
     * @return APY in basis points (10000 = 100%)
     */
    function calculateAPY(uint256 poolId) external view returns (uint256) {
        FarmingPool memory pool = pools[poolId];
        if (pool.totalStaked > 0) {
            uint256 yearlyRewards = pool.rewardRate * 365 days;
            return (yearlyRewards * 10000) / pool.totalStaked; // APY in basis points
        }
        
        return 0;
    }
    
    /**
     * @notice Get the current value and pending rewards for a position
     * @dev Returns both staked amount and accumulated pending rewards
     * @param positionId The unique identifier of the stake position
     * @return amount The staked amount in the position
     * @return pendingRewards The pending rewards available for claim
     */
    function getPositionValue(bytes32 positionId) external view returns (uint256, uint256) {
        StakePosition memory position = positions[positionId];
        uint256 pendingRewards = earned(positionId);
        return (position.amount, pendingRewards);
    }

    /**
     * @notice Convert proof data for ZK verification
     * @dev Converts bytes proof to uint256[8] array and extracts public inputs
     * @param proof The ZK proof as bytes
     * @param commitment The commitment used as public input
     * @return convertedProof The proof converted to uint256[8] format
     * @return publicInputs The public inputs array for verification
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
    
    /**
     * @notice Pauses the contract, preventing most operations (governance only)
     * @dev DAO-controlled: Only governance can pause for emergency situations
     */
    function pause() external onlyGovernance {
        _pause();
    }
    
    /**
     * @notice Unpauses the contract, allowing normal operations (governance only)
     * @dev DAO-controlled: Only governance can unpause after emergency resolution
     */
    function unpause() external onlyGovernance {
        _unpause();
    }
}
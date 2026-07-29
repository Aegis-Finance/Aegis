// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "./../interfaces/ICommonErrors.sol";
import {IPrivateGovernance} from "./../interfaces/IPrivateGovernance.sol";
import {GovernanceAccessLib} from "../libraries/GovernanceAccessLib.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AustrianAnalytics} from "./AustrianAnalytics.sol";

/**
 * @title PraxeologicalRewards
 * @author Aegis Protocol Team
 * @notice Implements Austrian Economics-based reward distribution for crowdfunding participants
 * @dev Rewards are distributed based on praxeological analysis and catallaxy metrics
 * @dev Decentralized Governance: Controlled by DAO through IPrivateGovernance interface
 * 
 * Austrian Economics Principles Implemented:
 * 1. Subjective Value Theory - Rewards based on individual value creation
 * 2. Methodological Individualism - Individual action assessment
 * 3. Spontaneous Order - Emergent reward patterns from market behavior
 * 4. Catallaxy - Coordination through voluntary exchange
 * 5. Praxeology - Human action analysis for reward calculation
 * 6. Time Preference - Temporal aspects of value creation
 * 7. Entrepreneurial Action - Innovation and discovery rewards
 * 8. Market Process - Dynamic reward adjustment
 */
contract PraxeologicalRewards is ReentrancyGuard , ICommonErrors{
    using SafeERC20 for IERC20;

    // Austrian Economics reward categories
    enum RewardCategory {
        PRAXEOLOGICAL_ACTION,      // Purposeful human action
        CATALLAXY_COORDINATION,    // Market coordination
        SUBJECTIVE_VALUE_CREATION, // Individual value creation
        SPONTANEOUS_ORDER,         // Emergent order contribution
        ENTREPRENEURIAL_DISCOVERY, // Innovation and discovery
        TEMPORAL_COORDINATION,     // Time preference optimization
        MARKET_PROCESS,           // Market mechanism participation
        VOLUNTARY_EXCHANGE        // Voluntary association rewards
    }

    // Reward calculation method
    enum CalculationMethod {
        MARGINAL_UTILITY,         // Based on marginal utility theory
        SUBJECTIVE_VALUE,         // Based on subjective value theory
        PRAXEOLOGICAL_SCORE,      // Based on praxeological analysis
        CATALLAXY_CONTRIBUTION,   // Based on catallaxy metrics
        MARKET_COORDINATION,      // Based on market coordination
        TEMPORAL_PREFERENCE,      // Based on time preference
        ENTREPRENEURIAL_ACTION,   // Based on entrepreneurial metrics
        COMPOSITE_AUSTRIAN       // Composite Austrian Economics score
    }

    // Optimized reward pool structure for Solidity 0.8.26
    struct RewardPool {
        uint256 poolId;
        uint256 campaignId;
        uint256 totalAmount;
        uint256 distributedAmount;
        uint256 startTime;
        uint256 endTime;
        uint256 minParticipationScore;
        uint256 maxRewardPerActor;
        IERC20 rewardToken;
        RewardCategory category;        // uint8
        CalculationMethod method;       // uint8
        bool isActive;                  // bool
        bool isFinalized;              // bool
        mapping(address => uint256) actorRewards;
        mapping(address => bool) hasClaimed;
        address[] participants;
    }

    // Optimized Austrian Economics reward metrics for Solidity 0.8.26
    struct AustrianRewardMetrics {
        uint128 praxeologicalWeight;      // Weight for purposeful action
        uint128 catallacticWeight;        // Weight for market coordination
        uint128 subjectiveValueWeight;    // Weight for subjective value
        uint128 spontaneousOrderWeight;   // Weight for spontaneous order
        uint128 entrepreneurialWeight;    // Weight for entrepreneurial action
        uint128 temporalWeight;           // Weight for temporal coordination
        uint128 marketProcessWeight;      // Weight for market process
        uint128 voluntaryExchangeWeight;  // Weight for voluntary exchange
        uint256 totalWeight;              // Total weight for normalization
    }

    // Optimized temporal reward adjustment for Solidity 0.8.26
    struct TemporalAdjustment {
        uint128 earlyParticipationBonus;  // Bonus for early participation
        uint128 consistencyBonus;         // Bonus for consistent participation
        uint128 longTermCommitmentBonus;  // Bonus for long-term commitment
        uint128 timeDecayFactor;          // Factor for time-based decay
        uint256 temporalWindow;           // Time window for temporal analysis
    }

    // Optimized market process reward factors for Solidity 0.8.26
    struct MarketProcessFactors {
        uint128 discoveryReward;          // Reward for market discovery
        uint128 competitionReward;        // Reward for competitive behavior
        uint128 innovationReward;         // Reward for innovation
        uint128 arbitrageReward;          // Reward for arbitrage opportunities
        uint128 coordinationReward;       // Reward for coordination
        uint128 informationReward;        // Reward for information transmission
        uint128 liquidityReward;          // Reward for liquidity provision
        uint128 stabilityReward;          // Reward for market stability
    }

    // State variables
    IPrivateGovernance public governance;

    address public timelockController;

    event TimelockControllerUpdated(address indexed previousTimelock, address indexed newTimelock);

    AustrianAnalytics public immutable AUSTRIAN_ANALYTICS;
    /// @notice Governance-controlled whitelist of downstream sinks eligible to receive streamed funds
    mapping(address => bool) public approvedSinks;
    
    mapping(uint256 => RewardPool) public rewardPools;
    mapping(uint256 => AustrianRewardMetrics) public rewardMetrics;
    mapping(uint256 => TemporalAdjustment) public temporalAdjustments;
    mapping(uint256 => MarketProcessFactors) public marketProcessFactors;
    mapping(address => mapping(uint256 => uint256)) public actorTotalRewards;
    mapping(uint256 => uint256[]) public campaignRewardPools;
    
    uint256 public nextPoolId = 1;
    uint256 public totalRewardPools;
    uint256[] public activePoolIds;
    
    // Immutable variables for Austrian Economics calculations (Solidity 0.8.26)
    uint256 public immutable PRAXEOLOGICAL_BASE_SCORE;
    uint256 public immutable CATALLAXY_BASE_SCORE;
    uint256 public immutable SUBJECTIVE_VALUE_BASE;
    uint256 public immutable SPONTANEOUS_ORDER_BASE;
    uint256 public immutable ENTREPRENEURIAL_BASE;
    uint256 public immutable TEMPORAL_BASE_FACTOR;
    uint256 public immutable MARKET_PROCESS_BASE;
    uint256 public immutable VOLUNTARY_EXCHANGE_BASE;
    
    uint256 public immutable MAX_REWARD_PERCENTAGE; // Max 50% of pool per actor
    uint256 public immutable MIN_PARTICIPATION_THRESHOLD; // Minimum actions for rewards
    uint256 public immutable TEMPORAL_DECAY_PERIOD;
    uint256 public immutable EARLY_PARTICIPATION_WINDOW;
    uint256 public immutable TIME_BUFFER; // Buffer to prevent timestamp manipulation

    // Events with proper indexing for Solidity 0.8.26
    event RewardPoolCreated(
        uint256 indexed poolId,
        uint256 indexed campaignId,
        address indexed rewardToken,
        uint256 totalAmount,
        RewardCategory category,
        CalculationMethod method
    );
    
    event RewardsCalculated(
        uint256 indexed poolId,
        uint256 totalParticipants,
        uint256 totalDistributed,
        CalculationMethod method
    );
    
    event RewardClaimed(
        uint256 indexed poolId,
        address indexed actor,
        uint256 amount,
        RewardCategory category
    );
    
    /**
     * @notice Emitted when a reward pool is finalized and all rewards are distributed
     * @param poolId The unique identifier of the finalized reward pool
     * @param totalDistributed The total amount of rewards that were distributed
     */
    event RewardPoolFinalized(uint256 indexed poolId, uint256 indexed totalDistributed);
    
    /**
     * @notice Emitted when Austrian Economics metrics are updated for a reward pool
     * @param poolId The unique identifier of the reward pool
     * @param praxeologicalWeight The weight assigned to praxeological scoring
     * @param catallacticWeight The weight assigned to catallactic contribution scoring
     * @param subjectiveValueWeight The weight assigned to subjective value scoring
     */
    event AustrianMetricsUpdated(
        uint256 indexed poolId,
        uint256 indexed praxeologicalWeight,
        uint256 indexed catallacticWeight,
        uint256 subjectiveValueWeight
    );

    /**
     * @notice Emitted when governance contract is updated
     * @param oldGovernance Previous governance contract address
     * @param newGovernance New governance contract address
     */
    event GovernanceUpdated(address indexed oldGovernance, address indexed newGovernance);
    /**
     * @notice Emitted when a sink (downstream module) approval is updated
     * @param sink The sink address updated
     * @param approved Whether the sink is approved
     */
    event SinkApprovalUpdated(address indexed sink, bool approved);
    /**
     * @notice Emitted when funds are streamed to an approved sink
     * @param sink The sink address
     * @param token The token address
     * @param amount The streamed amount
     */
    event FundsStreamed(address indexed sink, address indexed token, uint256 indexed amount);

    // Custom errors for Solidity 0.8.26

    error PoolAlreadyFinalized();
    error InsufficientPoolBalance();
    
    
    error InvalidRewardMetrics();
    error InvalidTemporalAdjustment();
    error InvalidMarketProcessFactors();
    
    error InvalidTotalAmount();
    
    error MaxRewardTooHigh();
    error SinkNotApproved();

    error InvalidCampaignId();
    error InvalidWeights();
    error InvalidTimeWindow();
    error InvalidDecayFactor();
    error PoolNotEnded();

    /**
     * @notice Initializes the PraxeologicalRewards contract with Austrian Analytics integration
     * @param _austrianAnalytics Address of the AustrianAnalytics contract for behavioral analysis
     * @param _governance Address of the governance contract for DAO control
     */
    constructor(address _austrianAnalytics, address _governance) {
        if (_austrianAnalytics == address(0)) revert ICommonErrors.ZeroAddress();
if (_governance == address(0)) revert ICommonErrors.ZeroAddress();
        
        AUSTRIAN_ANALYTICS = AustrianAnalytics(_austrianAnalytics);
        governance = IPrivateGovernance(_governance);
        
        // Initialize immutable variables for Solidity 0.8.26
        PRAXEOLOGICAL_BASE_SCORE = 100;
        CATALLAXY_BASE_SCORE = 100;
        SUBJECTIVE_VALUE_BASE = 100;
        SPONTANEOUS_ORDER_BASE = 100;
        ENTREPRENEURIAL_BASE = 100;
        TEMPORAL_BASE_FACTOR = 100;
        MARKET_PROCESS_BASE = 100;
        VOLUNTARY_EXCHANGE_BASE = 100;
        MAX_REWARD_PERCENTAGE = 50; // Max 50% of pool per actor
        MIN_PARTICIPATION_THRESHOLD = 10; // Minimum actions for rewards
        TEMPORAL_DECAY_PERIOD = 30 days;
        EARLY_PARTICIPATION_WINDOW = 7 days;
        TIME_BUFFER = 30; // 30 seconds buffer to prevent timestamp manipulation
    }

    /**
     * @notice Modifier to restrict access to governance contract only
     */
    modifier onlyGovernance() {
        if (!GovernanceAccessLib.isGovernanceTimelockOrCore(address(governance), timelockController, msg.sender)) {
            revert ICommonErrors.UnauthorizedAccess();
        }
        _;
    }

    function setTimelockController(address newTimelock) external onlyGovernance {
        emit TimelockControllerUpdated(timelockController, newTimelock);
        timelockController = newTimelock;
    }

    /**
     * @notice Update the governance contract address
     * @param newGovernance New governance contract address
     */
    function setGovernance(address newGovernance) external onlyGovernance {
        if (newGovernance == address(0)) revert ZeroAddress();
        address oldGovernance = address(governance);
        governance = IPrivateGovernance(newGovernance);
        emit GovernanceUpdated(oldGovernance, newGovernance);
    }
    /**
     * @notice Governance can approve or revoke multiple downstream sinks atomically
     * @param sinks Array of sink addresses (staking, farming, treasury, etc.)
     * @param approvals Parallel array of approval flags
     */
    function setApprovedSinks(address[] calldata sinks, bool[] calldata approvals) external onlyGovernance {
        if (sinks.length != approvals.length) revert ICommonErrors.ArrayLengthMismatch();
        for (uint256 i = 0; i < sinks.length; ++i) {
            if (sinks[i] == address(0)) revert ICommonErrors.ZeroAddress();
            approvedSinks[sinks[i]] = approvals[i];
            emit SinkApprovalUpdated(sinks[i], approvals[i]);
        }
    }
    /**
     * @notice Governance-only streaming of funds to approved sinks
     * @dev NonReentrant, CEI pattern, whitelist enforced. No user inputs are trusted.
     * @param sink Approved sink address to receive tokens
     * @param token ERC20 token to stream (e.g., AGS)
     * @param amount Amount to stream
     */
    function streamTo(address sink, IERC20 token, uint256 amount) external onlyGovernance nonReentrant {
        if (!approvedSinks[sink]) revert SinkNotApproved();
        if (sink == address(0)) revert ICommonErrors.ZeroAddress();
        if (address(token) == address(0)) revert ICommonErrors.ZeroAddress();
        if (amount == 0) revert InvalidAmount();
        uint256 balance = token.balanceOf(address(this));
        if (balance < amount) revert InsufficientPoolBalance();
        token.safeTransfer(sink, amount);
        emit FundsStreamed(sink, address(token), amount);
    }

    /**
     * @notice Create a new reward pool for Austrian Economics-based distribution
     * @param campaignId The campaign ID
     * @param rewardToken The ERC20 token for rewards
     * @param totalAmount The total amount of rewards
     * @param category The reward category
     * @param method The calculation method
     * @param duration The duration of the reward pool
     * @param minParticipationScore Minimum participation score required
     * @param maxRewardPerActor Maximum reward per actor (percentage of pool)
     */
    function createRewardPool(
        uint256 campaignId,
        IERC20 rewardToken,
        uint256 totalAmount,
        RewardCategory category,
        CalculationMethod method,
        uint256 duration,
        uint256 minParticipationScore,
        uint256 maxRewardPerActor
    ) external onlyGovernance {
        if (totalAmount == 0) revert InvalidTotalAmount();
        if (duration == 0) revert ICommonErrors.InvalidDuration();
        if (maxRewardPerActor > MAX_REWARD_PERCENTAGE) revert MaxRewardTooHigh();
        
        uint256 poolId;
        unchecked {
            poolId = nextPoolId++;
        }
        
        RewardPool storage pool = rewardPools[poolId];
        pool.poolId = poolId;
        pool.campaignId = campaignId;
        pool.rewardToken = rewardToken;
        pool.totalAmount = totalAmount;
        pool.distributedAmount = 0;
        pool.startTime = block.timestamp;
        unchecked {
            pool.endTime = block.timestamp + duration;
        }
        pool.category = category;
        pool.method = method;
        pool.minParticipationScore = minParticipationScore;
        pool.maxRewardPerActor = maxRewardPerActor;
        pool.isActive = true;
        pool.isFinalized = false;
        
        // Transfer tokens to contract
        rewardToken.safeTransferFrom(msg.sender, address(this), totalAmount);
        
        // Initialize default Austrian Economics metrics
        _initializeDefaultMetrics(poolId);
        
        // Add to tracking arrays
        activePoolIds.push(poolId);
        campaignRewardPools[campaignId].push(poolId);
        unchecked {
            ++totalRewardPools;
        }
        
        emit RewardPoolCreated(poolId, campaignId, address(rewardToken), totalAmount, category, method);
    }

    /**
     * @notice Calculate and distribute rewards based on Austrian Economics principles
     * @param poolId The reward pool ID
     */
    function calculateAndDistributeRewards(uint256 poolId) external onlyGovernance nonReentrant {
        RewardPool storage pool = rewardPools[poolId];
        if (pool.poolId == 0) revert ICommonErrors.PoolNotFound();
        if (!pool.isActive) revert ICommonErrors.PoolNotActive();
        if (pool.isFinalized) revert PoolAlreadyFinalized();
        
        // Get campaign participants from Austrian Analytics
        address[] memory actors = AUSTRIAN_ANALYTICS.getCampaignActors(pool.campaignId);
        
        uint256 totalScore = 0;
        uint256[] memory actorScores = new uint256[](actors.length);
        uint256 validParticipants = 0;
        
        // Calculate Austrian Economics scores for each actor
        for (uint256 i = 0; i < actors.length;) {
            uint256 score = _calculateAustrianScore(poolId, pool.campaignId, actors[i]);
            
            // Fix underflow bug: handle minParticipationScore of 0 properly
            bool meetsMinScore = pool.minParticipationScore == 0 ? 
                score > 0 : 
                score >= pool.minParticipationScore;
                
            if (meetsMinScore) {
                actorScores[i] = score;
                
                // Check for overflow before adding
                if (totalScore > type(uint256).max - score) {
                    totalScore = type(uint256).max;
                } else {
                    totalScore += score;
                }
                
                if (validParticipants < type(uint256).max) {
                    validParticipants++;
                }
            }
            
            if (i < type(uint256).max) {
                i++;
            } else {
                break;
            }
        }
        
        if (totalScore == 0) {
            return; // No valid participants
        }
        
        // Distribute rewards proportionally
        uint256 totalDistributed = 0;
        for (uint256 i = 0; i < actors.length;) {
            bool hasMinScore = pool.minParticipationScore == 0 || 
                              actorScores[i] >= pool.minParticipationScore;
            if (actorScores[i] > 0 && hasMinScore) {
                // Calculate reward amount with overflow protection
                uint256 rewardAmount = 0;
                if (totalScore != 0 && pool.totalAmount != 0) {
                    // Check for overflow in multiplication
                    if (pool.totalAmount <= type(uint256).max / actorScores[i]) {
                        rewardAmount = (pool.totalAmount * actorScores[i]) / totalScore;
                    } else {
                        // Use safer calculation to avoid overflow
                        rewardAmount = pool.totalAmount / totalScore * actorScores[i];
                    }
                }
                
                // Apply maximum reward limit with overflow protection
                uint256 maxReward = 0;
                if (pool.totalAmount <= type(uint256).max / pool.maxRewardPerActor) {
                    maxReward = (pool.totalAmount * pool.maxRewardPerActor) / 100;
                } else {
                    maxReward = pool.totalAmount / 100 * pool.maxRewardPerActor;
                }
                if (rewardAmount > maxReward) {
                    rewardAmount = maxReward;
                }

                if (rewardAmount != 0) {
                    pool.actorRewards[actors[i]] = rewardAmount;
                    pool.participants.push(actors[i]);
                    
                    // Check for overflow before adding to actor total rewards
                    if (actorTotalRewards[actors[i]][pool.campaignId] <= type(uint256).max - rewardAmount) {
                        actorTotalRewards[actors[i]][pool.campaignId] += rewardAmount;
                    }
                    
                    // Check for overflow before adding to total distributed
                    if (totalDistributed <= type(uint256).max - rewardAmount) {
                        totalDistributed += rewardAmount;
                    }
                }
            }
            
            if (i < type(uint256).max) {
                i++;
            } else {
                break;
            }
        }
        
        pool.distributedAmount = totalDistributed;
        
        emit RewardsCalculated(poolId, validParticipants, totalDistributed, pool.method);
    }

    /**
     * @notice Calculate Austrian Economics score for an actor
     * @param poolId The reward pool ID
     * @param campaignId The campaign ID
     * @param actor The actor address
     * @return uint256 The calculated Austrian Economics score
     */
    function _calculateAustrianScore(
        uint256 poolId,
        uint256 campaignId,
        address actor
    ) private view returns (uint256) {
        RewardPool storage pool = rewardPools[poolId];
        
        // Get actor behavior from Austrian Analytics
        (
            ,
            uint256 totalActions,
            uint256 totalValue,
            uint256 firstActionTime,
            uint256 lastActionTime,
            uint256 praxeologicalScore,
            uint256 catallacticContribution,
            uint256 subjectiveValueIndex,
            uint256 marketCoordinationScore,
            bool isActive
        ) = AUSTRIAN_ANALYTICS.getCampaignActorBehavior(campaignId, actor);
        
        if (!isActive || totalActions < MIN_PARTICIPATION_THRESHOLD) {
            return 0;
        }
        uint256 score = 0;
        
        if (pool.method == CalculationMethod.PRAXEOLOGICAL_SCORE) {
            score = _calculatePraxeologicalReward(praxeologicalScore, totalActions, totalValue);
        } else if (pool.method == CalculationMethod.CATALLAXY_CONTRIBUTION) {
            score = _calculateCatallacticReward(catallacticContribution, marketCoordinationScore);
        } else if (pool.method == CalculationMethod.SUBJECTIVE_VALUE) {
            score = _calculateSubjectiveValueReward(subjectiveValueIndex, totalValue);
        } else if (pool.method == CalculationMethod.TEMPORAL_PREFERENCE) {
            score = _calculateTemporalReward(poolId, firstActionTime, lastActionTime, totalActions);
        } else if (pool.method == CalculationMethod.ENTREPRENEURIAL_ACTION) {
            score = _calculateEntrepreneurialReward(campaignId, actor);
        } else if (pool.method == CalculationMethod.MARKET_COORDINATION) {
            score = _calculateMarketProcessReward(poolId, marketCoordinationScore, totalActions);
        } else if (pool.method == CalculationMethod.COMPOSITE_AUSTRIAN) {
            score = _calculateCompositeAustrianScore(
                poolId,
                praxeologicalScore,
                catallacticContribution,
                subjectiveValueIndex,
                marketCoordinationScore,
                totalActions,
                totalValue,
                firstActionTime,
                lastActionTime
            );
        } else {
            // Default to marginal utility
            score = _calculateMarginalUtilityReward(totalActions, totalValue);
        }
        
        return score;
    }

    /**
     * @notice Calculate praxeological reward based on purposeful action
     * @param praxeologicalScore The praxeological score
     * @param totalActions Total actions performed
     * @param totalValue Total value created
     * @return uint256 The calculated reward score
     */
    function _calculatePraxeologicalReward(
        uint256 praxeologicalScore,
        uint256 totalActions,
        uint256 totalValue
    ) private view returns (uint256) {
        // Praxeological reward = base score * action efficiency * value creation
        uint256 actionEfficiency = totalActions != 0 ? (totalValue * 100) / totalActions : 0;
        
        // Prevent overflow by checking multiplication bounds
        if (praxeologicalScore > type(uint256).max / actionEfficiency) return 0;
        uint256 intermediate = praxeologicalScore * actionEfficiency;
        
        if (intermediate > type(uint256).max / PRAXEOLOGICAL_BASE_SCORE) return 0;
        return (intermediate * PRAXEOLOGICAL_BASE_SCORE) / 10000;
    }

    /**
     * @notice Calculate catallaxy reward based on market coordination
     * @param catallacticContribution The catallaxy contribution score
     * @param marketCoordinationScore The market coordination score
     * @return uint256 The calculated reward score
     */
    function _calculateCatallacticReward(
        uint256 catallacticContribution,
        uint256 marketCoordinationScore
    ) private view returns (uint256) {
        // Catallaxy reward = contribution * coordination * base score
        
        // Prevent overflow by checking multiplication bounds
        if (catallacticContribution > type(uint256).max / marketCoordinationScore) return 0;
        uint256 intermediate = catallacticContribution * marketCoordinationScore;
        
        if (intermediate > type(uint256).max / CATALLAXY_BASE_SCORE) return 0;
        return (intermediate * CATALLAXY_BASE_SCORE) / 10000;
    }

    /**
     * @notice Calculate subjective value reward
     * @param subjectiveValueIndex The subjective value index
     * @param totalValue Total value created
     * @return uint256 The calculated reward score
     */
    function _calculateSubjectiveValueReward(
        uint256 subjectiveValueIndex,
        uint256 totalValue
    ) private view returns (uint256) {
        // Subjective value reward = index * value * base
        
        // Prevent overflow by checking multiplication bounds
        if (subjectiveValueIndex > type(uint256).max / totalValue) return 0;
        uint256 intermediate = subjectiveValueIndex * totalValue;
        
        if (intermediate > type(uint256).max / SUBJECTIVE_VALUE_BASE) return 0;
        return (intermediate * SUBJECTIVE_VALUE_BASE) / 10000;
    }

    /**
     * @notice Calculate temporal reward based on time preference
     * @param poolId The pool ID
     * @param firstActionTime First action timestamp
     * @param lastActionTime Last action timestamp
     * @param totalActions Total actions performed
     * @return uint256 The calculated reward score
     */
    function _calculateTemporalReward(
        uint256 poolId,
        uint256 firstActionTime,
        uint256 lastActionTime,
        uint256 totalActions
    ) private view returns (uint256) {
        TemporalAdjustment storage temporal = temporalAdjustments[poolId];
        RewardPool storage pool = rewardPools[poolId];
        
        uint256 score = TEMPORAL_BASE_FACTOR;
        
        // Graduated early participation bonus based on how early the participation occurs
        if (firstActionTime < pool.startTime + EARLY_PARTICIPATION_WINDOW + 1) {
            // Apply time buffer to prevent manipulation
            uint256 adjustedFirstActionTime = firstActionTime + TIME_BUFFER;
            
            // Calculate how early the participation was (0 = at start, 1 = at end of window)
            uint256 timeIntoWindow = adjustedFirstActionTime > pool.startTime ? 
                adjustedFirstActionTime - pool.startTime : 0;
            
            // Ensure we don't exceed the window
            if (timeIntoWindow > EARLY_PARTICIPATION_WINDOW) {
                timeIntoWindow = EARLY_PARTICIPATION_WINDOW;
            }
            
            uint256 earlynessFactor = EARLY_PARTICIPATION_WINDOW - timeIntoWindow;
            
            // Graduated bonus: earlier participation gets higher bonus
            uint256 graduatedBonus = (temporal.earlyParticipationBonus * earlynessFactor) / EARLY_PARTICIPATION_WINDOW;
            
            if (score <= type(uint256).max - graduatedBonus) {
                score += graduatedBonus;
            } else {
                score = type(uint256).max;
            }
        }
        
        // Consistency bonus (based on action frequency)
        uint256 participationDuration = lastActionTime - firstActionTime;
        if (participationDuration != 0) {
            uint256 consistency = (totalActions * 1 days) / participationDuration;
            uint256 consistencyBonus = 0;
            if (consistency <= type(uint256).max / temporal.consistencyBonus) {
                consistencyBonus = (consistency * temporal.consistencyBonus) / 100;
            }
            if (score <= type(uint256).max - consistencyBonus) {
                score += consistencyBonus;
            } else {
                score = type(uint256).max;
            }
        }
        
        // Long-term commitment bonus with overflow protection
        if (participationDuration > temporal.temporalWindow - 1) {
            if (score <= type(uint256).max - temporal.longTermCommitmentBonus) {
                score += temporal.longTermCommitmentBonus;
            } else {
                score = type(uint256).max;
            }
        }
        
        // Time decay factor
        uint256 started = pool.startTime;
        uint256 timeSinceStart = started > block.timestamp ? 0 : block.timestamp - started;
        if (timeSinceStart > TEMPORAL_DECAY_PERIOD) {
            uint256 decay = (timeSinceStart * temporal.timeDecayFactor) / TEMPORAL_DECAY_PERIOD;
            score = score > decay ? score - decay : 0;
        }
        
        return score;
    }

    /**
     * @notice Calculate entrepreneurial reward based on innovation and discovery
     * @param campaignId The campaign ID
     * @param actor The actor address
     * @return uint256 The calculated reward score
     */
    function _calculateEntrepreneurialReward(
        uint256 campaignId,
        address actor
    ) private view returns (uint256) {
        // Get action counts for entrepreneurial activities
        uint256 valueDiscovery = AUSTRIAN_ANALYTICS.getActorActionCount(
            campaignId,
            actor,
            AustrianAnalytics.ActionType.VALUE_DISCOVERY
        );
        uint256 coordination = AUSTRIAN_ANALYTICS.getActorActionCount(
            campaignId,
            actor,
            AustrianAnalytics.ActionType.COORDINATION
        );
        uint256 innovation = AUSTRIAN_ANALYTICS.getActorActionCount(
            campaignId,
            actor,
            AustrianAnalytics.ActionType.CAMPAIGN_CREATION
        );
        
        // Entrepreneurial score = discovery + coordination + innovation with overflow protection
        uint256 entrepreneurialActions = 0;
        if (valueDiscovery <= type(uint256).max - coordination) {
            entrepreneurialActions = valueDiscovery + coordination;
            if (entrepreneurialActions <= type(uint256).max - innovation) {
                entrepreneurialActions += innovation;
            } else {
                entrepreneurialActions = type(uint256).max;
            }
        } else {
            entrepreneurialActions = type(uint256).max;
        }
        
        // Check for overflow before multiplication
        if (entrepreneurialActions == 0 || ENTREPRENEURIAL_BASE == 0) {
            return 0;
        }
        
        if (entrepreneurialActions <= type(uint256).max / ENTREPRENEURIAL_BASE) {
            return entrepreneurialActions * ENTREPRENEURIAL_BASE;
        } else {
            return type(uint256).max;
        }
    }

    /**
     * @notice Calculate market process reward
     * @param poolId The pool ID
     * @param marketCoordinationScore The market coordination score
     * @param totalActions Total actions performed
     * @return uint256 The calculated reward score
     */
    function _calculateMarketProcessReward(
        uint256 poolId,
        uint256 marketCoordinationScore,
        uint256 totalActions
    ) private view returns (uint256) {
        MarketProcessFactors storage factors = marketProcessFactors[poolId];
        
        uint256 score = 0;
        
        // Calculate base score with overflow protection
        if (marketCoordinationScore <= type(uint256).max / MARKET_PROCESS_BASE) {
            score = marketCoordinationScore * MARKET_PROCESS_BASE;
        } else {
            score = type(uint256).max;
        }
        
        // Apply market process factors with overflow protection
        uint256 discoveryReward = 0;
        if (totalActions <= type(uint256).max / factors.discoveryReward) {
            discoveryReward = (totalActions * factors.discoveryReward) / 100;
        }
        
        uint256 coordinationReward = 0;
        if (marketCoordinationScore <= type(uint256).max / factors.coordinationReward) {
            coordinationReward = (marketCoordinationScore * factors.coordinationReward) / 100;
        }
        
        uint256 liquidityReward = 0;
        if (totalActions <= type(uint256).max / factors.liquidityReward) {
            liquidityReward = (totalActions * factors.liquidityReward) / 100;
        }
        
        // Add rewards with overflow protection
        if (score <= type(uint256).max - discoveryReward) {
            score += discoveryReward;
        } else {
            score = type(uint256).max;
        }
        
        if (score <= type(uint256).max - coordinationReward) {
            score += coordinationReward;
        } else {
            score = type(uint256).max;
        }
        
        if (score <= type(uint256).max - liquidityReward) {
            score += liquidityReward;
        } else {
            score = type(uint256).max;
        }
        
        return score / 100;
    }

    /**
     * @notice Calculate composite Austrian Economics score
     * @param poolId The pool ID
     * @param praxeologicalScore The praxeological score
     * @param catallacticContribution The catallaxy contribution
     * @param subjectiveValueIndex The subjective value index
     * @param marketCoordinationScore The market coordination score
     * @param totalActions Total actions performed
     * @param totalValue Total value created
     * @param firstActionTime First action timestamp
     * @param lastActionTime Last action timestamp
     * @return uint256 The calculated composite score
     */
    function _calculateCompositeAustrianScore(
        uint256 poolId,
        uint256 praxeologicalScore,
        uint256 catallacticContribution,
        uint256 subjectiveValueIndex,
        uint256 marketCoordinationScore,
        uint256 totalActions,
        uint256 totalValue,
        uint256 firstActionTime,
        uint256 lastActionTime
    ) private view returns (uint256) {
        AustrianRewardMetrics storage metrics = rewardMetrics[poolId];
        
        uint256 compositeScore = 0;
        
        // Weighted combination of all Austrian Economics metrics with overflow protection
        uint256 temp;
        
        // Praxeological component
        temp = (praxeologicalScore * metrics.praxeologicalWeight) / 100;
        if (compositeScore > type(uint256).max - temp) return type(uint256).max;
        compositeScore += temp;
        
        // Catallactic component
        temp = (catallacticContribution * metrics.catallacticWeight) / 100;
        if (compositeScore > type(uint256).max - temp) return type(uint256).max;
        compositeScore += temp;
        
        // Subjective value component
        temp = (subjectiveValueIndex * metrics.subjectiveValueWeight) / 100;
        if (compositeScore > type(uint256).max - temp) return type(uint256).max;
        compositeScore += temp;
        
        // Market coordination component
        temp = (marketCoordinationScore * metrics.marketProcessWeight) / 100;
        if (compositeScore > type(uint256).max - temp) return type(uint256).max;
        compositeScore += temp;
        
        // Add temporal component
        uint256 temporalScore = _calculateTemporalReward(poolId, firstActionTime, lastActionTime, totalActions);
        temp = (temporalScore * metrics.temporalWeight) / 100;
        if (compositeScore > type(uint256).max - temp) return type(uint256).max;
        compositeScore += temp;
        
        // Add entrepreneurial component
        if (totalActions > type(uint256).max / ENTREPRENEURIAL_BASE) return type(uint256).max;
        uint256 entrepreneurialScore = totalActions * ENTREPRENEURIAL_BASE;
        temp = (entrepreneurialScore * metrics.entrepreneurialWeight) / 100;
        if (compositeScore > type(uint256).max - temp) return type(uint256).max;
        compositeScore += temp;
        
        // Add voluntary exchange component
        if (totalValue > type(uint256).max / VOLUNTARY_EXCHANGE_BASE) return type(uint256).max;
        uint256 voluntaryScore = ((totalValue / 1 ether) * VOLUNTARY_EXCHANGE_BASE) / 100;
        temp = (voluntaryScore * metrics.voluntaryExchangeWeight) / 100;
        if (compositeScore > type(uint256).max - temp) return type(uint256).max;
        compositeScore += temp;
        
        // Normalize by total weight
        return (compositeScore * 100) / metrics.totalWeight;
    }

    /**
     * @notice Calculate marginal utility reward (fallback method)
     * @param totalActions Total actions performed
     * @param totalValue Total value created
     * @return uint256 The calculated reward score
     */
    function _calculateMarginalUtilityReward(
        uint256 totalActions,
        uint256 totalValue
    ) private pure returns (uint256) {
        // Simple marginal utility calculation
        if (totalActions == 0) return 0;
        
        uint256 averageValue = totalValue / totalActions;
        uint256 marginalUtility = averageValue;
        
        // Apply diminishing marginal utility
        if (totalActions > 10) {
            marginalUtility = (marginalUtility * 100) / (100 + (totalActions - 10) * 5);
        }
        
        // Check for overflow before multiplication
        if (marginalUtility == 0 || totalActions == 0) {
            return 0;
        }
        
        if (marginalUtility <= type(uint256).max / totalActions) {
            return marginalUtility * totalActions;
        } else {
            // Use safer calculation to avoid overflow
            return type(uint256).max;
        }
    }

    /**
     * @notice Initialize default Austrian Economics metrics for a pool
     * @param poolId The pool ID
     */
    function _initializeDefaultMetrics(uint256 poolId) private {
        AustrianRewardMetrics storage metrics = rewardMetrics[poolId];
        
        // Default weights (can be customized later)
        metrics.praxeologicalWeight = 25;      // 25%
        metrics.catallacticWeight = 20;        // 20%
        metrics.subjectiveValueWeight = 15;    // 15%
        metrics.spontaneousOrderWeight = 10;   // 10%
        metrics.entrepreneurialWeight = 10;    // 10%
        metrics.temporalWeight = 10;           // 10%
        metrics.marketProcessWeight = 5;       // 5%
        metrics.voluntaryExchangeWeight = 5;   // 5%
        metrics.totalWeight = 100;             // 100%
        
        // Default temporal adjustments
        TemporalAdjustment storage temporal = temporalAdjustments[poolId];
        temporal.earlyParticipationBonus = 20;     // 20% bonus
        temporal.consistencyBonus = 15;            // 15% bonus
        temporal.longTermCommitmentBonus = 25;     // 25% bonus
        temporal.timeDecayFactor = 10;             // 10% decay
        temporal.temporalWindow = 30 days;         // 30 days
        
        // Default market process factors
        MarketProcessFactors storage factors = marketProcessFactors[poolId];
        factors.discoveryReward = 10;              // 10%
        factors.competitionReward = 8;             // 8%
        factors.innovationReward = 12;             // 12%
        factors.arbitrageReward = 6;               // 6%
        factors.coordinationReward = 15;           // 15%
        factors.informationReward = 7;             // 7%
        factors.liquidityReward = 9;               // 9%
        factors.stabilityReward = 5;               // 5%
    }

    /**
     * @notice Claim rewards for an actor
     * @param poolId The reward pool ID
     */
    function claimReward(uint256 poolId) external nonReentrant {
        if (poolId == 0 || poolId >= nextPoolId) revert ICommonErrors.InvalidPoolId();
        
        RewardPool storage pool = rewardPools[poolId];
        if (block.timestamp < pool.endTime) revert PoolNotEnded();
        if (pool.actorRewards[msg.sender] == 0) revert ICommonErrors.NoRewardAvailable();
        if (pool.hasClaimed[msg.sender]) revert ICommonErrors.RewardAlreadyClaimed();
        
        uint256 rewardAmount = pool.actorRewards[msg.sender];
        pool.hasClaimed[msg.sender] = true;
        
        pool.rewardToken.safeTransfer(msg.sender, rewardAmount);
        
        emit RewardClaimed(poolId, msg.sender, rewardAmount, pool.category);
    }

    /**
     * @notice Finalize a reward pool
     * @param poolId The reward pool ID
     */
    function finalizeRewardPool(uint256 poolId) external onlyGovernance {
        RewardPool storage pool = rewardPools[poolId];
        if (pool.poolId == 0) revert ICommonErrors.PoolNotFound();
        if (pool.isFinalized) revert PoolAlreadyFinalized();
        
        pool.isActive = false;
        pool.isFinalized = true;
        
        // Remove from active pools
        for (uint256 i = 0; i < activePoolIds.length; ++i) {
            if (activePoolIds[i] == poolId) {
                activePoolIds[i] = activePoolIds[activePoolIds.length - 1];
                activePoolIds.pop();
                break;
            }
        }
        
        // Return undistributed tokens
        uint256 undistributed = pool.totalAmount - pool.distributedAmount;
        if (undistributed != 0) {
            uint256 bal = pool.rewardToken.balanceOf(address(this));
            if (bal < undistributed) revert InsufficientPoolBalance();
            pool.rewardToken.safeTransfer(address(governance), undistributed);
        }
        
        emit RewardPoolFinalized(poolId, pool.distributedAmount);
    }

    /**
     * @notice Update Austrian Economics metrics for a pool
     * @param poolId The pool ID
     * @param praxeologicalWeight Weight for praxeological analysis
     * @param catallacticWeight Weight for catallaxy
     * @param subjectiveValueWeight Weight for subjective value
     * @param spontaneousOrderWeight Weight for spontaneous order
     * @param entrepreneurialWeight Weight for entrepreneurial action
     * @param temporalWeight Weight for temporal coordination
     * @param marketProcessWeight Weight for market process
     * @param voluntaryExchangeWeight Weight for voluntary exchange
     */
    function updateAustrianMetrics(
        uint256 poolId,
        uint256 praxeologicalWeight,
        uint256 catallacticWeight,
        uint256 subjectiveValueWeight,
        uint256 spontaneousOrderWeight,
        uint256 entrepreneurialWeight,
        uint256 temporalWeight,
        uint256 marketProcessWeight,
        uint256 voluntaryExchangeWeight
    ) external onlyGovernance {
        uint256 totalWeight = praxeologicalWeight + catallacticWeight + subjectiveValueWeight +
                             spontaneousOrderWeight + entrepreneurialWeight + temporalWeight +
                             marketProcessWeight + voluntaryExchangeWeight;
        
        if (totalWeight != 100) revert InvalidRewardMetrics();
        
        AustrianRewardMetrics storage metrics = rewardMetrics[poolId];
        metrics.praxeologicalWeight = uint128(praxeologicalWeight);
        metrics.catallacticWeight = uint128(catallacticWeight);
        metrics.subjectiveValueWeight = uint128(subjectiveValueWeight);
        metrics.spontaneousOrderWeight = uint128(spontaneousOrderWeight);
        metrics.entrepreneurialWeight = uint128(entrepreneurialWeight);
        metrics.temporalWeight = uint128(temporalWeight);
        metrics.marketProcessWeight = uint128(marketProcessWeight);
        metrics.voluntaryExchangeWeight = uint128(voluntaryExchangeWeight);
        metrics.totalWeight = totalWeight;
        
        emit AustrianMetricsUpdated(poolId, praxeologicalWeight, catallacticWeight, subjectiveValueWeight);
    }

    /**
     * @notice Update temporal adjustments for a pool
     * @param poolId The pool ID
     * @param earlyParticipationBonus Early participation bonus percentage
     * @param consistencyBonus Consistency bonus percentage
     * @param longTermCommitmentBonus Long-term commitment bonus percentage
     * @param timeDecayFactor Time decay factor percentage
     * @param temporalWindow Temporal analysis window
     */
    function updateTemporalAdjustments(
        uint256 poolId,
        uint256 earlyParticipationBonus,
        uint256 consistencyBonus,
        uint256 longTermCommitmentBonus,
        uint256 timeDecayFactor,
        uint256 temporalWindow
    ) external onlyGovernance {
        if (earlyParticipationBonus > 100 || consistencyBonus > 100 || 
            longTermCommitmentBonus > 100 || timeDecayFactor > 100) {
            revert InvalidTemporalAdjustment();
        }
        
        TemporalAdjustment storage temporal = temporalAdjustments[poolId];
        temporal.earlyParticipationBonus = uint128(earlyParticipationBonus);
        temporal.consistencyBonus = uint128(consistencyBonus);
        temporal.longTermCommitmentBonus = uint128(longTermCommitmentBonus);
        temporal.timeDecayFactor = uint128(timeDecayFactor);
        temporal.temporalWindow = uint128(temporalWindow);
    }

    /**
     * @notice Update market process factors for a pool
     * @param poolId The pool ID
     * @param discoveryReward Discovery reward percentage
     * @param competitionReward Competition reward percentage
     * @param innovationReward Innovation reward percentage
     * @param arbitrageReward Arbitrage reward percentage
     * @param coordinationReward Coordination reward percentage
     * @param informationReward Information reward percentage
     * @param liquidityReward Liquidity reward percentage
     * @param stabilityReward Stability reward percentage
     */
    function updateMarketProcessFactors(
        uint256 poolId,
        uint256 discoveryReward,
        uint256 competitionReward,
        uint256 innovationReward,
        uint256 arbitrageReward,
        uint256 coordinationReward,
        uint256 informationReward,
        uint256 liquidityReward,
        uint256 stabilityReward
    ) external onlyGovernance {
        uint256 totalFactors = discoveryReward + competitionReward + innovationReward +
                              arbitrageReward + coordinationReward + informationReward +
                              liquidityReward + stabilityReward;
        
        if (totalFactors > 200) revert InvalidMarketProcessFactors(); // Max 200% total
        
        MarketProcessFactors storage factors = marketProcessFactors[poolId];
        factors.discoveryReward = uint128(discoveryReward);
        factors.competitionReward = uint128(competitionReward);
        factors.innovationReward = uint128(innovationReward);
        factors.arbitrageReward = uint128(arbitrageReward);
        factors.coordinationReward = uint128(coordinationReward);
        factors.informationReward = uint128(informationReward);
        factors.liquidityReward = uint128(liquidityReward);
        factors.stabilityReward = uint128(stabilityReward);
    }

    // View functions

    /**
     * @notice Get reward pool information
     * @param poolId The pool ID
     * @return poolId The unique identifier of the reward pool
     * @return campaignId The associated campaign identifier
     * @return rewardToken The address of the reward token contract
     * @return totalAmount The total amount of rewards in the pool
     * @return distributedAmount The amount of rewards already distributed
     * @return startTime The timestamp when the pool becomes active
     * @return endTime The timestamp when the pool ends
     * @return category The reward category (PRAXEOLOGICAL, ENTREPRENEURIAL, etc.)
     * @return method The calculation method (PROPORTIONAL, THRESHOLD, etc.)
     * @return minParticipationScore The minimum score required to participate
     * @return maxRewardPerActor The maximum reward amount per actor
     * @return isActive Whether the pool is currently active
     * @return isFinalized Whether the pool has been finalized
     */
    function getRewardPoolInfo(uint256 poolId) external view returns (
        uint256,
        uint256,
        address,
        uint256,
        uint256,
        uint256,
        uint256,
        RewardCategory,
        CalculationMethod,
        uint256,
        uint256,
        bool,
        bool
    ) {
        RewardPool storage pool = rewardPools[poolId];
        return (
            pool.poolId,
            pool.campaignId,
            address(pool.rewardToken),
            pool.totalAmount,
            pool.distributedAmount,
            pool.startTime,
            pool.endTime,
            pool.category,
            pool.method,
            pool.minParticipationScore,
            pool.maxRewardPerActor,
            pool.isActive,
            pool.isFinalized
        );
    }

    /**
     * @notice Get actor reward amount for a pool
     * @param poolId The pool ID
     * @param actor The actor address
     * @return uint256 The reward amount
     */
    function getActorReward(uint256 poolId, address actor) external view returns (uint256) {
        return rewardPools[poolId].actorRewards[actor];
    }

    /**
     * @notice Check if actor has claimed reward
     * @param poolId The pool ID
     * @param actor The actor address
     * @return bool Whether the reward has been claimed
     */
    function hasClaimedReward(uint256 poolId, address actor) external view returns (bool) {
        return rewardPools[poolId].hasClaimed[actor];
    }

    /**
     * @notice Get pool participants
     * @param poolId The pool ID
     * @return address[] The list of participants
     */
    function getPoolParticipants(uint256 poolId) external view returns (address[] memory) {
        return rewardPools[poolId].participants;
    }

    /**
     * @notice Get campaign reward pools
     * @param campaignId The campaign ID
     * @return uint256[] The list of reward pool IDs
     */
    function getCampaignRewardPools(uint256 campaignId) external view returns (uint256[] memory) {
        return campaignRewardPools[campaignId];
    }

    /**
     * @notice Get active reward pools
     * @return uint256[] The list of active pool IDs
     */
    function getActiveRewardPools() external view returns (uint256[] memory) {
        return activePoolIds;
    }

    /**
     * @notice Get Austrian Economics metrics for a pool
     * @param poolId The pool ID
     * @return AustrianRewardMetrics The metrics
     */
    function getAustrianMetrics(uint256 poolId) external view returns (AustrianRewardMetrics memory) {
        return rewardMetrics[poolId];
    }

    /**
     * @notice Get temporal adjustments for a pool
     * @param poolId The pool ID
     * @return TemporalAdjustment The temporal adjustments
     */
    function getTemporalAdjustments(uint256 poolId) external view returns (TemporalAdjustment memory) {
        return temporalAdjustments[poolId];
    }

    /**
     * @notice Get market process factors for a pool
     * @param poolId The pool ID
     * @return MarketProcessFactors The market process factors
     */
    function getMarketProcessFactors(uint256 poolId) external view returns (MarketProcessFactors memory) {
        return marketProcessFactors[poolId];
    }

    /**
     * @notice Get actor total rewards for a campaign
     * @param actor The actor address
     * @param campaignId The campaign ID
     * @return uint256 The total rewards
     */
    function getActorTotalRewards(address actor, uint256 campaignId) external view returns (uint256) {
        return actorTotalRewards[actor][campaignId];
    }

    /**
     * @notice Emergency withdrawal of ERC20 tokens to the governance contract
     * @dev Rejects zero token or zero amount to avoid pointless transfers
     * @param token The token to withdraw
     * @param amount The amount to withdraw
     */
    function emergencyWithdraw(IERC20 token, uint256 amount) external onlyGovernance {
        if (address(token) == address(0)) revert InvalidAddress();
        if (amount == 0) revert ZeroAmount();
        token.safeTransfer(address(governance), amount);
    }
}

/**
 * @title PraxeologicalRewards DAO Transformation Documentation
 * @notice This contract has been transformed from centralized to decentralized governance
 * 
 * GOVERNANCE TRANSFORMATION:
 * - Removed centralized Ownable control
 * - Implemented IPrivateGovernance interface for DAO control
 * - All admin functions now require governance approval through onlyGovernance modifier
 * 
 * DAO-CONTROLLED FUNCTIONS:
 * - createRewardPool: Create new Austrian Economics-based reward pools
 * - calculateAndDistributeRewards: Calculate and distribute rewards based on praxeological analysis
 * - finalizeRewardPool: Finalize reward pools and complete distribution
 * - updateAustrianMetrics: Update Austrian economic metric weights and calculations
 * - updateTemporalAdjustments: Modify temporal preference and time-based reward factors
 * - updateMarketProcessFactors: Adjust market process and coordination reward factors
 * - emergencyWithdraw: Emergency token withdrawal to governance contract
 * - setGovernance: Update the governance contract address
 * 
 * SECURITY IMPLICATIONS:
 * - Decentralized reward distribution prevents manipulation of Austrian economic incentives
 * - Governance-controlled metric calculations ensure transparent praxeological analysis
 * - Multi-signature governance required for critical reward operations
 * - Transparent and auditable Austrian Economics-based reward mechanisms
 * 
 * AUSTRIAN ECONOMICS REWARD PRINCIPLES:
 * - Praxeological Action: Rewards for purposeful human action in crowdfunding
 * - Catallaxy Coordination: Incentives for spontaneous market coordination
 * - Subjective Value Creation: Rewards based on individual value creation
 * - Spontaneous Order: Incentives for emergent order contribution
 * - Entrepreneurial Discovery: Rewards for innovation and market discovery
 * - Temporal Coordination: Time preference optimization incentives
 * - Market Process: Rewards for market mechanism participation
 * - Voluntary Exchange: Incentives for voluntary association and cooperation
 * 
 * REWARD CALCULATION METHODS:
 * - Marginal Utility: Based on marginal utility theory
 * - Subjective Value: Based on subjective value theory
 * - Praxeological Score: Based on praxeological analysis
 * - Catallaxy Contribution: Based on catallaxy metrics
 * - Market Coordination: Based on market coordination effectiveness
 * - Temporal Preference: Based on time preference analysis
 * - Entrepreneurial Action: Based on entrepreneurial metrics and innovation
 */
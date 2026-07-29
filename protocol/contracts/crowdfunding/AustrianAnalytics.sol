// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "./../interfaces/ICommonErrors.sol";
import "./../interfaces/IPrivateGovernance.sol";
import {GovernanceAccessLib} from "../libraries/GovernanceAccessLib.sol";

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/**
 * @title AustrianAnalytics
 * @author Aegis Protocol Team
 * @dev Praxeological Analytics & Catallaxy-Based Insights implementing Austrian Economics principles:
 *      - Praxeology: Analysis of human action and purposeful behavior in crowdfunding
 *      - Catallaxy: Spontaneous order emergence in decentralized funding markets
 *      - Methodological Individualism: Individual actor behavior analysis
 *      - Subjective Value Theory: Personal valuation and preference revelation
 *      - Market Process: Dynamic coordination and discovery mechanisms
 *      - Decentralized Governance: DAO-controlled analytics and parameter management
 */
contract AustrianAnalytics is ReentrancyGuard , ICommonErrors{

    /// @notice Praxeological action categories
    enum ActionType {
        CONTRIBUTION,       // Contributing to campaigns
        MILESTONE_REVIEW,   // Reviewing milestones
        REFUND_REQUEST,     // Requesting refunds
        CAMPAIGN_CREATION,  // Creating campaigns
        REPUTATION_UPDATE,  // Reputation changes
        MARKET_SIGNAL,      // Market signaling actions
        COORDINATION,       // Coordination activities
        VALUE_DISCOVERY     // Value discovery actions
    }

    /// @notice Individual actor behavior analysis
    struct ActorBehavior {
        address actor;                          // Actor address
        bool isActive;                          // Whether actor is currently active
        mapping(ActionType => uint256) actionCounts; // Action frequency by type
        mapping(ActionType => uint256) actionValues; // Total value by action type
        mapping(ActionType => uint256) lastActionTime; // Last action timestamp by type
        uint256 totalActions;                   // Total actions performed
        uint256 totalValue;                     // Total value transacted
        uint256 firstActionTime;                // First action timestamp
        uint256 lastOverallActionTime;          // Last overall action timestamp
        uint256 praxeologicalScore;             // Purposeful behavior score
        uint256 catallacticContribution;        // Contribution to spontaneous order
        uint256 subjectiveValueIndex;           // Personal value preference index
        uint256 marketCoordinationScore;        // Market coordination effectiveness
    }

    /// @notice Market catallaxy metrics
    struct CatallacticMetrics {
        uint256 spontaneousOrderIndex;          // Measure of emergent order
        uint256 coordinationEfficiency;         // Market coordination effectiveness
        uint256 informationTransmission;       // Information flow efficiency
        uint256 priceDiscoveryMechanism;       // Price/value discovery effectiveness
        uint256 marketDepth;                   // Market participation depth
        uint256 liquidityCoordination;         // Liquidity coordination measure
        uint256 voluntaryExchangeIndex;        // Voluntary exchange prevalence
        uint256 competitiveDiscovery;          // Competitive discovery process
        uint256 entrepreneurialAction;         // Entrepreneurial activity measure
        uint256 temporalCoordination;          // Intertemporal coordination
    }

    /// @notice Praxeological analysis data
    struct PraxeologicalAnalysis {
        uint256 purposefulActionIndex;          // Measure of purposeful behavior
        uint256 meansEndsRationality;          // Means-ends rational behavior
        uint256 timePreferenceAnalysis;        // Time preference patterns
        uint256 marginalUtilityPatterns;       // Marginal utility behavior
        uint256 actionHierarchy;               // Action priority hierarchy
        uint256 uncertaintyHandling;           // Uncertainty management
        uint256 knowledgeUtilization;          // Knowledge use efficiency
        uint256 planCoordination;              // Plan coordination effectiveness
        uint256 adaptiveBehavior;              // Adaptive behavior measure
        uint256 individualSovereignty;         // Individual sovereignty index
    }

    /// @notice Market process dynamics
    struct MarketProcessDynamics {
        uint256 discoveryMechanism;            // Discovery process effectiveness
        uint256 competitiveProcess;            // Competitive process strength
        uint256 entrepreneurialAlertness;      // Entrepreneurial alertness level
        uint256 arbitrageOpportunities;        // Arbitrage opportunity identification
        uint256 innovationIncentives;          // Innovation incentive strength
        uint256 resourceAllocation;            // Resource allocation efficiency
        uint256 signalTransmission;            // Signal transmission clarity
        uint256 feedbackMechanisms;            // Feedback mechanism effectiveness
        uint256 adaptationSpeed;               // Market adaptation speed
        uint256 equilibrationTendency;         // Equilibration tendency strength
    }

    /// @notice Campaign analytics data
    struct CampaignAnalytics {
        uint256 campaignId;                     // Campaign identifier
        CatallacticMetrics catallaxy;           // Catallaxy metrics
        PraxeologicalAnalysis praxeology;      // Praxeological analysis
        MarketProcessDynamics marketProcess;    // Market process dynamics
        mapping(address => ActorBehavior) actors; // Individual actor behaviors
        address[] actorList;                    // List of actors
        uint256 totalActors;                    // Total number of actors
        uint256 activeActors;                   // Currently active actors
        uint256 analysisStartTime;              // Analysis start timestamp
        uint256 lastUpdateTime;                 // Last update timestamp
        bool isActive;                          // Whether analysis is active
    }

    /// @notice Global Austrian Economics metrics
    struct GlobalAustrianMetrics {
        uint256 overallSpontaneousOrder;       // Global spontaneous order
        uint256 systemWideCatallaxy;           // System-wide catallaxy
        uint256 aggregatePraxeology;           // Aggregate praxeological behavior
        uint256 marketProcessEfficiency;       // Overall market process efficiency
        uint256 individualismIndex;            // Methodological individualism index
        uint256 subjectiveValuePrevalence;     // Subjective value theory prevalence
        uint256 voluntaryAssociationIndex;     // Voluntary association index
        uint256 soundMoneyMetrics;             // Sound money principle adherence
        uint256 austrianComplianceScore;       // Overall Austrian compliance
        uint256 lastCalculationTime;           // Last calculation timestamp
    }

    /// @notice Mapping of campaign ID to analytics
    mapping(uint256 => CampaignAnalytics) public campaignAnalytics;

    /// @notice Mapping of actor to global behavior
    mapping(address => ActorBehavior) public globalActorBehavior;

    /// @notice Global Austrian Economics metrics
    GlobalAustrianMetrics public globalMetrics;

    /// @notice Active campaigns being analyzed
    uint256[] public activeCampaigns;

    /// @notice Actor addresses for global analysis
    address[] public globalActors;

    /// @notice DAO governance contract
    IPrivateGovernance public governance;

    address public timelockController;

    event TimelockControllerUpdated(address indexed previousTimelock, address indexed newTimelock);

    /// @notice Governance updated rolling analytics thresholds
    event AnalysisConfigUpdated(
        uint256 analysisUpdateInterval,
        uint256 actorActivityThreshold,
        uint256 minActionsForAnalysis,
        uint256 timestamp
    );

    /// @notice Minimum interval between heavy global metric recalculations (governance-configurable)
    uint256 public analysisUpdateInterval;
    /// @notice Time window for treating an actor as active (governance-configurable)
    uint256 public actorActivityThreshold;
    /// @notice Minimum recorded actions before certain scores are emitted (governance-configurable)
    uint256 public minActionsForAnalysis;
    /// @notice Weight factor for praxeological scoring in composite metrics
    uint256 public constant PRAXEOLOGICAL_WEIGHT = 30;
    /// @notice Weight factor for catallactic scoring in composite metrics
    uint256 public constant CATALLACTIC_WEIGHT = 40;
    /// @notice Weight factor for market process scoring in composite metrics
    uint256 public constant MARKET_PROCESS_WEIGHT = 30;

    /// @notice Events
    /// @notice Emitted when campaign analysis is initiated
    /// @param campaignId The ID of the campaign being analyzed
    /// @param timestamp The timestamp when analysis started
    event CampaignAnalysisStarted(
        uint256 indexed campaignId,
        uint256 indexed timestamp
    );

    /// @notice Emitted when actor behavior data is updated
    /// @param campaignId The ID of the campaign
    /// @param actor The address of the actor
    /// @param actionType The type of action performed
    /// @param value The value associated with the action
    /// @param timestamp The timestamp of the update
    event ActorBehaviorUpdated(
        uint256 indexed campaignId,
        address indexed actor,
        ActionType indexed actionType,
        uint256 value,
        uint256 timestamp
    );

    /// @notice Emitted when catallactic metrics are updated
    /// @param campaignId The ID of the campaign
    /// @param metrics The updated catallactic metrics
    /// @param timestamp The timestamp of the update
    event CatallacticMetricsUpdated(
        uint256 indexed campaignId,
        CatallacticMetrics metrics,
        uint256 timestamp
    );

    /// @notice Emitted when praxeological analysis is updated
    /// @param campaignId The ID of the campaign
    /// @param analysis The updated praxeological analysis
    /// @param timestamp The timestamp of the update
    event PraxeologicalAnalysisUpdated(
        uint256 indexed campaignId,
        PraxeologicalAnalysis analysis,
        uint256 timestamp
    );

    /// @notice Emitted when market process dynamics are updated
    /// @param campaignId The ID of the campaign
    /// @param dynamics The updated market process dynamics
    /// @param timestamp The timestamp of the update
    event MarketProcessUpdated(
        uint256 indexed campaignId,
        MarketProcessDynamics dynamics,
        uint256 timestamp
    );

    /// @notice Emitted when global Austrian metrics are calculated
    /// @param metrics The calculated global metrics
    /// @param timestamp The timestamp of the calculation
    event GlobalMetricsCalculated(
        GlobalAustrianMetrics metrics,
        uint256 timestamp
    );

    /// @notice Emitted when Austrian economic insight is generated
    /// @param campaignId The ID of the campaign
    /// @param insight The generated insight text
    /// @param confidence The confidence level of the insight
    /// @param timestamp The timestamp of insight generation
    event AustrianInsightGenerated(
        uint256 indexed campaignId,
        string insight,
        uint256 indexed confidence,
        uint256 indexed timestamp
    );

    /// @notice Event emitted when governance is updated
    event GovernanceUpdated(address indexed oldGovernance, address indexed newGovernance);

    /// @notice Custom errors
    error CampaignNotFound();
    error AnalysisNotActive();
    error InsufficientData();
    error UpdateTooFrequent();
    error InvalidActionType();
    error ActorNotFound();
    
    error UpdateIntervalTooShort();
    error ActivityThresholdTooShort();
    error MinActionsTooLow();

    /// @notice Initializes the Austrian Analytics contract with governance control
    /// @param _governance Address of the governance contract
    constructor(address _governance) {
        if (_governance == address(0)) revert InvalidAddress();
        governance = IPrivateGovernance(_governance);
        globalMetrics = GlobalAustrianMetrics(0, 0, 0, 0, 0, 0, 0, 0, 0, block.timestamp);
        analysisUpdateInterval = 1 hours;
        actorActivityThreshold = 7 days;
        minActionsForAnalysis = 3;
    }

    /// @notice Modifier to restrict access to governance only
    modifier onlyGovernance() {
        if (!GovernanceAccessLib.isGovernanceTimelockOrCore(address(governance), timelockController, msg.sender)) {
            revert UnauthorizedAccess();
        }
        _;
    }

    function setTimelockController(address newTimelock) external onlyGovernance {
        emit TimelockControllerUpdated(timelockController, newTimelock);
        timelockController = newTimelock;
    }

    /// @notice Update the governance contract
    /// @param _newGovernance Address of the new governance contract
    function setGovernance(address _newGovernance) external onlyGovernance {
        if (_newGovernance == address(0)) revert InvalidAddress();
        address oldGovernance = address(governance);
        governance = IPrivateGovernance(_newGovernance);
        emit GovernanceUpdated(oldGovernance, _newGovernance);
    }

    /**
     * @notice Start analytics for a campaign
     * @param campaignId The campaign ID to analyze
     */
    function startCampaignAnalysis(uint256 campaignId) external onlyGovernance {
        CampaignAnalytics storage analytics = campaignAnalytics[campaignId];
        
        if (analytics.isActive) return; // Already active
        
        analytics.campaignId = campaignId;
        analytics.analysisStartTime = block.timestamp;
        analytics.lastUpdateTime = block.timestamp;
        analytics.isActive = true;
        
        // Initialize metrics
        analytics.catallaxy = CatallacticMetrics(0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
        analytics.praxeology = PraxeologicalAnalysis(0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
        analytics.marketProcess = MarketProcessDynamics(0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
        
        activeCampaigns.push(campaignId);
        
        emit CampaignAnalysisStarted(campaignId, block.timestamp);
    }

    /**
     * @notice Record an actor's action for analysis
     * @param campaignId The campaign ID
     * @param actor The actor address
     * @param actionType The type of action performed
     * @param value The value associated with the action
     */
    function recordAction(
        uint256 campaignId,
        address actor,
        ActionType actionType,
        uint256 value
    ) external {
        CampaignAnalytics storage analytics = campaignAnalytics[campaignId];
        if (!analytics.isActive) revert AnalysisNotActive();
        
        // Update campaign-specific actor behavior
        ActorBehavior storage campaignActor = analytics.actors[actor];
        _updateActorBehavior(campaignActor, actor, actionType, value);
        
        // Add to actor list if new
        if (campaignActor.totalActions == 1) {
            analytics.actorList.push(actor);
            ++analytics.totalActors;
        }
        
        // Update global actor behavior
        ActorBehavior storage globalActor = globalActorBehavior[actor];
        _updateActorBehavior(globalActor, actor, actionType, value);
        
        // Add to global actor list if new
        if (globalActor.totalActions == 1) {
            globalActors.push(actor);
        }
        
        // Update analytics metrics
        _updateCampaignMetrics(campaignId);
        
        emit ActorBehaviorUpdated(campaignId, actor, actionType, value, block.timestamp);
    }

    /**
     * @notice Update actor behavior data
     * @param actorBehavior The actor behavior struct to update
     * @param actor The actor address
     * @param actionType The action type
     * @param value The action value
     */
    function _updateActorBehavior(
        ActorBehavior storage actorBehavior,
        address actor,
        ActionType actionType,
        uint256 value
    ) private {
        if (actorBehavior.actor == address(0)) {
            actorBehavior.actor = actor;
            actorBehavior.firstActionTime = block.timestamp;
        }
        
        ++actorBehavior.actionCounts[actionType];
        
        // Add overflow protection for actionValues
        if (actorBehavior.actionValues[actionType] > type(uint256).max - value) {
            actorBehavior.actionValues[actionType] = type(uint256).max;
        } else {
            actorBehavior.actionValues[actionType] += value;
        }
        
        actorBehavior.lastActionTime[actionType] = block.timestamp;
        ++actorBehavior.totalActions;
        
        // Add overflow protection for totalValue
        if (actorBehavior.totalValue > type(uint256).max - value) {
            actorBehavior.totalValue = type(uint256).max;
        } else {
            actorBehavior.totalValue += value;
        }
        
        uint256 previousOverallActionTime = actorBehavior.lastOverallActionTime;
        actorBehavior.lastOverallActionTime = block.timestamp;
        
        // Active if first recorded action or last gap within threshold (compare *before* overwrite)
        actorBehavior.isActive = previousOverallActionTime == 0
            || (previousOverallActionTime <= block.timestamp
                && block.timestamp - previousOverallActionTime <= actorActivityThreshold);
        
        // Calculate praxeological score
        actorBehavior.praxeologicalScore = _calculatePraxeologicalScore(actorBehavior);
        
        // Calculate catallactic contribution
        actorBehavior.catallacticContribution = _calculateCatallacticContribution(actorBehavior);
        
        // Calculate subjective value index
        actorBehavior.subjectiveValueIndex = _calculateSubjectiveValueIndex(actorBehavior);
        
        // Calculate market coordination score
        actorBehavior.marketCoordinationScore = _calculateMarketCoordinationScore(actorBehavior);
    }

    /**
     * @notice Calculate praxeological score for an actor
     * @param actorBehavior The actor behavior data
     * @return uint256 The praxeological score
     */
    function _calculatePraxeologicalScore(ActorBehavior storage actorBehavior) private view returns (uint256) {
        if (actorBehavior.totalActions < minActionsForAnalysis) return 0;
        
        uint256 score = 0;
        
        // Purposeful action consistency
        uint256 actionDiversity = 0;
        for (uint256 i = 0; i < 8; ++i) {
            if (actorBehavior.actionCounts[ActionType(i)] > 0) {
                ++actionDiversity;
            }
        }
        score += actionDiversity * 10;
        
        // Means-ends rationality (value per action)
        uint256 valueEfficiency = actorBehavior.totalValue / actorBehavior.totalActions;
        score += Math.min(valueEfficiency / 1000, 30);
        
        // Time preference (action frequency)
        uint256 firstAction = actorBehavior.firstActionTime;
        uint256 timeSpan = firstAction > block.timestamp ? 0 : block.timestamp - firstAction;
        if (timeSpan > 0) {
            uint256 actionFrequency = (actorBehavior.totalActions * 86400) / timeSpan; // Actions per day
            score += Math.min(actionFrequency * 5, 25);
        }
        
        // Consistency in behavior
        uint256 consistencyScore = _calculateBehaviorConsistency(actorBehavior);
        score += consistencyScore;
        
        return Math.min(score, 100);
    }

    /**
     * @notice Calculate catallactic contribution for an actor
     * @param actorBehavior The actor behavior data
     * @return uint256 The catallactic contribution score
     */
    function _calculateCatallacticContribution(ActorBehavior storage actorBehavior) private view returns (uint256) {
        if (actorBehavior.totalActions < minActionsForAnalysis) return 0;
        
        uint256 score = 0;
        
        // Coordination activities
        score += actorBehavior.actionCounts[ActionType.COORDINATION] * 15;
        
        // Market signaling
        score += actorBehavior.actionCounts[ActionType.MARKET_SIGNAL] * 12;
        
        // Value discovery
        score += actorBehavior.actionCounts[ActionType.VALUE_DISCOVERY] * 18;
        
        // Contribution to spontaneous order
        score += actorBehavior.actionCounts[ActionType.CONTRIBUTION] * 8;
        
        // Milestone reviews (information provision)
        score += actorBehavior.actionCounts[ActionType.MILESTONE_REVIEW] * 10;
        
        return Math.min(score, 100);
    }

    /**
     * @notice Calculate subjective value index for an actor
     * @param actorBehavior The actor behavior data
     * @return uint256 The subjective value index
     */
    function _calculateSubjectiveValueIndex(ActorBehavior storage actorBehavior) private view returns (uint256) {
        if (actorBehavior.totalActions < minActionsForAnalysis) return 0;
        
        uint256 score = 0;
        
        // Value variance across actions
        uint256 totalVariance = 0;
        uint256 avgValue = actorBehavior.totalValue / actorBehavior.totalActions;
        
        for (uint256 i = 0; i < 8; ++i) {
            ActionType actionType = ActionType(i);
            if (actorBehavior.actionCounts[actionType] > 0) {
                uint256 actionAvgValue = actorBehavior.actionValues[actionType] / 
                    actorBehavior.actionCounts[actionType];
                uint256 variance = actionAvgValue > avgValue ? actionAvgValue - avgValue : avgValue - actionAvgValue;
                totalVariance += variance;
            }
        }
        
        // Higher variance indicates more subjective valuation
        score += Math.min(totalVariance / 1000, 40);
        
        // Personal preference revelation through action patterns
        uint256 preferenceScore = _calculatePreferenceRevelation(actorBehavior);
        score += preferenceScore;
        
        return Math.min(score, 100);
    }

    /**
     * @notice Calculate market coordination score for an actor
     * @param actorBehavior The actor behavior data
     * @return uint256 The market coordination score
     */
    function _calculateMarketCoordinationScore(ActorBehavior storage actorBehavior) private view returns (uint256) {
        if (actorBehavior.totalActions < minActionsForAnalysis) return 0;
        
        uint256 score = 0;
        
        // Coordination effectiveness
        score += actorBehavior.actionCounts[ActionType.COORDINATION] * 20;
        
        // Market participation breadth
        uint256 participationBreadth = 0;
        for (uint256 i = 0; i < 8; ++i) {
            if (actorBehavior.actionCounts[ActionType(i)] > 0) {
                ++participationBreadth;
            }
        }
        score += participationBreadth * 8;
        
        // Temporal coordination (consistent activity)
        uint256 firstActionCoord = actorBehavior.firstActionTime;
        uint256 timeSpan = firstActionCoord > block.timestamp ? 0 : block.timestamp - firstActionCoord;
        if (timeSpan > 0) {
            uint256 consistency = (actorBehavior.totalActions * 86400) / timeSpan;
            score += Math.min(consistency * 3, 20);
        }
        
        return Math.min(score, 100);
    }

    /**
     * @notice Calculate behavior consistency
     * @param actorBehavior The actor behavior data
     * @return uint256 The consistency score
     */
    function _calculateBehaviorConsistency(ActorBehavior storage actorBehavior) private view returns (uint256) {
        uint256 consistencyScore = 0;
        uint256 actionTypes = 0;
        
        for (uint256 i = 0; i < 8; ++i) {
            if (actorBehavior.actionCounts[ActionType(i)] > 0) {
                ++actionTypes;
                
                // Check temporal consistency (no underflow if lastAction is corrupt/future)
                uint256 lastAction = actorBehavior.lastActionTime[ActionType(i)];
                if (
                    lastAction != 0 &&
                    lastAction <= block.timestamp &&
                    block.timestamp - lastAction <= actorActivityThreshold
                ) {
                    consistencyScore += 3;
                }
            }
        }
        
        // Bonus for diverse but consistent behavior
        if (actionTypes >= 3) {
            consistencyScore += 10;
        }
        
        return Math.min(consistencyScore, 25);
    }

    /**
     * @notice Calculate preference revelation score
     * @param actorBehavior The actor behavior data
     * @return uint256 The preference revelation score
     */
    function _calculatePreferenceRevelation(ActorBehavior storage actorBehavior) private view returns (uint256) {
        uint256 score = 0;
        
        // Preference for certain action types
        uint256 maxActions = 0;
        for (uint256 i = 0; i < 8; ++i) {
            if (actorBehavior.actionCounts[ActionType(i)] > maxActions) {
                maxActions = actorBehavior.actionCounts[ActionType(i)];
            }
        }
        
        // Strong preference indication
        if (maxActions > actorBehavior.totalActions / 2) {
            score += 30;
        }
        
        // Value preference patterns
        uint256 maxValue = 0;
        for (uint256 i = 0; i < 8; ++i) {
            if (actorBehavior.actionValues[ActionType(i)] > maxValue) {
                maxValue = actorBehavior.actionValues[ActionType(i)];
            }
        }
        
        if (maxValue > actorBehavior.totalValue / 2) {
            score += 30;
        }
        
        return score;
    }

    /**
     * @notice Update campaign metrics based on actor behaviors
     * @param campaignId The campaign ID
     */
    function _updateCampaignMetrics(uint256 campaignId) private {
        CampaignAnalytics storage analytics = campaignAnalytics[campaignId];
        
        // Update catallaxy metrics
        _updateCatallacticMetrics(campaignId);
        
        // Update praxeological analysis
        _updatePraxeologicalAnalysis(campaignId);
        
        // Update market process dynamics
        _updateMarketProcessDynamics(campaignId);
        
        // Update active actor count
        uint256 activeCount = 0;
        for (uint256 i = 0; i < analytics.actorList.length; ++i) {
            if (analytics.actors[analytics.actorList[i]].isActive) {
                ++activeCount;
            }
        }
        analytics.activeActors = activeCount;
        
        analytics.lastUpdateTime = block.timestamp;
    }

    /**
     * @notice Update catallactic metrics for a campaign
     * @param campaignId The campaign ID
     */
    function _updateCatallacticMetrics(uint256 campaignId) private {
        CatallacticMetrics storage metrics = campaignAnalytics[campaignId].catallaxy;
        CampaignAnalytics storage analytics = campaignAnalytics[campaignId];
        
        if (analytics.totalActors == 0) return;
        
        // Spontaneous order index
        metrics.spontaneousOrderIndex = _calculateSpontaneousOrderIndex(campaignId);
        
        // Coordination efficiency
        metrics.coordinationEfficiency = _calculateCoordinationEfficiency(campaignId);
        
        // Information transmission
        metrics.informationTransmission = _calculateInformationTransmission(campaignId);
        
        // Price discovery mechanism
        metrics.priceDiscoveryMechanism = _calculatePriceDiscoveryMechanism(campaignId);
        
        // Market depth
        metrics.marketDepth = analytics.totalActors * 10;
        
        // Liquidity coordination
        metrics.liquidityCoordination = _calculateLiquidityCoordination(campaignId);
        
        // Voluntary exchange index
        metrics.voluntaryExchangeIndex = _calculateVoluntaryExchangeIndex(campaignId);
        
        // Competitive discovery
        metrics.competitiveDiscovery = _calculateCompetitiveDiscovery(campaignId);
        
        // Entrepreneurial action
        metrics.entrepreneurialAction = _calculateEntrepreneurialAction(campaignId);
        
        // Temporal coordination
        metrics.temporalCoordination = _calculateTemporalCoordination(campaignId);
        
        emit CatallacticMetricsUpdated(campaignId, metrics, block.timestamp);
    }

    /**
     * @notice Calculate spontaneous order index
     * @param campaignId The campaign ID
     * @return uint256 The spontaneous order index
     */
    function _calculateSpontaneousOrderIndex(uint256 campaignId) private view returns (uint256) {
        CampaignAnalytics storage analytics = campaignAnalytics[campaignId];
        
        uint256 totalCoordination = 0;
        uint256 totalMarketSignals = 0;
        
        for (uint256 i = 0; i < analytics.actorList.length; ++i) {
            address actor = analytics.actorList[i];
            totalCoordination += analytics.actors[actor].actionCounts[ActionType.COORDINATION];
            totalMarketSignals += analytics.actors[actor].actionCounts[ActionType.MARKET_SIGNAL];
        }
        
        uint256 orderIndex = (totalCoordination + totalMarketSignals) * 100 / (analytics.totalActors + 1);
        return Math.min(orderIndex, 100);
    }

    /**
     * @notice Calculate coordination efficiency
     * @param campaignId The campaign ID
     * @return uint256 The coordination efficiency
     */
    function _calculateCoordinationEfficiency(uint256 campaignId) private view returns (uint256) {
        CampaignAnalytics storage analytics = campaignAnalytics[campaignId];
        
        uint256 totalCoordination = 0;
        uint256 totalActions = 0;
        
        for (uint256 i = 0; i < analytics.actorList.length; ++i) {
            address actor = analytics.actorList[i];
            totalCoordination += analytics.actors[actor].actionCounts[ActionType.COORDINATION];
            totalActions += analytics.actors[actor].totalActions;
        }
        
        if (totalActions == 0) return 0;
        
        uint256 efficiency = (totalCoordination * 100) / totalActions;
        return Math.min(efficiency * 5, 100); // Amplify coordination importance
    }

    /**
     * @notice Calculate information transmission efficiency
     * @param campaignId The campaign ID
     * @return uint256 The information transmission efficiency
     */
    function _calculateInformationTransmission(uint256 campaignId) private view returns (uint256) {
        CampaignAnalytics storage analytics = campaignAnalytics[campaignId];
        
        uint256 totalReviews = 0;
        uint256 totalSignals = 0;
        
        for (uint256 i = 0; i < analytics.actorList.length; ++i) {
            address actor = analytics.actorList[i];
            totalReviews += analytics.actors[actor].actionCounts[ActionType.MILESTONE_REVIEW];
            totalSignals += analytics.actors[actor].actionCounts[ActionType.MARKET_SIGNAL];
        }
        
        uint256 transmission = (totalReviews + totalSignals) * 100 / (analytics.totalActors + 1);
        return Math.min(transmission, 100);
    }

    /**
     * @notice Calculate price discovery mechanism effectiveness
     * @param campaignId The campaign ID
     * @return uint256 The price discovery effectiveness
     */
    function _calculatePriceDiscoveryMechanism(uint256 campaignId) private view returns (uint256) {
        CampaignAnalytics storage analytics = campaignAnalytics[campaignId];
        
        uint256 totalValueDiscovery = 0;
        uint256 totalContributions = 0;
        
        for (uint256 i = 0; i < analytics.actorList.length; ++i) {
            address actor = analytics.actorList[i];
            totalValueDiscovery += analytics.actors[actor].actionCounts[ActionType.VALUE_DISCOVERY];
            totalContributions += analytics.actors[actor].actionCounts[ActionType.CONTRIBUTION];
        }
        
        if (totalContributions == 0) return 0;
        
        uint256 discovery = (totalValueDiscovery * 100) / totalContributions;
        return Math.min(discovery * 3, 100);
    }

    /**
     * @notice Calculate liquidity coordination
     * @param campaignId The campaign ID
     * @return uint256 The liquidity coordination score
     */
    function _calculateLiquidityCoordination(uint256 campaignId) private view returns (uint256) {
        CampaignAnalytics storage analytics = campaignAnalytics[campaignId];
        
        uint256 totalValue = 0;
        uint256 activeActors = 0;
        
        for (uint256 i = 0; i < analytics.actorList.length; ++i) {
            address actor = analytics.actorList[i];
            if (analytics.actors[actor].isActive) {
                totalValue += analytics.actors[actor].totalValue;
                ++activeActors;
            }
        }
        
        if (activeActors == 0) return 0;
        
        uint256 avgValue = totalValue / activeActors;
        uint256 coordination = Math.min(avgValue / 1000, 100);
        
        return coordination;
    }

    /**
     * @notice Calculate voluntary exchange index
     * @param campaignId The campaign ID
     * @return uint256 The voluntary exchange index
     */
    function _calculateVoluntaryExchangeIndex(uint256 campaignId) private view returns (uint256) {
        CampaignAnalytics storage analytics = campaignAnalytics[campaignId];
        
        uint256 voluntaryActions = 0;
        uint256 totalActions = 0;
        
        for (uint256 i = 0; i < analytics.actorList.length; ++i) {
            address actor = analytics.actorList[i];
            // Contributions and value discovery are voluntary
            voluntaryActions += analytics.actors[actor].actionCounts[ActionType.CONTRIBUTION];
            voluntaryActions += analytics.actors[actor].actionCounts[ActionType.VALUE_DISCOVERY];
            voluntaryActions += analytics.actors[actor].actionCounts[ActionType.MILESTONE_REVIEW];
            totalActions += analytics.actors[actor].totalActions;
        }
        
        if (totalActions == 0) return 0;
        
        uint256 voluntaryIndex = (voluntaryActions * 100) / totalActions;
        return voluntaryIndex;
    }

    /**
     * @notice Calculate competitive discovery
     * @param campaignId The campaign ID
     * @return uint256 The competitive discovery score
     */
    function _calculateCompetitiveDiscovery(uint256 campaignId) private view returns (uint256) {
        CampaignAnalytics storage analytics = campaignAnalytics[campaignId];
        
        uint256 discoveryActions = 0;
        
        for (uint256 i = 0; i < analytics.actorList.length; ++i) {
            address actor = analytics.actorList[i];
            discoveryActions += analytics.actors[actor].actionCounts[ActionType.VALUE_DISCOVERY];
            discoveryActions += analytics.actors[actor].actionCounts[ActionType.MARKET_SIGNAL];
        }
        
        uint256 discovery = discoveryActions * 100 / (analytics.totalActors + 1);
        return Math.min(discovery, 100);
    }

    /**
     * @notice Calculate entrepreneurial action
     * @param campaignId The campaign ID
     * @return uint256 The entrepreneurial action score
     */
    function _calculateEntrepreneurialAction(uint256 campaignId) private view returns (uint256) {
        CampaignAnalytics storage analytics = campaignAnalytics[campaignId];
        
        uint256 entrepreneurialActions = 0;
        
        for (uint256 i = 0; i < analytics.actorList.length; ++i) {
            address actor = analytics.actorList[i];
            entrepreneurialActions += analytics.actors[actor].actionCounts[ActionType.CAMPAIGN_CREATION];
            entrepreneurialActions += analytics.actors[actor].actionCounts[ActionType.VALUE_DISCOVERY];
        }
        
        uint256 entrepreneurial = entrepreneurialActions * 100 / (analytics.totalActors + 1);
        return Math.min(entrepreneurial, 100);
    }

    /**
     * @notice Calculate temporal coordination
     * @param campaignId The campaign ID
     * @return uint256 The temporal coordination score
     */
    function _calculateTemporalCoordination(uint256 campaignId) private view returns (uint256) {
        CampaignAnalytics storage analytics = campaignAnalytics[campaignId];
        
        uint256 analysisStart = analytics.analysisStartTime;
        uint256 timeSpan = analysisStart > block.timestamp ? 0 : block.timestamp - analysisStart;
        if (timeSpan == 0) return 0;
        
        uint256 totalActions = 0;
        for (uint256 i = 0; i < analytics.actorList.length; ++i) {
            address actor = analytics.actorList[i];
            totalActions += analytics.actors[actor].totalActions;
        }
        
        uint256 actionRate = (totalActions * 86400) / timeSpan; // Actions per day
        uint256 coordination = Math.min(actionRate * 10, 100);
        
        return coordination;
    }

    /**
     * @notice Update praxeological analysis for a campaign
     * @param campaignId The campaign ID
     */
    function _updatePraxeologicalAnalysis(uint256 campaignId) private {
        PraxeologicalAnalysis storage analysis = campaignAnalytics[campaignId].praxeology;
        
        // Calculate aggregate praxeological metrics
        analysis.purposefulActionIndex = _calculatePurposefulActionIndex(campaignId);
        analysis.meansEndsRationality = _calculateMeansEndsRationality(campaignId);
        analysis.timePreferenceAnalysis = _calculateTimePreferenceAnalysis(campaignId);
        analysis.marginalUtilityPatterns = _calculateMarginalUtilityPatterns(campaignId);
        analysis.actionHierarchy = _calculateActionHierarchy(campaignId);
        analysis.uncertaintyHandling = _calculateUncertaintyHandling(campaignId);
        analysis.knowledgeUtilization = _calculateKnowledgeUtilization(campaignId);
        analysis.planCoordination = _calculatePlanCoordination(campaignId);
        analysis.adaptiveBehavior = _calculateAdaptiveBehavior(campaignId);
        analysis.individualSovereignty = _calculateIndividualSovereignty(campaignId);
        
        emit PraxeologicalAnalysisUpdated(campaignId, analysis, block.timestamp);
    }

    /**
     * @notice Calculate purposeful action index
     * @param campaignId The campaign ID
     * @return uint256 The purposeful action index
     */
    function _calculatePurposefulActionIndex(uint256 campaignId) private view returns (uint256) {
        CampaignAnalytics storage analytics = campaignAnalytics[campaignId];
        
        uint256 totalPraxeologicalScore = 0;
        uint256 validActors = 0;
        
        for (uint256 i = 0; i < analytics.actorList.length; ++i) {
            address actor = analytics.actorList[i];
            if (analytics.actors[actor].totalActions >= minActionsForAnalysis) {
                totalPraxeologicalScore += analytics.actors[actor].praxeologicalScore;
                ++validActors;
            }
        }
        
        if (validActors == 0) return 0;
        
        return totalPraxeologicalScore / validActors;
    }

    /**
     * @notice Calculate means-ends rationality
     * @param campaignId The campaign ID
     * @return uint256 The means-ends rationality score
     */
    function _calculateMeansEndsRationality(uint256 campaignId) private view returns (uint256) {
        CampaignAnalytics storage analytics = campaignAnalytics[campaignId];
        
        uint256 totalValueEfficiency = 0;
        uint256 validActors = 0;
        
        for (uint256 i = 0; i < analytics.actorList.length; ++i) {
            address actor = analytics.actorList[i];
            if (analytics.actors[actor].totalActions >= minActionsForAnalysis) {
                uint256 efficiency = analytics.actors[actor].totalValue / analytics.actors[actor].totalActions;
                totalValueEfficiency += Math.min(efficiency / 100, 100);
                ++validActors;
            }
        }
        
        if (validActors == 0) return 0;
        
        return totalValueEfficiency / validActors;
    }

    /**
     * @notice Calculate time preference analysis
     * @param campaignId The campaign ID
     * @return uint256 The time preference analysis score
     */
    function _calculateTimePreferenceAnalysis(uint256 campaignId) private view returns (uint256) {
        CampaignAnalytics storage analytics = campaignAnalytics[campaignId];
        
        uint256 totalTimePreference = 0;
        uint256 validActors = 0;
        
        for (uint256 i = 0; i < analytics.actorList.length; ++i) {
            address actor = analytics.actorList[i];
            if (analytics.actors[actor].totalActions >= minActionsForAnalysis) {
                uint256 actorFirst = analytics.actors[actor].firstActionTime;
                uint256 timeSpan = actorFirst > block.timestamp ? 0 : block.timestamp - actorFirst;
                if (timeSpan > 0) {
                    uint256 actionFrequency = (analytics.actors[actor].totalActions * 86400) / timeSpan;
                    totalTimePreference += Math.min(actionFrequency * 10, 100);
                    ++validActors;
                }
            }
        }
        
        if (validActors == 0) return 0;
        
        return totalTimePreference / validActors;
    }

    /**
     * @notice Calculate marginal utility patterns
     * @param campaignId The campaign ID
     * @return uint256 The marginal utility patterns score
     */
    function _calculateMarginalUtilityPatterns(uint256 campaignId) private view returns (uint256) {
        CampaignAnalytics storage analytics = campaignAnalytics[campaignId];
        
        uint256 totalUtilityScore = 0;
        uint256 validActors = 0;
        
        for (uint256 i = 0; i < analytics.actorList.length; ++i) {
            address actor = analytics.actorList[i];
            if (analytics.actors[actor].totalActions >= minActionsForAnalysis) {
                totalUtilityScore += analytics.actors[actor].subjectiveValueIndex;
                ++validActors;
            }
        }
        
        if (validActors == 0) return 0;
        
        return totalUtilityScore / validActors;
    }

    /**
     * @notice Calculate action hierarchy
     * @param campaignId The campaign ID
     * @return uint256 The action hierarchy score
     */
    function _calculateActionHierarchy(uint256 campaignId) private view returns (uint256) {
        CampaignAnalytics storage analytics = campaignAnalytics[campaignId];
        
        // Analyze action type preferences across actors
        // CRITICAL: Fixed-size array auto-initializes to zero, but explicit for clarity
        uint256[8] memory actionTypeTotals = [uint256(0), uint256(0), uint256(0), uint256(0), uint256(0), uint256(0), uint256(0), uint256(0)];
        
        for (uint256 i = 0; i < analytics.actorList.length; ++i) {
            address actor = analytics.actorList[i];
            for (uint256 j = 0; j < 8; ++j) {
                actionTypeTotals[j] += analytics.actors[actor].actionCounts[ActionType(j)];
            }
        }
        
        // Calculate hierarchy based on action distribution
        uint256 maxActions = 0;
        for (uint256 i = 0; i < 8; ++i) {
            if (actionTypeTotals[i] > maxActions) {
                maxActions = actionTypeTotals[i];
            }
        }
        
        if (maxActions == 0) return 0;
        
        // Higher score for more balanced hierarchy
        uint256 hierarchyScore = 0;
        for (uint256 i = 0; i < 8; ++i) {
            if (actionTypeTotals[i] > 0) {
                hierarchyScore += (actionTypeTotals[i] * 100) / maxActions;
            }
        }
        
        return Math.min(hierarchyScore / 8, 100);
    }

    /**
     * @notice Calculate uncertainty handling
     * @param campaignId The campaign ID
     * @return uint256 The uncertainty handling score
     */
    function _calculateUncertaintyHandling(uint256 campaignId) private view returns (uint256) {
        CampaignAnalytics storage analytics = campaignAnalytics[campaignId];
        
        uint256 totalUncertaintyScore = 0;
        uint256 validActors = 0;
        
        for (uint256 i = 0; i < analytics.actorList.length; ++i) {
            address actor = analytics.actorList[i];
            if (analytics.actors[actor].totalActions >= minActionsForAnalysis) {
                // Uncertainty handling measured by action diversity and adaptation
                uint256 actionTypes = 0;
                for (uint256 j = 0; j < 8; ++j) {
                    if (analytics.actors[actor].actionCounts[ActionType(j)] > 0) {
                        ++actionTypes;
                    }
                }
                totalUncertaintyScore += actionTypes * 12; // Max 96 for all 8 types
                ++validActors;
            }
        }
        
        if (validActors == 0) return 0;
        
        return Math.min(totalUncertaintyScore / validActors, 100);
    }

    /**
     * @notice Calculate knowledge utilization
     * @param campaignId The campaign ID
     * @return uint256 The knowledge utilization score
     */
    function _calculateKnowledgeUtilization(uint256 campaignId) private view returns (uint256) {
        CampaignAnalytics storage analytics = campaignAnalytics[campaignId];
        
        uint256 totalKnowledgeActions = 0;
        uint256 totalActions = 0;
        
        for (uint256 i = 0; i < analytics.actorList.length; ++i) {
            address actor = analytics.actorList[i];
            totalKnowledgeActions += analytics.actors[actor].actionCounts[ActionType.MILESTONE_REVIEW];
            totalKnowledgeActions += analytics.actors[actor].actionCounts[ActionType.VALUE_DISCOVERY];
            totalKnowledgeActions += analytics.actors[actor].actionCounts[ActionType.MARKET_SIGNAL];
            totalActions += analytics.actors[actor].totalActions;
        }
        
        if (totalActions == 0) return 0;
        
        uint256 utilizationRatio = (totalKnowledgeActions * 100) / totalActions;
        return Math.min(utilizationRatio * 2, 100); // Amplify knowledge importance
    }

    /**
     * @notice Calculate plan coordination
     * @param campaignId The campaign ID
     * @return uint256 The plan coordination score
     */
    function _calculatePlanCoordination(uint256 campaignId) private view returns (uint256) {
        CampaignAnalytics storage analytics = campaignAnalytics[campaignId];
        
        uint256 totalCoordinationScore = 0;
        uint256 validActors = 0;
        
        for (uint256 i = 0; i < analytics.actorList.length; ++i) {
            address actor = analytics.actorList[i];
            if (analytics.actors[actor].totalActions >= minActionsForAnalysis) {
                totalCoordinationScore += analytics.actors[actor].marketCoordinationScore;
                ++validActors;
            }
        }
        
        if (validActors == 0) return 0;
        
        return totalCoordinationScore / validActors;
    }

    /**
     * @notice Calculate adaptive behavior
     * @param campaignId The campaign ID
     * @return uint256 The adaptive behavior score
     */
    function _calculateAdaptiveBehavior(uint256 campaignId) private view returns (uint256) {
        CampaignAnalytics storage analytics = campaignAnalytics[campaignId];
        
        uint256 totalAdaptationScore = 0;
        uint256 validActors = 0;
        
        for (uint256 i = 0; i < analytics.actorList.length; ++i) {
            address actor = analytics.actorList[i];
            if (analytics.actors[actor].totalActions >= minActionsForAnalysis) {
                // Adaptation measured by action pattern changes over time
                uint256 adaptationScore = 0;
                
                // Check if actor has recent activity
                if (analytics.actors[actor].isActive) {
                    adaptationScore += 30;
                }
                
                // Check action diversity
                uint256 actionTypes = 0;
                for (uint256 j = 0; j < 8; ++j) {
                    if (analytics.actors[actor].actionCounts[ActionType(j)] > 0) {
                        ++actionTypes;
                    }
                }
                adaptationScore += actionTypes * 8;
                
                totalAdaptationScore += Math.min(adaptationScore, 100);
                ++validActors;
            }
        }
        
        if (validActors == 0) return 0;
        
        return totalAdaptationScore / validActors;
    }

    /**
     * @notice Calculate individual sovereignty
     * @param campaignId The campaign ID
     * @return uint256 The individual sovereignty score
     */
    function _calculateIndividualSovereignty(uint256 campaignId) private view returns (uint256) {
        CampaignAnalytics storage analytics = campaignAnalytics[campaignId];
        
        uint256 totalSovereigntyScore = 0;
        uint256 validActors = 0;
        
        for (uint256 i = 0; i < analytics.actorList.length; ++i) {
            address actor = analytics.actorList[i];
            if (analytics.actors[actor].totalActions >= minActionsForAnalysis) {
                uint256 sovereigntyScore = 0;
                
                // Individual action autonomy
                sovereigntyScore += Math.min(analytics.actors[actor].totalActions * 2, 40);
                
                // Value determination autonomy
                sovereigntyScore += Math.min(analytics.actors[actor].subjectiveValueIndex, 30);
                
                // Action choice diversity
                uint256 actionTypes = 0;
                for (uint256 j = 0; j < 8; ++j) {
                    if (analytics.actors[actor].actionCounts[ActionType(j)] > 0) {
                        ++actionTypes;
                    }
                }
                sovereigntyScore += actionTypes * 4; // Max 32 for all 8 types
                
                totalSovereigntyScore += Math.min(sovereigntyScore, 100);
                ++validActors;
            }
        }
        
        if (validActors == 0) return 0;
        
        return totalSovereigntyScore / validActors;
    }

    /**
     * @notice Update market process dynamics for a campaign
     * @param campaignId The campaign ID
     */
    function _updateMarketProcessDynamics(uint256 campaignId) private {
        MarketProcessDynamics storage dynamics = campaignAnalytics[campaignId].marketProcess;
        
        // Calculate market process metrics
        dynamics.discoveryMechanism = _calculateDiscoveryMechanism(campaignId);
        dynamics.competitiveProcess = _calculateCompetitiveProcess(campaignId);
        dynamics.entrepreneurialAlertness = _calculateEntrepreneurialAlertness(campaignId);
        dynamics.arbitrageOpportunities = _calculateArbitrageOpportunities(campaignId);
        dynamics.innovationIncentives = _calculateInnovationIncentives(campaignId);
        dynamics.resourceAllocation = _calculateResourceAllocation(campaignId);
        dynamics.signalTransmission = _calculateSignalTransmission(campaignId);
        dynamics.feedbackMechanisms = _calculateFeedbackMechanisms(campaignId);
        dynamics.adaptationSpeed = _calculateAdaptationSpeed(campaignId);
        dynamics.equilibrationTendency = _calculateEquilibrationTendency(campaignId);
        
        emit MarketProcessUpdated(campaignId, dynamics, block.timestamp);
    }

    /**
     * @notice Calculate discovery mechanism effectiveness
     * @param campaignId The campaign ID
     * @return uint256 The discovery mechanism score
     */
    function _calculateDiscoveryMechanism(uint256 campaignId) private view returns (uint256) {
        return _calculatePriceDiscoveryMechanism(campaignId); // Reuse existing calculation
    }

    /**
     * @notice Calculate competitive process strength
     * @param campaignId The campaign ID
     * @return uint256 The competitive process score
     */
    function _calculateCompetitiveProcess(uint256 campaignId) private view returns (uint256) {
        return _calculateCompetitiveDiscovery(campaignId); // Reuse existing calculation
    }

    /**
     * @notice Calculate entrepreneurial alertness
     * @param campaignId The campaign ID
     * @return uint256 The entrepreneurial alertness score
     */
    function _calculateEntrepreneurialAlertness(uint256 campaignId) private view returns (uint256) {
        return _calculateEntrepreneurialAction(campaignId); // Reuse existing calculation
    }

    /**
     * @notice Calculate arbitrage opportunities
     * @param campaignId The campaign ID
     * @return uint256 The arbitrage opportunities score
     */
    function _calculateArbitrageOpportunities(uint256 campaignId) private view returns (uint256) {
        CampaignAnalytics storage analytics = campaignAnalytics[campaignId];
        
        uint256 totalValueDiscovery = 0;
        uint256 totalMarketSignals = 0;
        
        for (uint256 i = 0; i < analytics.actorList.length; ++i) {
            address actor = analytics.actorList[i];
            totalValueDiscovery += analytics.actors[actor].actionCounts[ActionType.VALUE_DISCOVERY];
            totalMarketSignals += analytics.actors[actor].actionCounts[ActionType.MARKET_SIGNAL];
        }
        
        uint256 arbitrageScore = (totalValueDiscovery + totalMarketSignals) * 100 / (analytics.totalActors + 1);
        return Math.min(arbitrageScore, 100);
    }

    /**
     * @notice Calculate innovation incentives
     * @param campaignId The campaign ID
     * @return uint256 The innovation incentives score
     */
    function _calculateInnovationIncentives(uint256 campaignId) private view returns (uint256) {
        CampaignAnalytics storage analytics = campaignAnalytics[campaignId];
        
        uint256 innovationActions = 0;
        
        for (uint256 i = 0; i < analytics.actorList.length; ++i) {
            address actor = analytics.actorList[i];
            innovationActions += analytics.actors[actor].actionCounts[ActionType.CAMPAIGN_CREATION];
            innovationActions += analytics.actors[actor].actionCounts[ActionType.VALUE_DISCOVERY];
            innovationActions += analytics.actors[actor].actionCounts[ActionType.MARKET_SIGNAL];
        }
        
        uint256 innovationScore = innovationActions * 100 / (analytics.totalActors + 1);
        return Math.min(innovationScore, 100);
    }

    /**
     * @notice Calculate resource allocation efficiency
     * @param campaignId The campaign ID
     * @return uint256 The resource allocation score
     */
    function _calculateResourceAllocation(uint256 campaignId) private view returns (uint256) {
        CampaignAnalytics storage analytics = campaignAnalytics[campaignId];
        
        uint256 totalValue = 0;
        uint256 totalContributions = 0;
        
        for (uint256 i = 0; i < analytics.actorList.length; ++i) {
            address actor = analytics.actorList[i];
            totalValue += analytics.actors[actor].totalValue;
            totalContributions += analytics.actors[actor].actionCounts[ActionType.CONTRIBUTION];
        }
        
        if (totalContributions == 0) return 0;
        
        uint256 avgContributionValue = totalValue / totalContributions;
        uint256 allocationScore = Math.min(avgContributionValue / 1000, 100);
        
        return allocationScore;
    }

    /**
     * @notice Calculate signal transmission clarity
     * @param campaignId The campaign ID
     * @return uint256 The signal transmission score
     */
    function _calculateSignalTransmission(uint256 campaignId) private view returns (uint256) {
        return _calculateInformationTransmission(campaignId); // Reuse existing calculation
    }

    /**
     * @notice Calculate feedback mechanisms effectiveness
     * @param campaignId The campaign ID
     * @return uint256 The feedback mechanisms score
     */
    function _calculateFeedbackMechanisms(uint256 campaignId) private view returns (uint256) {
        CampaignAnalytics storage analytics = campaignAnalytics[campaignId];
        
        uint256 feedbackActions = 0;
        
        for (uint256 i = 0; i < analytics.actorList.length; ++i) {
            address actor = analytics.actorList[i];
            feedbackActions += analytics.actors[actor].actionCounts[ActionType.MILESTONE_REVIEW];
            feedbackActions += analytics.actors[actor].actionCounts[ActionType.REFUND_REQUEST];
            feedbackActions += analytics.actors[actor].actionCounts[ActionType.REPUTATION_UPDATE];
        }
        
        uint256 feedbackScore = feedbackActions * 100 / (analytics.totalActors + 1);
        return Math.min(feedbackScore, 100);
    }

    /**
     * @notice Calculate market adaptation speed
     * @param campaignId The campaign ID
     * @return uint256 The adaptation speed score
     */
    function _calculateAdaptationSpeed(uint256 campaignId) private view returns (uint256) {
        return _calculateTemporalCoordination(campaignId); // Reuse existing calculation
    }

    /**
     * @notice Calculate equilibration tendency
     * @param campaignId The campaign ID
     * @return uint256 The equilibration tendency score
     */
    function _calculateEquilibrationTendency(uint256 campaignId) private view returns (uint256) {
        CampaignAnalytics storage analytics = campaignAnalytics[campaignId];
        
        // Measure tendency toward equilibrium through action balance
        // CRITICAL: Fixed-size array auto-initializes to zero, but explicit for clarity
        uint256[8] memory actionTypeTotals = [uint256(0), uint256(0), uint256(0), uint256(0), uint256(0), uint256(0), uint256(0), uint256(0)];
        uint256 totalActions = 0;
        
        for (uint256 i = 0; i < analytics.actorList.length; ++i) {
            address actor = analytics.actorList[i];
            for (uint256 j = 0; j < 8; ++j) {
                actionTypeTotals[j] += analytics.actors[actor].actionCounts[ActionType(j)];
                totalActions += analytics.actors[actor].actionCounts[ActionType(j)];
            }
        }
        
        if (totalActions == 0) return 0;
        
        // Calculate variance from equal distribution
        uint256 expectedPerType = totalActions / 8;
        uint256 totalVariance = 0;
        
        for (uint256 i = 0; i < 8; ++i) {
            uint256 variance = actionTypeTotals[i] > expectedPerType ? 
                actionTypeTotals[i] - expectedPerType : 
                expectedPerType - actionTypeTotals[i];
            totalVariance += variance;
        }
        
        uint256 avgVariance = totalVariance / 8;
        
        // Lower variance = higher equilibration tendency
        uint256 equilibrationScore = avgVariance < expectedPerType ? 
            100 - ((avgVariance * 100) / expectedPerType) : 0;
        
        return equilibrationScore;
    }

    /**
     * @notice Calculate global Austrian Economics metrics
     */
    function calculateGlobalMetrics() external onlyGovernance {
        uint256 lastCalc = globalMetrics.lastCalculationTime;
        if (
            lastCalc != 0 &&
            lastCalc <= block.timestamp &&
            block.timestamp - lastCalc < analysisUpdateInterval
        ) {
            revert UpdateTooFrequent();
        }
        
        uint256 totalCampaigns = activeCampaigns.length;
        if (totalCampaigns == 0) {
            globalMetrics.lastCalculationTime = block.timestamp;
            return;
        }
        
        // Aggregate metrics across all campaigns
        uint256 totalSpontaneousOrder = 0;
        uint256 totalCatallaxy = 0;
        uint256 totalPraxeology = 0;
        uint256 totalMarketProcess = 0;
        
        for (uint256 i = 0; i < totalCampaigns; ++i) {
            uint256 campaignId = activeCampaigns[i];
            CampaignAnalytics storage analytics = campaignAnalytics[campaignId];
            
            if (analytics.isActive) {
                totalSpontaneousOrder += analytics.catallaxy.spontaneousOrderIndex;
                
                // Calculate weighted catallaxy score
                uint256 catallacticScore = (
                    analytics.catallaxy.coordinationEfficiency +
                    analytics.catallaxy.informationTransmission +
                    analytics.catallaxy.voluntaryExchangeIndex +
                    analytics.catallaxy.competitiveDiscovery
                ) / 4;
                totalCatallaxy += catallacticScore;
                
                // Calculate weighted praxeology score
                uint256 praxeologicalScore = (
                    analytics.praxeology.purposefulActionIndex +
                    analytics.praxeology.meansEndsRationality +
                    analytics.praxeology.individualSovereignty +
                    analytics.praxeology.adaptiveBehavior
                ) / 4;
                totalPraxeology += praxeologicalScore;
                
                // Calculate weighted market process score
                uint256 marketProcessScore = (
                    analytics.marketProcess.discoveryMechanism +
                    analytics.marketProcess.competitiveProcess +
                    analytics.marketProcess.entrepreneurialAlertness +
                    analytics.marketProcess.equilibrationTendency
                ) / 4;
                totalMarketProcess += marketProcessScore;
            }
        }
        
        // Update global metrics
        globalMetrics.overallSpontaneousOrder = totalSpontaneousOrder / totalCampaigns;
        globalMetrics.systemWideCatallaxy = totalCatallaxy / totalCampaigns;
        globalMetrics.aggregatePraxeology = totalPraxeology / totalCampaigns;
        globalMetrics.marketProcessEfficiency = totalMarketProcess / totalCampaigns;
        
        // Calculate derived metrics
        globalMetrics.individualismIndex = _calculateGlobalIndividualism();
        globalMetrics.subjectiveValuePrevalence = _calculateGlobalSubjectiveValue();
        globalMetrics.voluntaryAssociationIndex = _calculateGlobalVoluntaryAssociation();
        globalMetrics.soundMoneyMetrics = _calculateGlobalSoundMoney();
        
        // Calculate overall Austrian compliance
        globalMetrics.austrianComplianceScore = (
            globalMetrics.overallSpontaneousOrder * CATALLACTIC_WEIGHT +
            globalMetrics.aggregatePraxeology * PRAXEOLOGICAL_WEIGHT +
            globalMetrics.marketProcessEfficiency * MARKET_PROCESS_WEIGHT
        ) / 100;
        
        globalMetrics.lastCalculationTime = block.timestamp;
        
        emit GlobalMetricsCalculated(globalMetrics, block.timestamp);
    }

    /**
     * @notice Calculate global individualism index
     * @return uint256 The global individualism index
     */
    function _calculateGlobalIndividualism() private view returns (uint256) {
        uint256 totalIndividualism = 0;
        uint256 validActors = 0;
        
        for (uint256 i = 0; i < globalActors.length; ++i) {
            address actor = globalActors[i];
            if (globalActorBehavior[actor].totalActions >= minActionsForAnalysis) {
                totalIndividualism += globalActorBehavior[actor].praxeologicalScore;
                ++validActors;
            }
        }
        
        if (validActors == 0) return 0;
        
        return totalIndividualism / validActors;
    }

    /**
     * @notice Calculate global subjective value prevalence
     * @return uint256 The global subjective value prevalence
     */
    function _calculateGlobalSubjectiveValue() private view returns (uint256) {
        uint256 totalSubjectiveValue = 0;
        uint256 validActors = 0;
        
        for (uint256 i = 0; i < globalActors.length; ++i) {
            address actor = globalActors[i];
            if (globalActorBehavior[actor].totalActions >= minActionsForAnalysis) {
                totalSubjectiveValue += globalActorBehavior[actor].subjectiveValueIndex;
                ++validActors;
            }
        }
        
        if (validActors == 0) return 0;
        
        return totalSubjectiveValue / validActors;
    }

    /**
     * @notice Calculate global voluntary association index
     * @return uint256 The global voluntary association index
     */
    function _calculateGlobalVoluntaryAssociation() private view returns (uint256) {
        uint256 totalVoluntaryActions = 0;
        uint256 totalActions = 0;
        
        for (uint256 i = 0; i < globalActors.length; ++i) {
            address actor = globalActors[i];
            if (globalActorBehavior[actor].totalActions >= minActionsForAnalysis) {
                // Count voluntary actions
                totalVoluntaryActions += globalActorBehavior[actor].actionCounts[ActionType.CONTRIBUTION];
                totalVoluntaryActions += globalActorBehavior[actor].actionCounts[ActionType.VALUE_DISCOVERY];
                totalVoluntaryActions += globalActorBehavior[actor].actionCounts[ActionType.MILESTONE_REVIEW];
                totalVoluntaryActions += globalActorBehavior[actor].actionCounts[ActionType.COORDINATION];
                
                totalActions += globalActorBehavior[actor].totalActions;
            }
        }
        
        if (totalActions == 0) return 0;
        
        return (totalVoluntaryActions * 100) / totalActions;
    }

    /**
     * @notice Calculate global sound money metrics
     * @return uint256 The global sound money metrics
     */
    function _calculateGlobalSoundMoney() private view returns (uint256) {
        uint256 totalMarketCoordination = 0;
        uint256 validActors = 0;
        
        for (uint256 i = 0; i < globalActors.length; ++i) {
            address actor = globalActors[i];
            if (globalActorBehavior[actor].totalActions >= minActionsForAnalysis) {
                totalMarketCoordination += globalActorBehavior[actor].marketCoordinationScore;
                ++validActors;
            }
        }
        
        if (validActors == 0) return 0;
        
        return totalMarketCoordination / validActors;
    }

    /**
     * @notice Generate Austrian Economics insights for a campaign
     * @param campaignId The campaign ID
     * @return string The generated insight
     * @return uint256 The confidence level (0-100)
     */
    function generateAustrianInsight(uint256 campaignId) external view returns (string memory, uint256) {
        CampaignAnalytics storage analytics = campaignAnalytics[campaignId];
        if (!analytics.isActive) revert AnalysisNotActive();
        
        if (analytics.totalActors < minActionsForAnalysis) {
            return ("Insufficient data for meaningful Austrian analysis", 0);
        }
        
        string memory insight;
        uint256 confidence;
        
        // Analyze dominant patterns
        uint256 catallacticScore = (
            analytics.catallaxy.spontaneousOrderIndex +
            analytics.catallaxy.coordinationEfficiency +
            analytics.catallaxy.voluntaryExchangeIndex
        ) / 3;
        
        uint256 praxeologicalScore = (
            analytics.praxeology.purposefulActionIndex +
            analytics.praxeology.meansEndsRationality +
            analytics.praxeology.individualSovereignty
        ) / 3;
        
        uint256 marketProcessScore = (
            analytics.marketProcess.discoveryMechanism +
            analytics.marketProcess.competitiveProcess +
            analytics.marketProcess.entrepreneurialAlertness
        ) / 3;
        
        // Generate insight based on strongest pattern
        if (catallacticScore >= praxeologicalScore && catallacticScore >= marketProcessScore) {
            if (catallacticScore >= 80) {
                insight = string.concat("Strong spontaneous order emergence: Market participants are effectively ",
                    "self-coordinating through voluntary exchange, demonstrating robust catallaxy.");
                confidence = 90;
            } else if (catallacticScore >= 60) {
                insight = string.concat("Moderate catallaxy development: Some spontaneous coordination visible, ",
                    "but market order could be strengthened through enhanced information flow.");
                confidence = 75;
            } else {
                insight = string.concat("Weak spontaneous order: Limited self-coordination observed. ",
                    "Consider mechanisms to improve voluntary exchange and market signaling.");
                confidence = 60;
            }
        } else if (praxeologicalScore >= marketProcessScore) {
            if (praxeologicalScore >= 80) {
                insight = string.concat("Excellent praxeological behavior: Participants demonstrate purposeful action ",
                    "with clear means-ends rationality and individual sovereignty.");
                confidence = 90;
            } else if (praxeologicalScore >= 60) {
                insight = string.concat("Good individual action patterns: Most participants show purposeful behavior, ",
                    "but some improvement in rational action planning possible.");
                confidence = 75;
            } else {
                insight = string.concat("Suboptimal praxeological patterns: Participants may benefit from clearer ",
                    "incentive structures to encourage more purposeful action.");
                confidence = 60;
            }
        } else {
            if (marketProcessScore >= 80) {
                insight = string.concat("Robust market process: Strong discovery mechanisms, competitive processes, ",
                    "and entrepreneurial alertness driving efficient resource allocation.");
                confidence = 90;
            } else if (marketProcessScore >= 60) {
                insight = string.concat("Developing market process: Good discovery and competition, ",
                    "but entrepreneurial alertness could be enhanced for better market efficiency.");
                confidence = 75;
            } else {
                insight = string.concat("Weak market process: Limited discovery and competition. ",
                    "Consider incentives for entrepreneurial action and market signaling.");
                confidence = 60;
            }
        }
        
        return (insight, confidence);
    }

    /**
     * @notice Get campaign analytics summary
     * @param campaignId The campaign ID
     * @return campaignId The campaign identifier
     * @return catallaxy The catallactic metrics
     * @return praxeology The praxeological analysis
     * @return marketProcess The market process dynamics
     * @return totalActors The total number of actors
     * @return activeActors The number of active actors
     * @return isActive Whether the analysis is active
     */
    function getCampaignAnalytics(uint256 campaignId) external view returns (
        uint256,
        CatallacticMetrics memory,
        PraxeologicalAnalysis memory,
        MarketProcessDynamics memory,
        uint256,
        uint256,
        bool
    ) {
        CampaignAnalytics storage analytics = campaignAnalytics[campaignId];
        return (
            analytics.campaignId,
            analytics.catallaxy,
            analytics.praxeology,
            analytics.marketProcess,
            analytics.totalActors,
            analytics.activeActors,
            analytics.isActive
        );
    }

    /**
     * @notice Get actor behavior for a campaign
     * @param campaignId The campaign ID
     * @param actor The actor address
     * @return actor The actor address
     * @return totalActions The total number of actions
     * @return totalValue The total value of actions
     * @return firstActionTime The timestamp of first action
     * @return lastOverallActionTime The timestamp of last action
     * @return praxeologicalScore The praxeological score
     * @return catallacticContribution The catallactic contribution
     * @return subjectiveValueIndex The subjective value index
     * @return marketCoordinationScore The market coordination score
     * @return isActive Whether the actor is active
     */
    function getCampaignActorBehavior(uint256 campaignId, address actor) external view returns (
        address,
        uint256,
        uint256,
        uint256,
        uint256,
        uint256,
        uint256,
        uint256,
        uint256,
        bool
    ) {
        ActorBehavior storage behavior = campaignAnalytics[campaignId].actors[actor];
        return (
            behavior.actor,
            behavior.totalActions,
            behavior.totalValue,
            behavior.firstActionTime,
            behavior.lastOverallActionTime,
            behavior.praxeologicalScore,
            behavior.catallacticContribution,
            behavior.subjectiveValueIndex,
            behavior.marketCoordinationScore,
            behavior.isActive
        );
    }

    /**
     * @notice Get global actor behavior
     * @param actor The actor address
     * @return actor The actor address
     * @return totalActions The total number of actions
     * @return totalValue The total value of actions
     * @return firstActionTime The timestamp of first action
     * @return lastOverallActionTime The timestamp of last action
     * @return praxeologicalScore The praxeological score
     * @return catallacticContribution The catallactic contribution
     * @return subjectiveValueIndex The subjective value index
     * @return marketCoordinationScore The market coordination score
     * @return isActive Whether the actor is active
     */
    function getGlobalActorBehavior(address actor) external view returns (
        address,
        uint256,
        uint256,
        uint256,
        uint256,
        uint256,
        uint256,
        uint256,
        uint256,
        bool
    ) {
        ActorBehavior storage behavior = globalActorBehavior[actor];
        return (
            behavior.actor,
            behavior.totalActions,
            behavior.totalValue,
            behavior.firstActionTime,
            behavior.lastOverallActionTime,
            behavior.praxeologicalScore,
            behavior.catallacticContribution,
            behavior.subjectiveValueIndex,
            behavior.marketCoordinationScore,
            behavior.isActive
        );
    }

    /**
     * @notice Get actor action count for specific type
     * @param campaignId The campaign ID (0 for global)
     * @param actor The actor address
     * @param actionType The action type
     * @return uint256 The action count
     */
    function getActorActionCount(
        uint256 campaignId, 
        address actor, 
        ActionType actionType
    ) external view returns (uint256) {
        if (campaignId == 0) {
            return globalActorBehavior[actor].actionCounts[actionType];
        } else {
            return campaignAnalytics[campaignId].actors[actor].actionCounts[actionType];
        }
    }

    /**
     * @notice Get actor action value for specific type
     * @param campaignId The campaign ID (0 for global)
     * @param actor The actor address
     * @param actionType The action type
     * @return uint256 The action value
     */
    function getActorActionValue(
        uint256 campaignId, 
        address actor, 
        ActionType actionType
    ) external view returns (uint256) {
        if (campaignId == 0) {
            return globalActorBehavior[actor].actionValues[actionType];
        } else {
            return campaignAnalytics[campaignId].actors[actor].actionValues[actionType];
        }
    }

    /**
     * @notice Get active campaigns list
     * @return uint256[] The list of active campaign IDs
     */
    function getActiveCampaigns() external view returns (uint256[] memory) {
        return activeCampaigns;
    }

    /**
     * @notice Get global actors list
     * @return address[] The list of global actor addresses
     */
    function getGlobalActors() external view returns (address[] memory) {
        return globalActors;
    }

    /**
     * @notice Get campaign actors list
     * @param campaignId The campaign ID
     * @return address[] The list of campaign actor addresses
     */
    function getCampaignActors(uint256 campaignId) external view returns (address[] memory) {
        return campaignAnalytics[campaignId].actorList;
    }

    /**
     * @notice Stop analytics for a campaign
     * @param campaignId The campaign ID
     */
    function stopCampaignAnalysis(uint256 campaignId) external onlyGovernance {
        CampaignAnalytics storage analytics = campaignAnalytics[campaignId];
        if (!analytics.isActive) revert AnalysisNotActive();
        
        analytics.isActive = false;
        
        // Remove from active campaigns
        for (uint256 i = 0; i < activeCampaigns.length; ++i) {
            if (activeCampaigns[i] == campaignId) {
                activeCampaigns[i] = activeCampaigns[activeCampaigns.length - 1];
                activeCampaigns.pop();
                break;
            }
        }
    }

    /**
     * @notice Emergency function to reset global metrics
     */
    function resetGlobalMetrics() external onlyGovernance {
        globalMetrics = GlobalAustrianMetrics(0, 0, 0, 0, 0, 0, 0, 0, 0, block.timestamp);
    }

    /**
     * @notice Update analysis configuration
     * @param newUpdateInterval New update interval
     * @param newActivityThreshold New activity threshold
     * @param newMinActions New minimum actions for analysis
     */
    function updateAnalysisConfig(uint256 newUpdateInterval, uint256 newActivityThreshold, uint256 newMinActions) external onlyGovernance {
        if (newUpdateInterval < 1 hours) revert UpdateIntervalTooShort();
        if (newActivityThreshold < 1 days) revert ActivityThresholdTooShort();
        if (newMinActions < 1) revert MinActionsTooLow();
        analysisUpdateInterval = newUpdateInterval;
        actorActivityThreshold = newActivityThreshold;
        minActionsForAnalysis = newMinActions;
        emit AnalysisConfigUpdated(newUpdateInterval, newActivityThreshold, newMinActions, block.timestamp);
    }
}

/**
 * @title AustrianAnalytics DAO Transformation Documentation
 * @notice This contract has been transformed from centralized to decentralized governance
 * 
 * GOVERNANCE TRANSFORMATION:
 * - Removed centralized Ownable control
 * - Implemented IPrivateGovernance interface for DAO control
 * - All admin functions now require governance approval through onlyGovernance modifier
 * 
 * DAO-CONTROLLED FUNCTIONS:
 * - startCampaignAnalysis: Initiate Austrian economic analysis for campaigns
 * - calculateGlobalMetrics: Calculate system-wide Austrian economic metrics
 * - stopCampaignAnalysis: Halt analysis for specific campaigns
 * - resetGlobalMetrics: Emergency reset of global metrics
 * - updateAnalysisConfig: Modify analysis configuration parameters
 * - setGovernance: Update the governance contract address
 * 
 * SECURITY IMPLICATIONS:
 * - Decentralized analytics control prevents manipulation of economic insights
 * - Governance-controlled metric calculations ensure transparent Austrian analysis
 * - Multi-signature governance required for critical analytics operations
 * - Transparent and auditable praxeological behavior analysis
 * 
 * AUSTRIAN ECONOMICS PRINCIPLES:
 * - Praxeology: Analysis of purposeful human action in crowdfunding
 * - Catallaxy: Spontaneous order emergence in decentralized markets
 * - Methodological Individualism: Individual actor behavior tracking
 * - Subjective Value Theory: Personal valuation and preference analysis
 * - Market Process: Dynamic coordination and discovery mechanisms
 * - Sound Money: Austrian economic compliance scoring
 */
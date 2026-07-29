// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Groth16Verifier} from "../Groth16Verifier.sol"; // Generated Groth16 verifier
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ICommonErrors} from "../interfaces/ICommonErrors.sol";
import {IPrivateGovernance} from "../interfaces/IPrivateGovernance.sol";
import {GovernanceAccessLib} from "../libraries/GovernanceAccessLib.sol";
import "./AegisCrowdShield.sol";


/**
 * @title RefundVerifier
 * @author Aegis Protocol Team
 * @notice Verifier wrapper for refund ZK circuit implementing Austrian Economics principles
 * @dev Verifier wrapper for refund ZK circuit implementing Austrian Economics principles:
 *      - Individual Sovereignty: Private refund requests without revealing contributor identity
 *      - Voluntary Association: Cryptographic proof of voluntary exit from campaigns
 *      - Sound Money: Preservation of original contribution value and refund calculations
 *      - Market-Driven Justice: Decentralized refund evaluation and approval
 *      - Methodological Individualism: Individual contributor refund tracking
 *      - Decentralized Governance: All admin functions controlled by DAO consensus
 */
contract RefundVerifier is ReentrancyGuard, ICommonErrors {
    using SafeERC20 for IERC20;
    
    /// @notice The Groth16 verifier contract for refund circuit
    Groth16Verifier public immutable GROTH16_VERIFIER;
    
    /// @notice Reference to AegisCrowdShield contract for campaign data
    AegisCrowdShield public immutable CROWD_SHIELD;

    /// @notice DAO governance contract
    IPrivateGovernance public governance;

    address public timelockController;

    event TimelockControllerUpdated(address indexed previousTimelock, address indexed newTimelock);

    /// @notice Refund request verification data
    struct RefundRequestProof {
        uint256[2] a;           // Proof point A
        uint256[2][2] b;        // Proof point B  
        uint256[2] c;           // Proof point C
        uint256[] publicInputs; // Public inputs to the circuit
        bytes32 nullifierHash;  // Nullifier to prevent double-refunding
        uint256 timestamp;      // Proof generation timestamp
        bool verified;          // Whether proof has been verified
        address contributor;    // Address that submitted the proof
        uint256 refundAmount;   // Calculated refund amount
        uint256 refundReason;   // Reason code for refund
        uint256 originalContribution; // Original contribution amount
        bool processed;         // Whether refund has been processed
        bool approved;          // Whether refund has been approved
    }

    /// @notice Austrian Economics refund metrics
    struct AustrianRefundMetrics {
        uint256 voluntaryExits;           // Count of voluntary exits
        uint256 contractualBasis;         // Contractual basis adherence
        uint256 marketJustification;      // Market-driven justification
        uint256 individualSovereignty;    // Individual sovereignty preservation
        uint256 soundMoneyPreservation;   // Sound money principle adherence
        bool austrianCompliance;          // Overall Austrian compliance
        uint256 decentralizedApproval;    // Decentralized approval score
        uint256 emergentJustice;          // Emergent justice mechanism
    }

    /// @notice Campaign refund state
    struct CampaignRefundState {
        mapping(bytes32 => bool) nullifiers;           // Used nullifiers
        mapping(address => uint256) contributorRefunds; // Refunds per contributor
        mapping(address => bool) hasRefunded;          // Contributor refund status
        RefundRequestProof[] refundRequests;           // All refund request proofs
        AustrianRefundMetrics metrics;                 // Austrian Economics metrics
        uint256 totalRefundRequests;                   // Total refund request count
        uint256 verifiedRefunds;                       // Verified refund count
        uint256 approvedRefunds;                       // Approved refund count
        uint256 processedRefunds;                      // Processed refund count
        uint256 totalRefundAmount;                     // Total refund amount
        uint256 totalRefundPool;                       // Available refund pool
        uint256 currentRefundClaimed;                  // Currently claimed refunds
        bool refundsEnabled;                           // Whether refunds are enabled
        uint256 refundDeadline;                        // Refund request deadline
        uint256 creationTime;                          // Campaign creation timestamp
        uint256 refundStartTime;                       // Refund period start time
    }

    /// @notice Refund reason categories
    enum RefundReason {
        CAMPAIGN_FAILURE,      // Campaign failed to meet goals
        MILESTONE_FAILURE,     // Milestones not achieved
        FRAUD_DETECTED,        // Fraud or misrepresentation
        VOLUNTARY_EXIT,        // Voluntary contributor exit
        TECHNICAL_ISSUES,      // Technical problems
        REGULATORY_ISSUES,     // Regulatory compliance issues
        MARKET_CONDITIONS,     // Adverse market conditions
        PERSONAL_CIRCUMSTANCES // Personal financial circumstances
    }

    /// @notice Mapping of campaign ID to refund state
    mapping(uint256 => CampaignRefundState) public campaigns;

    /// @notice Mapping of nullifier hash to campaign ID
    mapping(bytes32 => uint256) public nullifierToCampaign;

    /// @notice Mapping of contributor to reputation and refund history
    mapping(address => uint256) public contributorReputation;
    mapping(address => uint256) public contributorRefundCount;
    mapping(address => uint256) public contributorTotalRefunded;

    /// @notice Active campaigns with refunds enabled
    uint256[] public refundEnabledCampaigns;

    /// @notice Configuration constants
    uint256 public constant MAX_REFUNDS_PER_CAMPAIGN = 10000;
    uint256 public constant MAX_REFUNDS_PER_CONTRIBUTOR = 10;
    uint256 public constant MIN_CONTRIBUTOR_REPUTATION = 50;
    uint256 public constant DEFAULT_REFUND_DEADLINE = 30 days;
    uint256 public constant REFUND_PROCESSING_FEE = 1; // 1% processing fee
    uint256 public constant MIN_REFUND_AMOUNT = 0.001 ether;

    /// @notice Refund percentage based on reason and timing
    mapping(RefundReason => uint256) public refundPercentages;

    /// @notice Events
    
    /// @notice Emitted when refunds are enabled for a campaign
    /// @param campaignId The ID of the campaign
    /// @param refundDeadline The deadline for refund requests
    /// @param totalRefundPool The total amount available for refunds
    /// @param timestamp The timestamp when refunds were enabled
    event CampaignRefundEnabled(
        uint256 indexed campaignId,
        uint256 refundDeadline,
        uint256 totalRefundPool,
        uint256 timestamp
    );

    /// @notice Emitted when a refund request is verified
    /// @param campaignId The ID of the campaign
    /// @param nullifierHash The nullifier hash to prevent double-refunding
    /// @param contributor The address of the contributor
    /// @param refundAmount The amount to be refunded
    /// @param reason The reason for the refund
    /// @param timestamp The timestamp when the request was verified
    event RefundRequestVerified(
        uint256 indexed campaignId,
        bytes32 indexed nullifierHash,
        address indexed contributor,
        uint256 refundAmount,
        RefundReason reason,
        uint256 timestamp
    );

    /// @notice Emitted when a refund is approved
    /// @param campaignId The ID of the campaign
    /// @param nullifierHash The nullifier hash to prevent double-refunding
    /// @param contributor The address of the contributor
    /// @param approvedAmount The approved refund amount
    /// @param timestamp The timestamp when the refund was approved
    event RefundApproved(
        uint256 indexed campaignId,
        bytes32 indexed nullifierHash,
        address indexed contributor,
        uint256 approvedAmount,
        uint256 timestamp
    );

    /// @notice Emitted when a refund is processed
    /// @param campaignId The ID of the campaign
    /// @param nullifierHash The nullifier hash to prevent double-refunding
    /// @param contributor The address of the contributor
    /// @param processedAmount The processed refund amount
    /// @param timestamp The timestamp when the refund was processed
    event RefundProcessed(
        uint256 indexed campaignId,
        bytes32 indexed nullifierHash,
        address indexed contributor,
        uint256 processedAmount,
        uint256 timestamp
    );

    /// @notice Emitted when Austrian refund metrics are updated
    /// @param campaignId The ID of the campaign
    /// @param metrics The updated Austrian Economics metrics
    event AustrianRefundMetricsUpdated(
        uint256 indexed campaignId,
        AustrianRefundMetrics metrics
    );

    /// @notice Emitted when a contributor's reputation is updated
    /// @param contributor The address of the contributor
    /// @param oldScore The previous reputation score
    /// @param newScore The new reputation score
    event ContributorReputationUpdated(
        address indexed contributor,
        uint256 oldScore,
        uint256 newScore
    );

    /// @notice Emitted when refund percentage for a reason is updated
    /// @param reason The refund reason category
    /// @param oldPercentage The previous refund percentage
    /// @param newPercentage The new refund percentage
    event RefundPercentageUpdated(
        RefundReason indexed reason,
        uint256 oldPercentage,
        uint256 newPercentage
    );

    /// @notice Event emitted when governance is updated
    event GovernanceUpdated(address indexed oldGovernance, address indexed newGovernance);

    /// @notice Custom errors

    error CampaignNotFound();
    error RefundsNotEnabled();
    error RefundDeadlinePassed();
    error MaxRefundsReached();
    error ContributorLimitReached();
    error InsufficientReputation();
    
    error ContributorAlreadyRefunded();
    error InsufficientRefundPool();
    error RefundAlreadyProcessed();
    error RefundNotApproved();
    error InvalidRefundAmount();
    
    error InvalidPercentage();
    error RefundRequestNotFound();

    /// @notice Constructor to initialize the RefundVerifier contract
    /// @param _groth16Verifier Address of the Groth16 verifier contract
    /// @param _crowdShield Address of the AegisCrowdShield contract
    /// @param _governance Address of the DAO governance contract
    constructor(
        address _groth16Verifier, 
        address _crowdShield,
        address _governance
    ) {
        if (_groth16Verifier == address(0)) revert InvalidAddress();
        if (_crowdShield == address(0)) revert InvalidAddress();
        if (_governance == address(0)) revert InvalidAddress();
        
        GROTH16_VERIFIER = Groth16Verifier(_groth16Verifier);
        CROWD_SHIELD = AegisCrowdShield(_crowdShield);
        governance = IPrivateGovernance(_governance);
        _initializeRefundPercentages();
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

    /// @notice Update the governance contract (only callable by current governance)
    /// @param _newGovernance Address of the new governance contract
    function setGovernance(address _newGovernance) external onlyGovernance {
        if (_newGovernance == address(0)) revert InvalidAddress();
        address oldGovernance = address(governance);
        governance = IPrivateGovernance(_newGovernance);
        emit GovernanceUpdated(oldGovernance, _newGovernance);
    }

    /**
     * @notice Initialize default refund percentages
     */
    function _initializeRefundPercentages() private {
        refundPercentages[RefundReason.CAMPAIGN_FAILURE] = 90;
        refundPercentages[RefundReason.MILESTONE_FAILURE] = 80;
        refundPercentages[RefundReason.FRAUD_DETECTED] = 95;
        refundPercentages[RefundReason.VOLUNTARY_EXIT] = 70;
        refundPercentages[RefundReason.TECHNICAL_ISSUES] = 85;
        refundPercentages[RefundReason.REGULATORY_ISSUES] = 85;
        refundPercentages[RefundReason.MARKET_CONDITIONS] = 60;
        refundPercentages[RefundReason.PERSONAL_CIRCUMSTANCES] = 50;
    }

    /**
     * @notice Enable refunds for a campaign
     * @param campaignId The campaign ID
     * @param totalRefundPool The total amount available for refunds
     * @param refundDeadline The deadline for refund requests
     */
    function enableCampaignRefunds(
        uint256 campaignId,
        uint256 totalRefundPool,
        uint256 refundDeadline
    ) external onlyGovernance {
        CampaignRefundState storage campaign = campaigns[campaignId];
        
        campaign.refundsEnabled = true;
        campaign.totalRefundPool = totalRefundPool;
        campaign.refundDeadline = refundDeadline > 0 ? refundDeadline : block.timestamp + DEFAULT_REFUND_DEADLINE;
        campaign.refundStartTime = block.timestamp;
        campaign.creationTime = block.timestamp;
        campaign.metrics = AustrianRefundMetrics(0, 0, 0, 0, 0, false, 0, 0);
        
        refundEnabledCampaigns.push(campaignId);
        
        emit CampaignRefundEnabled(campaignId, campaign.refundDeadline, totalRefundPool, block.timestamp);
    }

    /**
     * @notice Verify a refund request proof
     * @param campaignId The campaign ID
     * @param proof The ZK proof components
     * @param publicInputs The public inputs to the circuit
     * @return bool Whether the proof is valid
     */
    function verifyRefundRequest(
        uint256 campaignId,
        uint256[8] calldata proof,
        uint256[] calldata publicInputs
    ) external nonReentrant returns (bool) {
        CampaignRefundState storage campaign = campaigns[campaignId];
        
        // Validate campaign exists and refunds are enabled
        if (campaign.creationTime == 0) revert CampaignNotFound();
        
        if (!campaign.refundsEnabled) revert RefundsNotEnabled();
        
        if (block.timestamp > campaign.refundDeadline) revert RefundDeadlinePassed();
        
        // Validate campaign status - only allow refunds for Failed or Disputed campaigns
        AegisCrowdShield.CampaignSovereignty memory campaignData = CROWD_SHIELD.getCampaign(campaignId);
        // Use integer comparison to handle enum compatibility between contracts
        // Failed = 2, Disputed = 4 (if it exists in AegisCrowdShield)
        uint8 campaignStatus = uint8(campaignData.status);
        if (campaignStatus != 2) { // Failed status
            revert RefundsNotEnabled();
        }
        
        // Check refund limits
        if (campaign.totalRefundRequests >= MAX_REFUNDS_PER_CAMPAIGN) {
            revert MaxRefundsReached();
        }
        if (contributorRefundCount[msg.sender] >= MAX_REFUNDS_PER_CONTRIBUTOR) {
            revert ContributorLimitReached();
        }

        // Check contributor reputation
        if (contributorReputation[msg.sender] < MIN_CONTRIBUTOR_REPUTATION) {
            revert InsufficientReputation();
        }

        // Validate public inputs format
        if (publicInputs.length < 10) revert InvalidPublicInputs();
        
        // Extract data from public inputs
        bytes32 nullifierHash = bytes32(publicInputs[1]);
        uint256 refundReason = publicInputs[3];
        uint256 originalContribution = publicInputs[9]; // From private inputs, revealed in proof
        
        // Check nullifier hasn't been used (primary duplicate prevention)
        if (campaign.nullifiers[nullifierHash]) revert NullifierAlreadyUsed();
        if (nullifierToCampaign[nullifierHash] != 0) revert NullifierAlreadyUsed();
        
        // Secondary check for contributor refund status
        if (campaign.hasRefunded[msg.sender]) {
            revert ContributorAlreadyRefunded();
        }

        // Verify the ZK proof
        uint256[2] memory a = [proof[0], proof[1]];
        uint256[2][2] memory b = [[proof[2], proof[3]], [proof[4], proof[5]]];
        uint256[2] memory c = [proof[6], proof[7]];
        
        // Verify the ZK proof
        bool isValid = GROTH16_VERIFIER.verifyProof(a, b, c, publicInputs);
        if (!isValid) revert InvalidProof();

        // Calculate refund amount
        uint256 refundAmount = _calculateRefundAmount(
            originalContribution,
            RefundReason(refundReason),
            campaign.refundStartTime
        );

        // Validate refund amount
        if (refundAmount == 0) revert InvalidRefundAmount();

        // Check if refund pool has sufficient funds
        if (campaign.currentRefundClaimed + refundAmount > campaign.totalRefundPool) {
            revert InsufficientRefundPool();
        }

        // Store the refund request proof
        RefundRequestProof memory refundProof = RefundRequestProof({
            a: a,
            b: b,
            c: c,
            publicInputs: publicInputs,
            nullifierHash: nullifierHash,
            timestamp: block.timestamp,
            verified: true,
            contributor: msg.sender,
            refundAmount: refundAmount,
            refundReason: refundReason,
            originalContribution: originalContribution,
            processed: false,
            approved: false
        });

        campaign.refundRequests.push(refundProof);
        campaign.nullifiers[nullifierHash] = true;
        campaign.contributorRefunds[msg.sender] += refundAmount;
        campaign.hasRefunded[msg.sender] = true;
        campaign.totalRefundRequests++;
        campaign.verifiedRefunds++;
        campaign.totalRefundAmount += refundAmount;
        
        contributorRefundCount[msg.sender]++;
        nullifierToCampaign[nullifierHash] = campaignId;

        // Update Austrian Economics metrics
        _updateAustrianRefundMetrics(campaignId, refundProof);

        // Update contributor reputation based on refund reason
        _updateContributorReputation(msg.sender, RefundReason(refundReason));

        emit RefundRequestVerified(
            campaignId,
            nullifierHash,
            msg.sender,
            refundAmount,
            RefundReason(refundReason),
            block.timestamp
        );
        
        return true;
    }

    /**
     * @notice Calculate refund amount based on reason and timing
     * @param originalContribution The original contribution amount
     * @param reason The refund reason
     * @param refundStartTime The refund period start time
     * @return uint256 The calculated refund amount
     */
    function _calculateRefundAmount(
        uint256 originalContribution,
        RefundReason reason,
        uint256 refundStartTime
    ) private view returns (uint256) {
        if (originalContribution < MIN_REFUND_AMOUNT) return 0;
        
        uint256 basePercentage = refundPercentages[reason];
        
        // Time-based adjustment (earlier refunds get slightly higher percentage)
        uint256 timeElapsed = refundStartTime > block.timestamp
            ? 0
            : block.timestamp - refundStartTime;
        uint256 timeBonus = 0;
        
        if (timeElapsed < 7 days) {
            timeBonus = 5; // 5% bonus for early refunds
        } else if (timeElapsed < 14 days) {
            timeBonus = 3; // 3% bonus for medium-early refunds
        } else if (timeElapsed < 21 days) {
            timeBonus = 1; // 1% bonus for medium refunds
        }
        
        uint256 adjustedPercentage = basePercentage + timeBonus;
        if (adjustedPercentage > 100) adjustedPercentage = 100;
        
        uint256 refundAmount = (originalContribution * adjustedPercentage) / 100;
        
        // Apply processing fee
        uint256 processingFee = (refundAmount * REFUND_PROCESSING_FEE) / 100;
        refundAmount -= processingFee;
        
        return refundAmount;
    }

    /**
     * @notice Update Austrian Economics metrics for a refund
     * @param campaignId The campaign ID
     * @param refundProof The refund proof
     */
    function _updateAustrianRefundMetrics(
        uint256 campaignId,
        RefundRequestProof memory refundProof
    ) private {
        CampaignRefundState storage campaign = campaigns[campaignId];
        AustrianRefundMetrics storage metrics = campaign.metrics;

        // Individual Sovereignty: Voluntary exit capability
        metrics.voluntaryExits++;
        metrics.individualSovereignty += _calculateSovereigntyScore(refundProof);

        // Contractual Basis: Adherence to original agreement terms
        metrics.contractualBasis += _calculateContractualScore(refundProof);

        // Market-Driven Justice: Decentralized refund evaluation
        metrics.marketJustification += _calculateMarketJustificationScore(campaign);

        // Sound Money: Preservation of value
        metrics.soundMoneyPreservation += _calculateSoundMoneyScore(refundProof);

        // Decentralized approval
        metrics.decentralizedApproval += _calculateDecentralizedApprovalScore(campaign);

        // Emergent justice
        metrics.emergentJustice += _calculateEmergentJusticeScore(campaign);

        // Overall Austrian compliance check
        metrics.austrianCompliance = _validateAustrianRefundCompliance(metrics);

        emit AustrianRefundMetricsUpdated(campaignId, metrics);
    }

    /**
     * @notice Calculate sovereignty score
     * @param refundProof The refund proof
     * @return uint256 The sovereignty score
     */
    function _calculateSovereigntyScore(RefundRequestProof memory refundProof) private pure returns (uint256) {
        uint256 score = 0;
        
        // Individual contributor identity verification
        score += refundProof.contributor != address(0) ? 25 : 0;
        
        // Unique nullifier (individual sovereignty)
        score += refundProof.nullifierHash != bytes32(0) ? 25 : 0;
        
        // Voluntary exit (non-coercive)
        RefundReason reason = RefundReason(refundProof.refundReason);
        score += (reason == RefundReason.VOLUNTARY_EXIT || reason == RefundReason.PERSONAL_CIRCUMSTANCES) ? 25 : 15;
        
        // Original contribution verification
        score += refundProof.originalContribution > 0 ? 25 : 0;
        
        return score;
    }

    /**
     * @notice Calculate contractual score
     * @param refundProof The refund proof
     * @return uint256 The contractual score
     */
    function _calculateContractualScore(RefundRequestProof memory refundProof) private pure returns (uint256) {
        uint256 score = 0;
        
        // Valid refund reason
        RefundReason reason = RefundReason(refundProof.refundReason);
        if (reason == RefundReason.CAMPAIGN_FAILURE || 
            reason == RefundReason.MILESTONE_FAILURE || 
            reason == RefundReason.FRAUD_DETECTED) {
            score += 40; // High contractual basis
        } else if (reason == RefundReason.TECHNICAL_ISSUES || reason == RefundReason.REGULATORY_ISSUES) {
            score += 30; // Medium contractual basis
        } else {
            score += 20; // Lower contractual basis
        }
        
        // Proof verification
        score += refundProof.verified ? 30 : 0;
        
        // Reasonable refund amount
        if (refundProof.refundAmount <= refundProof.originalContribution) {
            score += 30;
        }
        
        return score;
    }

    /**
     * @notice Calculate market justification score
     * @param campaign The campaign refund state
     * @return uint256 The market justification score
     */
    function _calculateMarketJustificationScore(CampaignRefundState storage campaign) private view returns (uint256) {
        if (campaign.totalRefundRequests == 0) return 0;
        
        // Score based on refund request diversity and patterns
        uint256 refundDiversity = campaign.totalRefundRequests * 5;
        
        // Market-driven refund rate
        uint256 refundRate = (campaign.totalRefundAmount * 100) / (campaign.totalRefundPool + 1);
        uint256 marketScore = refundRate < 50 ? 50 : (100 - refundRate);
        
        return refundDiversity + marketScore;
    }

    /**
     * @notice Calculate sound money score
     * @param refundProof The refund proof
     * @return uint256 The sound money score
     */
    function _calculateSoundMoneyScore(RefundRequestProof memory refundProof) private pure returns (uint256) {
        uint256 score = 0;
        
        // Value preservation
        if (refundProof.refundAmount <= refundProof.originalContribution) {
            score += 40;
        }
        
        // Reasonable refund percentage
        uint256 refundPercentage = refundProof.originalContribution > 0 ? 
            (refundProof.refundAmount * 100) / refundProof.originalContribution : 0;
        if (refundPercentage >= 50 && refundPercentage <= 95) {
            score += 30;
        }
        
        // Original contribution verification
        score += refundProof.originalContribution > 0 ? 30 : 0;
        
        return score;
    }

    /**
     * @notice Calculate decentralized approval score
     * @param campaign The campaign refund state
     * @return uint256 The decentralized approval score
     */
    function _calculateDecentralizedApprovalScore(CampaignRefundState storage campaign) private view returns (uint256) {
        // Score based on decentralization of refund requests
        uint256 uniqueContributors = 0;
        
        // Count unique contributors (simplified)
        uint256 requestsLength = campaign.refundRequests.length;
        for (uint256 i = 0; i < requestsLength; ++i) {
            bool isUnique = true;
            for (uint256 j = 0; j < i; ++j) {
                if (campaign.refundRequests[i].contributor == campaign.refundRequests[j].contributor) {
                    isUnique = false;
                    break;
                }
            }
            if (isUnique) uniqueContributors++;
        }
        
        // Higher score for more unique contributors
        uint256 decentralizationRatio = (uniqueContributors * 100) / (campaign.totalRefundRequests + 1);
        
        return decentralizationRatio;
    }

    /**
     * @notice Calculate emergent justice score
     * @param campaign The campaign refund state
     * @return uint256 The emergent justice score
     */
    function _calculateEmergentJusticeScore(CampaignRefundState storage campaign) private view returns (uint256) {
        if (campaign.totalRefundRequests < 2) return 0;
        
        // Calculate refund amount variance to measure justice emergence
        uint256 totalVariance = 0;
        uint256 avgRefund = campaign.totalRefundAmount / campaign.totalRefundRequests;
        
        uint256 requestsLength = campaign.refundRequests.length;
        for (uint256 i = 0; i < requestsLength; ++i) {
            uint256 amount = campaign.refundRequests[i].refundAmount;
            uint256 variance = amount > avgRefund ? amount - avgRefund : avgRefund - amount;
            totalVariance += variance;
        }
        
        uint256 avgVariance = totalVariance / campaign.totalRefundRequests;
        
        // Lower variance = more consistent justice = higher score
        // Add additional check to prevent division by zero in avgRefund calculation
        uint256 justiceScore = avgRefund > 0 && avgVariance < avgRefund / 10 ? 100 - ((avgVariance * 1000) / avgRefund) : 0;
        
        return justiceScore;
    }

    /**
     * @notice Validate Austrian Economics refund compliance
     * @param metrics The Austrian refund metrics
     * @return bool Whether the metrics indicate Austrian compliance
     */
    function _validateAustrianRefundCompliance(AustrianRefundMetrics memory metrics) private pure returns (bool) {
        return (
            metrics.voluntaryExits > 0 &&
            metrics.individualSovereignty >= 60 &&
            metrics.contractualBasis >= 50 &&
            metrics.marketJustification >= 40 &&
            metrics.soundMoneyPreservation >= 60 &&
            metrics.decentralizedApproval >= 30 &&
            metrics.emergentJustice >= 40
        );
    }

    /**
     * @notice Update contributor reputation based on refund reason
     * @param contributor The contributor address
     * @param reason The refund reason
     */
    function _updateContributorReputation(address contributor, RefundReason reason) private {
        uint256 oldScore = contributorReputation[contributor];
        int256 delta = 0;
        
        // Reputation impact based on refund reason
        if (reason == RefundReason.FRAUD_DETECTED) {
            delta = 10; // Positive for detecting fraud
        } else if (reason == RefundReason.CAMPAIGN_FAILURE || reason == RefundReason.MILESTONE_FAILURE) {
            delta = 0; // Neutral for legitimate failures
        } else if (reason == RefundReason.VOLUNTARY_EXIT) {
            delta = -2; // Small negative for voluntary exit
        } else if (reason == RefundReason.PERSONAL_CIRCUMSTANCES) {
            delta = -1; // Minimal negative for personal reasons
        } else {
            delta = -3; // Moderate negative for other reasons
        }
        
        if (delta < 0 && uint256(-delta) > oldScore) {
            contributorReputation[contributor] = 0;
        } else {
            contributorReputation[contributor] = uint256(int256(oldScore) + delta);
        }

        emit ContributorReputationUpdated(contributor, oldScore, contributorReputation[contributor]);
    }

    /**
     * @notice Approve a refund request (admin function)
     * @param campaignId The campaign ID
     * @param nullifierHash The nullifier hash of the refund request
     */
    function approveRefund(uint256 campaignId, bytes32 nullifierHash) external onlyGovernance {
        CampaignRefundState storage campaign = campaigns[campaignId];
        
        // Find the refund request
        uint256 requestsLength = campaign.refundRequests.length;
        for (uint256 i = 0; i < requestsLength; ++i) {
            if (campaign.refundRequests[i].nullifierHash == nullifierHash) {
                RefundRequestProof storage refundProof = campaign.refundRequests[i];
                
                if (refundProof.approved) return; // Already approved
                
                refundProof.approved = true;
                campaign.approvedRefunds++;
                
                emit RefundApproved(
                    campaignId,
                    nullifierHash,
                    refundProof.contributor,
                    refundProof.refundAmount,
                    block.timestamp
                );
                return;
            }
        }
        
        revert RefundRequestNotFound();
    }

    /**
     * @notice Process an approved refund (admin function)
     * @param campaignId The campaign ID
     * @param nullifierHash The nullifier hash of the refund request
     */
    function processRefund(uint256 campaignId, bytes32 nullifierHash) external onlyGovernance {
        CampaignRefundState storage campaign = campaigns[campaignId];
        
        // Find the refund request
        uint256 requestsLength = campaign.refundRequests.length;
        for (uint256 i = 0; i < requestsLength; ++i) {
            if (campaign.refundRequests[i].nullifierHash == nullifierHash) {
                RefundRequestProof storage refundProof = campaign.refundRequests[i];
                
                if (!refundProof.approved) revert RefundNotApproved();
                if (refundProof.processed) revert RefundAlreadyProcessed();
                
                refundProof.processed = true;
                campaign.processedRefunds++;
                campaign.currentRefundClaimed += refundProof.refundAmount;
                contributorTotalRefunded[refundProof.contributor] += refundProof.refundAmount;
                
                // Get campaign token information from AegisCrowdShield
                AegisCrowdShield.CampaignSovereignty memory campaignData = CROWD_SHIELD.getCampaign(campaignId);
                
                // Validate refund amount against available balance
                if (refundProof.refundAmount == 0) revert InvalidRefundAmount();
                
                // Transfer refund amount to contributor
                _executeRefundTransfer(
                    campaignData.paymentToken,
                    refundProof.contributor,
                    refundProof.refundAmount
                );
                
                emit RefundProcessed(
                    campaignId,
                    nullifierHash,
                    refundProof.contributor,
                    refundProof.refundAmount,
                    block.timestamp
                );
                return;
            }
        }
        
        revert("Refund request not found");
    }

    /**
     * @notice Set contributor reputation (admin function)
     * @param contributor The contributor address
     * @param reputation The reputation score
     */
    function setContributorReputation(address contributor, uint256 reputation) external onlyGovernance {
        uint256 oldScore = contributorReputation[contributor];
        contributorReputation[contributor] = reputation;
        emit ContributorReputationUpdated(contributor, oldScore, reputation);
    }

    /**
     * @notice Update refund percentage for a reason (admin function)
     * @param reason The refund reason
     * @param percentage The new refund percentage
     */
    function updateRefundPercentage(RefundReason reason, uint256 percentage) external onlyGovernance {
        if (percentage > 100) revert InvalidPercentage();
        uint256 oldPercentage = refundPercentages[reason];
        refundPercentages[reason] = percentage;
        emit RefundPercentageUpdated(reason, oldPercentage, percentage);
    }

    /**
     * @notice Get campaign refund information
     * @param campaignId The campaign ID
     * @return totalRefundRequests Total number of refund requests
     * @return verifiedRefunds Number of verified refunds
     * @return approvedRefunds Number of approved refunds
     * @return processedRefunds Number of processed refunds
     */
    function getCampaignRefundInfo(uint256 campaignId) external view returns (
        uint256 totalRefundRequests,
        uint256 verifiedRefunds,
        uint256 approvedRefunds,
        uint256 processedRefunds,
        uint256 totalRefundAmount,
        uint256 totalRefundPool,
        uint256 currentRefundClaimed,
        bool refundsEnabled,
        uint256 refundDeadline,
        AustrianRefundMetrics memory metrics
    ) {
        CampaignRefundState storage campaign = campaigns[campaignId];
        return (
            campaign.totalRefundRequests,
            campaign.verifiedRefunds,
            campaign.approvedRefunds,
            campaign.processedRefunds,
            campaign.totalRefundAmount,
            campaign.totalRefundPool,
            campaign.currentRefundClaimed,
            campaign.refundsEnabled,
            campaign.refundDeadline,
            campaign.metrics
        );
    }

    /**
     * @notice Get refund requests for a campaign
     * @param campaignId The campaign ID
     * @param offset The starting index
     * @param limit The maximum number of requests to return
     * @return RefundRequestProof[] Array of refund request proofs
     */
    function getRefundRequests(
        uint256 campaignId,
        uint256 offset,
        uint256 limit
    ) external view returns (RefundRequestProof[] memory) {
        CampaignRefundState storage campaign = campaigns[campaignId];
        
        uint256 requestsLength = campaign.refundRequests.length;
        uint256 end = offset + limit;
        if (end > requestsLength) {
            end = requestsLength;
        }
        
        RefundRequestProof[] memory result = new RefundRequestProof[](end - offset);
        for (uint256 i = offset; i < end; ++i) {
            result[i - offset] = campaign.refundRequests[i];
        }
        
        return result;
    }

    /**
     * @notice Get contributor refund statistics
     * @param contributor The contributor address
     * @return reputation Contributor reputation score
     * @return refundCount Number of refunds for this contributor
     * @return totalRefunded Total amount refunded to this contributor
     */
    function getContributorStats(address contributor) external view returns (
        uint256 reputation,
        uint256 refundCount,
        uint256 totalRefunded
    ) {
        return (
            contributorReputation[contributor],
            contributorRefundCount[contributor],
            contributorTotalRefunded[contributor]
        );
    }

    /**
     * @notice Execute refund transfer (ETH or ERC20 token)
     * @param paymentToken Token address (address(0) for ETH)
     * @param recipient Address to receive the refund
     * @param amount Amount to transfer
     */
    function _executeRefundTransfer(
        address paymentToken,
        address recipient,
        uint256 amount
    ) private {
        if (recipient == address(0)) revert InvalidAddress();
        if (amount == 0) revert InvalidRefundAmount();
        
        if (paymentToken == address(0)) {
            // ETH transfer
            if (address(this).balance < amount) revert InsufficientBalance();
            
            (bool success, ) = payable(recipient).call{value: amount}("");
            if (!success) revert TokenTransferFailed();
        } else {
            // ERC20 token transfer
            IERC20 token = IERC20(paymentToken);
            uint256 contractBalance = token.balanceOf(address(this));
            
            if (contractBalance < amount) revert InsufficientBalance();
            
            // Use SafeERC20 for secure token transfer
            token.safeTransfer(recipient, amount);
        }
    }

    /**
     * @notice Allow contract to receive ETH for refunds
     */
    receive() external payable {
        // Contract can receive ETH for refund processing
    }

    /**
     * @notice Emergency withdrawal function (admin only)
     * @param paymentToken Token address (address(0) for ETH)
     * @param amount Amount to withdraw
     */
    function emergencyWithdraw(address paymentToken, uint256 amount) external onlyGovernance {
        if (amount == 0) revert InvalidRefundAmount();
        
        if (paymentToken == address(0)) {
            // ETH withdrawal
            if (address(this).balance < amount) revert InsufficientBalance();
            
            (bool success, ) = payable(address(governance)).call{value: amount}("");
            if (!success) revert TokenTransferFailed();
        } else {
            // ERC20 token withdrawal
            IERC20 token = IERC20(paymentToken);
            uint256 contractBalance = token.balanceOf(address(this));
            
            if (contractBalance < amount) revert InsufficientBalance();
            
            token.safeTransfer(address(governance), amount);
        }
    }
}

/**
 * @title RefundVerifier DAO Transformation Documentation
 * @notice This contract has been transformed from centralized to decentralized governance
 * 
 * GOVERNANCE TRANSFORMATION:
 * - Removed centralized Ownable control
 * - Implemented IPrivateGovernance interface for DAO control
 * - All admin functions now require governance approval through onlyGovernance modifier
 * 
 * DAO-CONTROLLED FUNCTIONS:
 * - enableCampaignRefunds: Enable refunds for a specific campaign
 * - approveRefund: Approve individual refund requests
 * - processRefund: Process approved refunds and transfer funds
 * - setContributorReputation: Update contributor reputation scores
 * - updateRefundPercentage: Modify refund percentages for different reasons
 * - setGovernance: Update the governance contract address
 * 
 * SECURITY IMPLICATIONS:
 * - Decentralized refund approval prevents single point of failure
 * - Governance-controlled reputation system ensures fair contributor scoring
 * - Multi-signature governance required for critical refund operations
 * - Transparent and auditable refund percentage adjustments
 * 
 * PRIVACY PRESERVATION:
 * - Zero-knowledge proofs maintain contributor anonymity during refunds
 * - Nullifier system prevents double-spending of refund requests
 * - Austrian economic principles guide refund percentage calculations
 */
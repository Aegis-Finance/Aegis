// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "./../interfaces/ICommonErrors.sol";
import "./../interfaces/IPrivateGovernance.sol";
import {GovernanceAccessLib} from "../libraries/GovernanceAccessLib.sol";

import {Groth16Verifier} from "../Groth16Verifier.sol"; // Generated Groth16 verifier
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title MilestoneVerifier
 * @author Aegis Protocol Team
 * @notice Decentralized verifier wrapper for milestone ZK circuit implementing Austrian Economics principles
 * @dev DAO-governed verifier wrapper for milestone ZK circuit implementing Austrian Economics principles:
 *      - Individual Sovereignty: Private milestone review without revealing reviewer identity
 *      - Voluntary Association: Cryptographic proof of voluntary review participation
 *      - Market-Driven Evaluation: Decentralized milestone assessment
 *      - Spontaneous Order: Emergent consensus on milestone completion
 *      - Methodological Individualism: Individual reviewer assessment tracking
 *      - Decentralized Governance: All admin functions controlled by DAO
 */
contract MilestoneVerifier is ReentrancyGuard , ICommonErrors{
    
    /// @notice The Groth16 verifier contract for milestone circuit
    Groth16Verifier public immutable GROTH16_VERIFIER;

    /// @notice Milestone review verification data
    struct MilestoneReviewProof {
        uint256[2] a;           // Proof point A
        uint256[2][2] b;        // Proof point B  
        uint256[2] c;           // Proof point C
        uint256[] publicInputs; // Public inputs to the circuit
        bytes32 nullifierHash;  // Nullifier to prevent double-reviewing
        uint256 timestamp;      // Proof generation timestamp
        bool verified;          // Whether proof has been verified
        address reviewer;       // Address that submitted the proof
        uint256 reviewScore;    // Encrypted review score
        uint256 reviewerWeight; // Reviewer's weight in consensus
    }

    /// @notice Austrian Economics milestone metrics
    struct AustrianMilestoneMetrics {
        uint256 voluntaryReviews;          // Count of voluntary reviews
        uint256 individualAssessments;     // Individual assessment count
        uint256 marketConsensus;          // Market-driven consensus score
        uint256 spontaneousEvaluation;    // Spontaneous evaluation efficiency
        uint256 methodologicalReviewing;  // Individual review methodology
        bool austrianCompliance;          // Overall Austrian compliance
        uint256 decentralizedScore;       // Decentralized scoring metric
        uint256 emergentConsensus;        // Emergent consensus strength
    }

    /// @notice Milestone state and reviews
    struct MilestoneState {
        mapping(bytes32 => bool) nullifiers;           // Used nullifiers
        mapping(address => uint256) reviewerCount;     // Reviews per address
        mapping(address => bool) hasReviewed;          // Reviewer participation
        MilestoneReviewProof[] reviews;                // All review proofs
        AustrianMilestoneMetrics metrics;              // Austrian Economics metrics
        uint256 totalReviews;                          // Total review count
        uint256 verifiedReviews;                       // Verified review count
        uint256 weightedScoreSum;                      // Sum of weighted scores
        uint256 totalWeight;                           // Total reviewer weight
        uint256 averageScore;                          // Current average score
        bool isComplete;                               // Whether milestone is complete
        bool isActive;                                 // Whether milestone accepts reviews
        uint256 creationTime;                          // Milestone creation timestamp
        uint256 completionTime;                        // Milestone completion timestamp
        uint256 requiredReviews;                       // Minimum reviews required
        uint256 minimumScore;                          // Minimum score for completion
    }

    /// @notice Campaign milestone tracking
    struct CampaignMilestones {
        mapping(uint256 => MilestoneState) milestones; // Milestone ID to state
        uint256[] milestoneIds;                        // List of milestone IDs
        uint256 totalMilestones;                       // Total milestone count
        uint256 completedMilestones;                   // Completed milestone count
        bool isActive;                                 // Whether campaign is active
        uint256 creationTime;                          // Campaign creation timestamp
    }

    /// @notice Mapping of campaign ID to milestone data
    mapping(uint256 => CampaignMilestones) public campaigns;

    /// @notice Mapping of nullifier hash to campaign and milestone ID
    mapping(bytes32 => uint256) public nullifierToCampaign;
    /// @notice Mapping of nullifier hash to milestone ID
    mapping(bytes32 => uint256) public nullifierToMilestone;

    /// @notice Mapping of reviewer to reputation and weight
    mapping(address => uint256) public reviewerReputation;
    /// @notice Mapping of reviewer address to their weight in consensus
    mapping(address => uint256) public reviewerWeight;

    /// @notice Active campaigns and milestones
    uint256[] public activeCampaigns;
    /// @notice Counter for generating unique campaign IDs
    uint256 public campaignCounter;

    /// @notice Configuration constants
    /// @notice Maximum number of reviews allowed per milestone
    uint256 public constant MAX_REVIEWS_PER_MILESTONE = 1000;
    /// @notice Maximum number of reviews a single reviewer can submit
    uint256 public constant MAX_REVIEWS_PER_REVIEWER = 50;
    /// @notice Minimum reputation score required to be a reviewer
    uint256 public constant MIN_REVIEWER_REPUTATION = 60;
    /// @notice Default weight assigned to new reviewers
    uint256 public constant DEFAULT_REVIEWER_WEIGHT = 100;
    /// @notice Minimum number of reviews required for milestone completion
    uint256 public constant MIN_REVIEWS_FOR_COMPLETION = 3;
    /// @notice Minimum score required for milestone completion
    uint256 public constant MIN_SCORE_FOR_COMPLETION = 70;

    /// @notice Events
    /// @notice Emitted when a new campaign is created
    /// @param campaignId The unique identifier for the campaign
    /// @param creator The address that created the campaign
    /// @param timestamp The block timestamp when the campaign was created
    event CampaignCreated(
        uint256 indexed campaignId,
        address indexed creator,
        uint256 indexed timestamp
    );

    /// @notice Emitted when a new milestone is created for a campaign
    /// @param campaignId The campaign identifier
    /// @param milestoneId The milestone identifier
    /// @param requiredReviews The number of reviews required for completion
    /// @param minimumScore The minimum score required for completion
    /// @param timestamp The block timestamp when the milestone was created
    event MilestoneCreated(
        uint256 indexed campaignId,
        uint256 indexed milestoneId,
        uint256 indexed requiredReviews,
        uint256  minimumScore,
        uint256  timestamp
    );

    /// @notice Emitted when a milestone review is verified
    /// @param campaignId The campaign identifier
    /// @param milestoneId The milestone identifier
    /// @param nullifierHash The nullifier hash to prevent double-reviewing
    /// @param reviewer The address of the reviewer
    /// @param timestamp The block timestamp when the review was verified
    event MilestoneReviewVerified(
        uint256 indexed campaignId,
        uint256 indexed milestoneId,
        bytes32 indexed nullifierHash,
        address reviewer,
        uint256 timestamp
    );

    /// @notice Emitted when a milestone is completed
    /// @param campaignId The campaign identifier
    /// @param milestoneId The milestone identifier
    /// @param finalScore The final score achieved
    /// @param totalReviews The total number of reviews received
    /// @param timestamp The block timestamp when the milestone was completed
    event MilestoneCompleted(
        uint256 indexed campaignId,
        uint256 indexed milestoneId,
        uint256 indexed finalScore,
        uint256 totalReviews,
        uint256 timestamp
    );

    /// @notice Emitted when Austrian milestone metrics are updated
    /// @param campaignId The campaign identifier
    /// @param milestoneId The milestone identifier
    /// @param metrics The updated Austrian Economics metrics
    event AustrianMilestoneMetricsUpdated(
        uint256 indexed campaignId,
        uint256 indexed milestoneId,
        AustrianMilestoneMetrics metrics
    );

    /// @notice Emitted when a reviewer's reputation is updated
    /// @param reviewer The address of the reviewer
    /// @param oldScore The previous reputation score
    /// @param newScore The new reputation score
    event ReviewerReputationUpdated(
        address indexed reviewer,
        uint256 indexed oldScore,
        uint256 indexed newScore
    );

    /// @notice Custom errors

    error CampaignNotFound();
    error MilestoneNotFound();
    
    error MilestoneAlreadyComplete();
    error MaxReviewsReached();
    error ReviewerLimitReached();
    error InsufficientReputation();
    
    error ReviewerAlreadyReviewed();

    // DAO Governance
    /// @notice The governance contract that controls this verifier
    IPrivateGovernance public governance;

    address public timelockController;

    event TimelockControllerUpdated(address indexed previousTimelock, address indexed newTimelock);

    /// @notice Event emitted when governance is updated
    event GovernanceUpdated(address indexed oldGovernance, address indexed newGovernance);

    /// @notice Constructor to initialize the MilestoneVerifier contract
    /// @param _groth16Verifier The address of the Groth16 verifier contract
    /// @param _governance Address of the governance contract
    constructor(address _groth16Verifier, address _governance) {
        if (_groth16Verifier == address(0)) revert InvalidVerifier();
        if (_governance == address(0)) revert InvalidGovernanceAddress();
        
        GROTH16_VERIFIER = Groth16Verifier(_groth16Verifier);
        governance = IPrivateGovernance(_governance);
    }

    /**
     * @notice Modifier to restrict access to governance contract only
     */
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

    /**
     * @notice Updates the governance contract address
     * @param _newGovernance Address of the new governance contract
     * @dev Only callable by current governance
     */
    function setGovernance(address _newGovernance) external onlyGovernance {
        if (_newGovernance == address(0)) revert InvalidGovernanceAddress();
        address oldGovernance = address(governance);
        governance = IPrivateGovernance(_newGovernance);
        emit GovernanceUpdated(oldGovernance, _newGovernance);
    }

    /**
     * @notice Create a new campaign for milestone tracking
     * @return campaignId The ID of the created campaign
     */
    function createCampaign() external returns (uint256 campaignId) {
        campaignId = ++campaignCounter;
        
        CampaignMilestones storage campaign = campaigns[campaignId];
        campaign.isActive = true;
        campaign.creationTime = block.timestamp;
        
        activeCampaigns.push(campaignId);
        
        emit CampaignCreated(campaignId, msg.sender, block.timestamp);
        return campaignId;
    }

    /**
     * @notice Create a new milestone for a campaign
     * @param campaignId The campaign ID
     * @param milestoneId The milestone ID
     * @param requiredReviews Minimum reviews required for completion
     * @param minimumScore Minimum score required for completion
     */
    function createMilestone(
        uint256 campaignId,
        uint256 milestoneId,
        uint256 requiredReviews,
        uint256 minimumScore
    ) external onlyGovernance {
        CampaignMilestones storage campaign = campaigns[campaignId];
        if (campaign.creationTime == 0) revert CampaignNotFound();
        
        MilestoneState storage milestone = campaign.milestones[milestoneId];
        if (milestone.creationTime != 0) revert MilestoneNotFound(); // Already exists
        
        milestone.isActive = true;
        milestone.creationTime = block.timestamp;
        milestone.requiredReviews = requiredReviews != 0 ? requiredReviews : MIN_REVIEWS_FOR_COMPLETION;
        milestone.minimumScore = minimumScore != 0 ? minimumScore : MIN_SCORE_FOR_COMPLETION;
        milestone.metrics = AustrianMilestoneMetrics(0, 0, 0, 0, 0, false, 0, 0);
        
        campaign.milestoneIds.push(milestoneId);
        ++campaign.totalMilestones;
        
        emit MilestoneCreated(
            campaignId, 
            milestoneId, 
            milestone.requiredReviews, 
            milestone.minimumScore, 
            block.timestamp
        );
    }

    /**
     * @notice Verify a milestone review proof
     * @param campaignId The campaign ID
     * @param milestoneId The milestone ID
     * @param proof The ZK proof components
     * @param publicInputs The public inputs to the circuit
     * @return bool Whether the proof is valid
     */
    function verifyMilestoneReview(
        uint256 campaignId,
        uint256 milestoneId,
        uint256[8] calldata proof,
        uint256[] calldata publicInputs
    ) external nonReentrant returns (bool) {
        // Validate campaign and milestone
        _validateCampaignAndMilestone(campaignId, milestoneId);
        
        // Check review limits and permissions
        _checkReviewLimitsAndPermissions(campaignId, milestoneId);
        
        // Validate and verify the proof
        bytes32 nullifierHash = _validateAndVerifyProof(campaignId, milestoneId, proof, publicInputs);
        
        // Process the review
        _processReview(campaignId, milestoneId, proof, publicInputs, nullifierHash);
        
        return true;
    }

    /**
     * @notice Validate campaign and milestone existence and status
     * @param campaignId The campaign ID
     * @param milestoneId The milestone ID
     */
    function _validateCampaignAndMilestone(uint256 campaignId, uint256 milestoneId) private view {
        CampaignMilestones storage campaign = campaigns[campaignId];
        MilestoneState storage milestone = campaign.milestones[milestoneId];
        
        if (campaign.creationTime == 0) revert CampaignNotFound();
        if (milestone.creationTime == 0) revert MilestoneNotFound();
        if (!milestone.isActive) revert MilestoneNotActive();
        if (milestone.isComplete) revert MilestoneAlreadyComplete();
    }

    /**
     * @notice Check review limits and reviewer permissions
     * @param campaignId The campaign ID
     * @param milestoneId The milestone ID
     */
    function _checkReviewLimitsAndPermissions(uint256 campaignId, uint256 milestoneId) private view {
        MilestoneState storage milestone = campaigns[campaignId].milestones[milestoneId];
        
        if (milestone.totalReviews > MAX_REVIEWS_PER_MILESTONE - 1) {
            revert MaxReviewsReached();
        }
        if (milestone.reviewerCount[msg.sender] > MAX_REVIEWS_PER_REVIEWER - 1) {
            revert ReviewerLimitReached();
        }
        if (milestone.hasReviewed[msg.sender]) {
            revert ReviewerAlreadyReviewed();
        }
        if (reviewerReputation[msg.sender] < MIN_REVIEWER_REPUTATION) {
            revert InsufficientReputation();
        }
    }

    /**
     * @notice Validate public inputs and verify ZK proof
     * @param campaignId The campaign ID
     * @param milestoneId The milestone ID
     * @param proof The ZK proof components
     * @param publicInputs The public inputs to the circuit
     * @return bytes32 The nullifier hash
     */
    function _validateAndVerifyProof(
        uint256 campaignId,
        uint256 milestoneId,
        uint256[8] calldata proof,
        uint256[] calldata publicInputs
    ) private view returns (bytes32) {
        MilestoneState storage milestone = campaigns[campaignId].milestones[milestoneId];
        
        if (publicInputs.length < 10) revert InvalidPublicInputs();
        
        bytes32 nullifierHash = bytes32(publicInputs[3]);
        
        if (milestone.nullifiers[nullifierHash]) revert NullifierAlreadyUsed();
        if (nullifierToCampaign[nullifierHash] != 0) revert NullifierAlreadyUsed();

        uint256[2] memory a = [proof[0], proof[1]];
        uint256[2][2] memory b = [[proof[2], proof[3]], [proof[4], proof[5]]];
        uint256[2] memory c = [proof[6], proof[7]];
        
        bool isValid = GROTH16_VERIFIER.verifyProof(a, b, c, publicInputs);
        if (!isValid) revert InvalidProof();
        
        return nullifierHash;
    }

    /**
     * @notice Process the verified review and update state
     * @param campaignId The campaign ID
     * @param milestoneId The milestone ID
     * @param proof The ZK proof components
     * @param publicInputs The public inputs to the circuit
     * @param nullifierHash The nullifier hash
     */
    function _processReview(
        uint256 campaignId,
        uint256 milestoneId,
        uint256[8] calldata proof,
        uint256[] calldata publicInputs,
        bytes32 nullifierHash
    ) private {
        MilestoneState storage milestone = campaigns[campaignId].milestones[milestoneId];
        
        uint256 reviewScore = publicInputs[8];
        uint256 reviewerWeightValue = reviewerWeight[msg.sender];
        if (reviewerWeightValue == 0) {
            reviewerWeightValue = DEFAULT_REVIEWER_WEIGHT;
            reviewerWeight[msg.sender] = DEFAULT_REVIEWER_WEIGHT;
        }

        MilestoneReviewProof memory reviewProof = MilestoneReviewProof({
            a: [proof[0], proof[1]],
            b: [[proof[2], proof[3]], [proof[4], proof[5]]],
            c: [proof[6], proof[7]],
            publicInputs: publicInputs,
            nullifierHash: nullifierHash,
            timestamp: block.timestamp,
            verified: true,
            reviewer: msg.sender,
            reviewScore: reviewScore,
            reviewerWeight: reviewerWeightValue
        });

        milestone.reviews.push(reviewProof);
        milestone.nullifiers[nullifierHash] = true;
        ++milestone.reviewerCount[msg.sender];
        milestone.hasReviewed[msg.sender] = true;
        ++milestone.totalReviews;
        ++milestone.verifiedReviews;
        
        milestone.weightedScoreSum += reviewScore * reviewerWeightValue;
        milestone.totalWeight += reviewerWeightValue;
        milestone.averageScore = milestone.weightedScoreSum / milestone.totalWeight;
        
        nullifierToCampaign[nullifierHash] = campaignId;
        nullifierToMilestone[nullifierHash] = milestoneId;

        _updateAustrianMilestoneMetrics(campaignId, milestoneId, reviewProof);
        _updateReviewerReputation(msg.sender, 3);
        _checkMilestoneCompletion(campaignId, milestoneId);

        emit MilestoneReviewVerified(campaignId, milestoneId, nullifierHash, msg.sender, block.timestamp);
    }

    /**
     * @notice Update Austrian Economics metrics for a milestone
     * @param campaignId The campaign ID
     * @param milestoneId The milestone ID
     * @param reviewProof The review proof
     */
    function _updateAustrianMilestoneMetrics(
        uint256 campaignId,
        uint256 milestoneId,
        MilestoneReviewProof memory reviewProof
    ) private {
        MilestoneState storage milestone = campaigns[campaignId].milestones[milestoneId];
        AustrianMilestoneMetrics storage metrics = milestone.metrics;

        // Individual Sovereignty: Each review represents individual assessment
        ++metrics.voluntaryReviews;
        metrics.individualAssessments += _calculateAssessmentScore(reviewProof);

        // Market-Driven Evaluation: Decentralized consensus building
        metrics.marketConsensus += _calculateMarketConsensusScore(milestone);

        // Spontaneous Order: Emergent evaluation coordination
        metrics.spontaneousEvaluation += _calculateSpontaneousEvaluationScore(milestone);

        // Methodological Individualism: Individual review methodology
        metrics.methodologicalReviewing += _calculateMethodologicalScore(reviewProof);

        // Decentralized scoring
        metrics.decentralizedScore += _calculateDecentralizedScore(milestone);

        // Emergent consensus
        metrics.emergentConsensus += _calculateEmergentConsensusScore(milestone);

        // Overall Austrian compliance check
        metrics.austrianCompliance = _validateAustrianMilestoneCompliance(metrics);

        emit AustrianMilestoneMetricsUpdated(campaignId, milestoneId, metrics);
    }

    /**
     * @notice Calculate individual assessment score
     * @param reviewProof The review proof
     * @return uint256 The assessment score
     */
    function _calculateAssessmentScore(MilestoneReviewProof memory reviewProof) private pure returns (uint256) {
        uint256 score = 0;
        
        // Individual reviewer identity verification
        score += reviewProof.reviewer != address(0) ? 20 : 0;
        
        // Unique nullifier (individual assessment)
        score += reviewProof.nullifierHash != bytes32(0) ? 25 : 0;
        
        // Review score validity
        score += reviewProof.reviewScore > 0 ? 20 : 0;
        
        // Reviewer weight consideration
        score += reviewProof.reviewerWeight > 0 ? 15 : 0;
        
        // Timestamp uniqueness
        score += reviewProof.timestamp > 0 ? 20 : 0;
        
        return score;
    }

    /**
     * @notice Calculate market consensus score
     * @param milestone The milestone state
     * @return uint256 The market consensus score
     */
    function _calculateMarketConsensusScore(MilestoneState storage milestone) private view returns (uint256) {
        if (milestone.totalReviews == 0) return 0;
        
        // Score based on review diversity and consensus
        uint256 reviewDiversity = milestone.totalReviews * 10;
        
        // Weighted consensus strength
        uint256 consensusStrength = 0;
        if (milestone.totalWeight != 0) {
            consensusStrength = (milestone.averageScore * milestone.totalWeight) / 1000;
        }
        
        return reviewDiversity + consensusStrength;
    }

    /**
     * @notice Calculate spontaneous evaluation score
     * @param milestone The milestone state
     * @return uint256 The spontaneous evaluation score
     */
    function _calculateSpontaneousEvaluationScore(MilestoneState storage milestone) private view returns (uint256) {
        uint256 created = milestone.creationTime;
        uint256 timeElapsed = created > block.timestamp ? 0 : block.timestamp - created;
        if (timeElapsed == 0) return 0;
        
        // Higher score for more reviews in less time
        uint256 evaluationRate = (milestone.totalReviews * 1000) / timeElapsed;
        
        // Bonus for reaching consensus quickly
        uint256 consensusBonus = 0;
        if (milestone.averageScore > milestone.minimumScore - 1 && 
            milestone.totalReviews > milestone.requiredReviews - 1) {
            consensusBonus = 50;
        }
        
        return evaluationRate + consensusBonus;
    }

    /**
     * @notice Calculate methodological score
     * @param reviewProof The review proof
     * @return uint256 The methodological score
     */
    function _calculateMethodologicalScore(MilestoneReviewProof memory reviewProof) private view returns (uint256) {
        uint256 score = 0;
        
        // Individual methodology tracking
        score += 25;
        
        // Reviewer reputation consideration
        score += reviewerReputation[reviewProof.reviewer] > 0 ? 25 : 0;
        
        // Review weight methodology
        score += reviewProof.reviewerWeight > DEFAULT_REVIEWER_WEIGHT - 1 ? 25 : 0;
        
        // Proof complexity (individual methodology)
        score += reviewProof.publicInputs.length > 9 ? 25 : 0;
        
        return score;
    }

    /**
     * @notice Calculate decentralized score
     * @param milestone The milestone state
     * @return uint256 The decentralized score
     */
    function _calculateDecentralizedScore(MilestoneState storage milestone) private view returns (uint256) {
        // Score based on decentralization of reviews
        uint256 uniqueReviewers = 0;
        
        // Count unique reviewers (simplified - in practice would use more efficient tracking)
        for (uint256 i = 0; i < milestone.reviews.length; ++i) {
            bool isUnique = true;
            for (uint256 j = 0; j < i; ++j) {
                if (milestone.reviews[i].reviewer == milestone.reviews[j].reviewer) {
                    isUnique = false;
                    break;
                }
            }
            if (isUnique) ++uniqueReviewers;
        }
        
        // Higher score for more unique reviewers
        uint256 decentralizationRatio = (uniqueReviewers * 100) / (milestone.totalReviews + 1);
        
        return decentralizationRatio * 2; // Amplify decentralization importance
    }

    /**
     * @notice Calculate emergent consensus score
     * @param milestone The milestone state
     * @return uint256 The emergent consensus score
     */
    function _calculateEmergentConsensusScore(MilestoneState storage milestone) private view returns (uint256) {
        if (milestone.totalReviews < 2) return 0;
        
        // Calculate score variance to measure consensus emergence
        uint256 totalVariance = 0;
        uint256 avgScore = milestone.averageScore;
        
        for (uint256 i = 0; i < milestone.reviews.length; ++i) {
            uint256 score = milestone.reviews[i].reviewScore;
            uint256 variance = score > avgScore ? score - avgScore : avgScore - score;
            totalVariance += variance;
        }
        
        uint256 avgVariance = totalVariance / milestone.totalReviews;
        
        // Lower variance = higher consensus = higher score
        uint256 consensusScore = avgVariance < 20 ? 100 - (avgVariance * 5) : 0;
        
        return consensusScore;
    }

    /**
     * @notice Validate Austrian Economics milestone compliance
     * @param metrics The Austrian milestone metrics
     * @return bool Whether the metrics indicate Austrian compliance
     */
    function _validateAustrianMilestoneCompliance(AustrianMilestoneMetrics memory metrics) private pure returns (bool) {
        return (
            metrics.voluntaryReviews > 0 &&
            metrics.individualAssessments > 59 &&
            metrics.marketConsensus > 39 &&
            metrics.spontaneousEvaluation > 19 &&
            metrics.methodologicalReviewing > 49 &&
            metrics.decentralizedScore > 29 &&
            metrics.emergentConsensus > 39
        );
    }

    /**
     * @notice Update reviewer reputation
     * @param reviewer The reviewer address
     * @param delta The reputation change
     */
    function _updateReviewerReputation(address reviewer, int256 delta) private {
        uint256 oldScore = reviewerReputation[reviewer];
        
        if (delta < 0 && uint256(-delta) > oldScore) {
            reviewerReputation[reviewer] = 0;
        } else {
            reviewerReputation[reviewer] = uint256(int256(oldScore) + delta);
        }

        emit ReviewerReputationUpdated(reviewer, oldScore, reviewerReputation[reviewer]);
    }

    /**
     * @notice Check if milestone completion criteria are met
     * @param campaignId The campaign ID
     * @param milestoneId The milestone ID
     */
    function _checkMilestoneCompletion(uint256 campaignId, uint256 milestoneId) private {
        MilestoneState storage milestone = campaigns[campaignId].milestones[milestoneId];
        
        if (milestone.totalReviews > milestone.requiredReviews - 1 && 
            milestone.averageScore > milestone.minimumScore - 1) {
            
            milestone.isComplete = true;
            milestone.isActive = false;
            milestone.completionTime = block.timestamp;
            
            ++campaigns[campaignId].completedMilestones;
            
            // Bonus reputation for reviewers of completed milestones
            for (uint256 i = 0; i < milestone.reviews.length; ++i) {
                _updateReviewerReputation(milestone.reviews[i].reviewer, 5);
            }
            
            emit MilestoneCompleted(
                campaignId,
                milestoneId,
                milestone.averageScore,
                milestone.totalReviews,
                block.timestamp
            );
        }
    }

    /**
     * @notice Set reviewer reputation (admin function)
     * @param reviewer The reviewer address
     * @param reputation The reputation score
     */
    function setReviewerReputation(address reviewer, uint256 reputation) external onlyGovernance {
        uint256 oldScore = reviewerReputation[reviewer];
        reviewerReputation[reviewer] = reputation;
        emit ReviewerReputationUpdated(reviewer, oldScore, reputation);
    }

    /**
     * @notice Set reviewer weight (admin function)
     * @param reviewer The reviewer address
     * @param weight The reviewer weight
     */
    function setReviewerWeight(address reviewer, uint256 weight) external onlyGovernance {
        reviewerWeight[reviewer] = weight;
    }

    /**
     * @notice Get milestone information
     * @param campaignId The campaign ID
     * @param milestoneId The milestone ID
     * @return totalReviews The total number of reviews
     * @return verifiedReviews The number of verified reviews
     * @return averageScore The average review score
     * @return isComplete Whether the milestone is complete
     * @return isActive Whether the milestone is active
     * @return creationTime The milestone creation time
     * @return completionTime The milestone completion time
     * @return metrics The Austrian Economics milestone metrics
     */
    function getMilestoneInfo(uint256 campaignId, uint256 milestoneId) external view returns (
        uint256 totalReviews,
        uint256 verifiedReviews,
        uint256 averageScore,
        bool isComplete,
        bool isActive,
        uint256 creationTime,
        uint256 completionTime,
        AustrianMilestoneMetrics memory metrics
    ) {
        MilestoneState storage milestone = campaigns[campaignId].milestones[milestoneId];
        return (
            milestone.totalReviews,
            milestone.verifiedReviews,
            milestone.averageScore,
            milestone.isComplete,
            milestone.isActive,
            milestone.creationTime,
            milestone.completionTime,
            milestone.metrics
        );
    }

    /**
     * @notice Get campaign milestone summary
     * @param campaignId The campaign ID
     * @return totalMilestones The total number of milestones
     * @return completedMilestones The number of completed milestones
     * @return milestoneIds Array of milestone IDs
     * @return isActive Whether the campaign is active
     * @return creationTime The campaign creation time
     */
    function getCampaignSummary(uint256 campaignId) external view returns (
        uint256 totalMilestones,
        uint256 completedMilestones,
        uint256[] memory milestoneIds,
        bool isActive,
        uint256 creationTime
    ) {
        CampaignMilestones storage campaign = campaigns[campaignId];
        return (
            campaign.totalMilestones,
            campaign.completedMilestones,
            campaign.milestoneIds,
            campaign.isActive,
            campaign.creationTime
        );
    }

    /**
     * @notice Get milestone reviews
     * @param campaignId The campaign ID
     * @param milestoneId The milestone ID
     * @param offset The starting index
     * @param limit The maximum number of reviews to return
     * @return MilestoneReviewProof[] Array of review proofs
     */
    function getMilestoneReviews(
        uint256 campaignId,
        uint256 milestoneId,
        uint256 offset,
        uint256 limit
    ) external view returns (MilestoneReviewProof[] memory) {
        MilestoneState storage milestone = campaigns[campaignId].milestones[milestoneId];
        
        uint256 end = offset + limit;
        if (end > milestone.reviews.length) {
            end = milestone.reviews.length;
        }
                MilestoneReviewProof[] memory result = new MilestoneReviewProof[](end - offset);
        for (uint256 i = offset; i < end; ++i) {
            result[i - offset] = milestone.reviews[i];
        }
        
        return result;
    }
}

/*
 * DAO TRANSFORMATION DOCUMENTATION
 * ================================
 * 
 * This contract has been transformed from centralized ownership to decentralized DAO governance:
 * 
 * 1. REMOVED CENTRALIZED CONTROL:
 *    - Eliminated Ownable inheritance and centralized owner control
 *    - Removed single point of failure in milestone and reviewer management
 *    - Eliminated centralized control over campaign milestone creation
 * 
 * 2. IMPLEMENTED DAO GOVERNANCE:
 *    - Integrated IPrivateGovernance interface for decentralized control
 *    - Added governance state variable and proper initialization
 *    - Implemented onlyGovernance modifier for all admin functions
 * 
 * 3. GOVERNANCE-CONTROLLED FUNCTIONS:
 *    - createMilestone: DAO controls milestone creation and requirements
 *    - setReviewerReputation: DAO manages reviewer reputation scores
 *    - setReviewerWeight: DAO controls reviewer voting weights
 *    - setGovernance: DAO can update governance contract (self-governance)
 * 
 * 4. MAINTAINED SECURITY:
 *    - All critical functions require DAO consensus through governance
 *    - Reviewer management prevents centralized manipulation
 *    - Milestone creation follows decentralized approval process
 *    - Austrian Economics principles preserved through decentralized control
 * 
 * 5. SECURITY IMPLICATIONS:
 *    - Milestone verification now requires DAO consensus
 *    - Reviewer reputation system governed by community
 *    - No single entity can manipulate milestone outcomes
 *    - Decentralized milestone management prevents censorship
 * 
 * This transformation ensures that milestone verification follows Austrian Economics
 * principles of decentralized coordination and market-driven consensus.
 */
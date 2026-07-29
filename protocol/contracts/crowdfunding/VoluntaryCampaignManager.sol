// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {ICommonErrors} from "../interfaces/ICommonErrors.sol";
import {AegisCrowdShield} from "./AegisCrowdShield.sol";

/**
 * @title VoluntaryCampaignManager
 * @author Aegis Protocol Team
 * @notice Manages campaign lifecycle with Austrian Economics principles
 * @dev Manages campaign lifecycle with Austrian Economics principles:
 *      - Voluntary Association: Optional milestone tracking and management
 *      - Spontaneous Order: Emergent campaign organization patterns
 *      - Individual Sovereignty: Creator autonomy over campaign management
 *      - Market-Driven Coordination: Peer-to-peer milestone verification
 */
contract VoluntaryCampaignManager is ReentrancyGuard, ICommonErrors {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    struct MilestoneDefinition {
        bytes32 descriptionHash;        // IPFS hash of milestone description
        uint256 targetAmount;           // Funding required for this milestone
        uint256 deadline;              // Milestone completion deadline
        bytes32 deliverableHash;       // IPFS hash of expected deliverables
        bool isOptional;               // Whether milestone is optional
        uint256 voterThreshold;        // Minimum voters for milestone approval
        MilestoneStatus status;        // Current milestone status
    }

    struct MilestoneEvidence {
        bytes32 evidenceHash;          // IPFS hash of completion evidence
        uint256 submissionTime;        // When evidence was submitted
        address submitter;             // Who submitted the evidence
        uint256 approvalVotes;         // Number of approval votes
        uint256 rejectionVotes;        // Number of rejection votes
        mapping(address => bool) hasVoted; // Track who has voted
        mapping(address => bool) voteChoice; // Track vote choices
    }

    struct VoluntaryMilestoneConfig {
        bool enableMilestoneTracking;   // Whether to use milestone system
        bool enablePeerReview;          // Peer-to-peer milestone verification
        bool enableAutomaticRelease;    // Automatic fund release on approval
        bool enableCreatorOverride;     // Creator can override milestone failures
        uint256 reviewPeriod;          // Time allowed for peer review
        uint256 minimumReviewers;      // Minimum number of reviewers required
    }

    struct CampaignManagement {
        uint256 campaignId;            // Associated campaign ID
        address creator;               // Campaign creator
        VoluntaryMilestoneConfig config; // Milestone configuration
        uint256[] milestoneIds;        // List of milestone IDs
        uint256 currentMilestone;      // Currently active milestone
        uint256 totalMilestones;       // Total number of milestones
        bool isActive;                 // Whether management is active
        bytes32 managementHash;        // Hash of management parameters
    }

    enum MilestoneStatus {
        Pending,        // Waiting for funding or previous milestone
        Active,         // Currently accepting work
        Submitted,      // Evidence submitted, under review
        Approved,       // Approved by reviewers
        Rejected,       // Rejected by reviewers
        Completed,      // Funds released, milestone complete
        Cancelled       // Milestone cancelled
    }

    // State Variables
    /// @notice The main CrowdShield contract for campaign management
    AegisCrowdShield public immutable CROWD_SHIELD;
    
    /// @notice Maps campaign IDs to their management configurations
    mapping(uint256 => CampaignManagement) public campaignManagement;
    /// @notice Maps milestone IDs to their definitions
    mapping(uint256 => MilestoneDefinition) public milestones;
    /// @notice Maps milestone IDs to their submitted evidence
    mapping(uint256 => MilestoneEvidence) public milestoneEvidence;
    /// @notice Maps milestone IDs to reviewer addresses for tracking who can review
    mapping(uint256 => mapping(address => bool)) public milestoneReviewers;
    /// @notice Maps creator addresses to their managed campaign IDs
    mapping(address => uint256[]) public creatorManagedCampaigns;
    /// @notice Maps reviewer addresses to milestone IDs they are reviewing
    mapping(address => uint256[]) public reviewerMilestones;
    
    /// @notice Counter for generating unique milestone IDs
    uint256 public nextMilestoneId = 1;
    
    // Austrian Economics Parameters
    uint256 public constant MINIMUM_REVIEW_PERIOD = 3 days;
    uint256 public constant MAXIMUM_REVIEW_PERIOD = 30 days;
    uint256 public constant MINIMUM_REVIEWERS = 3;
    uint256 public constant MAXIMUM_REVIEWERS = 21;
    uint256 public constant REVIEWER_REWARD_PERCENTAGE = 1; // 1% of milestone amount

    // Custom Errors

    // Events
    event CampaignManagementCreated(
        uint256 indexed campaignId,
        address indexed creator,
        VoluntaryMilestoneConfig config
    );
    
    event MilestoneCreated(
        uint256 indexed milestoneId,
        uint256 indexed campaignId,
        uint256 targetAmount,
        uint256 deadline,
        bool isOptional
    );
    
    event MilestoneActivated(uint256 indexed milestoneId, uint256 indexed campaignId);
    
    event MilestoneEvidenceSubmitted(
        uint256 indexed milestoneId,
        address indexed submitter,
        bytes32 evidenceHash
    );
    
    event MilestoneReviewed(
        uint256 indexed milestoneId,
        address indexed reviewer,
        bool approved
    );
    
    event MilestoneApproved(
        uint256 indexed milestoneId,
        uint256 approvalVotes,
        uint256 rejectionVotes
    );
    
    event MilestoneRejected(
        uint256 indexed milestoneId,
        uint256 approvalVotes,
        uint256 rejectionVotes
    );
    
    event MilestoneCompleted(uint256 indexed milestoneId, uint256 amountReleased);
    
    event ReviewerRegistered(uint256 indexed milestoneId, address indexed reviewer);

    // Modifiers
    modifier onlyCampaignCreator(uint256 campaignId) {
        if (campaignManagement[campaignId].creator != msg.sender) revert ICommonErrors.NotCampaignCreator();
        _;
    }
    
    modifier campaignManagementExists(uint256 campaignId) {
        if (!campaignManagement[campaignId].isActive) revert CampaignManagementNotActive();
        _;
    }
    
    modifier milestoneExists(uint256 milestoneId) {
        if (milestones[milestoneId].deadline == 0) revert MilestoneDoesNotExist();
        _;
    }

    constructor(address _crowdShield) {
        if (_crowdShield == address(0)) revert InvalidCrowdShieldAddress();
        CROWD_SHIELD = AegisCrowdShield(_crowdShield);
    }

    /**
     * @dev Create voluntary campaign management with milestone tracking
     * @param campaignId Associated campaign ID
     * @param config Milestone configuration
     * @param managementHash Hash of management parameters
     */
    function createCampaignManagement(
        uint256 campaignId,
        VoluntaryMilestoneConfig memory config,
        bytes32 managementHash
    ) external nonReentrant {
        // Verify campaign exists and caller is creator
        AegisCrowdShield.CampaignSovereignty memory campaign = CROWD_SHIELD.getCampaign(campaignId);
        if (campaign.creator != msg.sender) revert ICommonErrors.NotCampaignCreator();
        if (campaignManagement[campaignId].isActive) revert ManagementAlreadyExists();
        
        // Validate configuration
        if (config.reviewPeriod < MINIMUM_REVIEW_PERIOD || 
            config.reviewPeriod > MAXIMUM_REVIEW_PERIOD) {
            revert InvalidMilestoneConfiguration();
        }
        if (config.minimumReviewers < MINIMUM_REVIEWERS || 
            config.minimumReviewers > MAXIMUM_REVIEWERS) {
            revert InvalidMilestoneConfiguration();
        }

        campaignManagement[campaignId] = CampaignManagement({
            campaignId: campaignId,
            creator: msg.sender,
            config: config,
            milestoneIds: new uint256[](0),
            currentMilestone: 0,
            totalMilestones: 0,
            isActive: true,
            managementHash: managementHash
        });

        creatorManagedCampaigns[msg.sender].push(campaignId);

        emit CampaignManagementCreated(campaignId, msg.sender, config);
    }

    /**
     * @dev Add a milestone to a campaign (Austrian Economics: Voluntary structure)
     * @param campaignId Campaign to add milestone to
     * @param descriptionHash IPFS hash of milestone description
     * @param targetAmount Funding required for milestone
     * @param duration Milestone duration in seconds
     * @param deliverableHash IPFS hash of expected deliverables
     * @param isOptional Whether milestone is optional
     * @param voterThreshold Minimum voters for approval
     */
    function addMilestone(
        uint256 campaignId,
        bytes32 descriptionHash,
        uint256 targetAmount,
        uint256 duration,
        bytes32 deliverableHash,
        bool isOptional,
        uint256 voterThreshold
    ) external nonReentrant onlyCampaignCreator(campaignId) campaignManagementExists(campaignId) {
        if (descriptionHash == bytes32(0)) revert InvalidDescriptionHash();
        if (targetAmount == 0) revert InvalidTargetAmount();
        if (duration == 0) revert InvalidDuration();
        if (deliverableHash == bytes32(0)) revert InvalidDeliverableHash();
        if (voterThreshold < MINIMUM_REVIEWERS) revert InsufficientVoterThreshold();

        uint256 milestoneId = nextMilestoneId++;
        uint256 deadline = block.timestamp + duration;

        milestones[milestoneId] = MilestoneDefinition({
            descriptionHash: descriptionHash,
            targetAmount: targetAmount,
            deadline: deadline,
            deliverableHash: deliverableHash,
            isOptional: isOptional,
            voterThreshold: voterThreshold,
            status: MilestoneStatus.Pending
        });

        campaignManagement[campaignId].milestoneIds.push(milestoneId);
        campaignManagement[campaignId].totalMilestones++;

        emit MilestoneCreated(milestoneId, campaignId, targetAmount, deadline, isOptional);
    }

    /**
     * @dev Activate the next milestone in sequence
     * @param campaignId Campaign to activate milestone for
     */
    function activateNextMilestone(uint256 campaignId) 
        external 
        nonReentrant 
        onlyCampaignCreator(campaignId) 
        campaignManagementExists(campaignId) 
    {
        CampaignManagement storage management = campaignManagement[campaignId];
        if (management.currentMilestone >= management.totalMilestones) revert NoMoreMilestones();

        uint256 milestoneId = management.milestoneIds[management.currentMilestone];
        MilestoneDefinition storage milestone = milestones[milestoneId];
        
        if (milestone.status != MilestoneStatus.Pending) revert MilestoneNotPending();
        
        // Check if campaign has sufficient funding for this milestone
        AegisCrowdShield.CampaignSovereignty memory campaign = CROWD_SHIELD.getCampaign(campaignId);
        if (campaign.totalRaised < milestone.targetAmount) revert InsufficientFundingForMilestone();

        milestone.status = MilestoneStatus.Active;
        management.currentMilestone++;

        emit MilestoneActivated(milestoneId, campaignId);
    }

    /**
     * @dev Submit evidence of milestone completion
     * @param milestoneId Milestone to submit evidence for
     * @param evidenceHash IPFS hash of completion evidence
     */
    function submitMilestoneEvidence(uint256 milestoneId, bytes32 evidenceHash) 
        external 
        nonReentrant 
        milestoneExists(milestoneId) 
    {
        MilestoneDefinition storage milestone = milestones[milestoneId];
        if (milestone.status != MilestoneStatus.Active) revert MilestoneNotActive();
        if (block.timestamp > milestone.deadline) revert MilestoneDeadlinePassed();
        if (evidenceHash == bytes32(0)) revert InvalidEvidenceHash();

        // Find the campaign for this milestone
        uint256 campaignId = _findCampaignForMilestone(milestoneId);
        if (campaignManagement[campaignId].creator != msg.sender) revert ICommonErrors.NotCampaignCreator();

        milestone.status = MilestoneStatus.Submitted;
        
        milestoneEvidence[milestoneId].evidenceHash = evidenceHash;
        milestoneEvidence[milestoneId].submissionTime = block.timestamp;
        milestoneEvidence[milestoneId].submitter = msg.sender;

        emit MilestoneEvidenceSubmitted(milestoneId, msg.sender, evidenceHash);
    }

    /**
     * @dev Register as a voluntary reviewer for a milestone
     * @param milestoneId Milestone to review
     */
    function registerAsReviewer(uint256 milestoneId) 
        external 
        nonReentrant 
        milestoneExists(milestoneId) 
    {
        MilestoneDefinition storage milestone = milestones[milestoneId];
        if (milestone.status != MilestoneStatus.Submitted) revert MilestoneNotSubmitted();
        if (milestoneReviewers[milestoneId][msg.sender]) revert AlreadyRegisteredAsReviewer();

        // Austrian Economics: Voluntary participation with economic stake
        uint256 campaignId = _findCampaignForMilestone(milestoneId);
        AegisCrowdShield.ContributorSovereignty memory contribution = 
            CROWD_SHIELD.getContribution(campaignId, msg.sender);
        if (contribution.amount == 0) revert MustBeContributorToReview();

        milestoneReviewers[milestoneId][msg.sender] = true;
        reviewerMilestones[msg.sender].push(milestoneId);

        emit ReviewerRegistered(milestoneId, msg.sender);
    }

    /**
     * @dev Review milestone evidence and vote on approval
     * @param milestoneId Milestone to review
     * @param approve Whether to approve the milestone
     */
    function reviewMilestone(uint256 milestoneId, bool approve) 
        external 
        nonReentrant 
        milestoneExists(milestoneId) 
    {
        MilestoneDefinition storage milestone = milestones[milestoneId];
        if (milestone.status != MilestoneStatus.Submitted) revert MilestoneNotSubmitted();
        if (!milestoneReviewers[milestoneId][msg.sender]) revert NotRegisteredAsReviewer();
        
        MilestoneEvidence storage evidence = milestoneEvidence[milestoneId];
        if (evidence.hasVoted[msg.sender]) revert AlreadyVoted();

        // Check review period
        uint256 campaignId = _findCampaignForMilestone(milestoneId);
        CampaignManagement storage management = campaignManagement[campaignId];
        if (block.timestamp > evidence.submissionTime + management.config.reviewPeriod) {
            revert MilestoneDeadlinePassed();
        }

        evidence.hasVoted[msg.sender] = true;
        evidence.voteChoice[msg.sender] = approve;

        if (approve) {
            evidence.approvalVotes++;
        } else {
            evidence.rejectionVotes++;
        }

        emit MilestoneReviewed(milestoneId, msg.sender, approve);

        // Check if we have enough votes to make a decision
        uint256 totalVotes = evidence.approvalVotes + evidence.rejectionVotes;
        if (totalVotes >= milestone.voterThreshold) {
            _finalizeMilestoneReview(milestoneId);
        }
    }

    /**
     * @dev Finalize milestone review and update status
     * @param milestoneId Milestone to finalize
     */
    function _finalizeMilestoneReview(uint256 milestoneId) internal {
        MilestoneDefinition storage milestone = milestones[milestoneId];
        MilestoneEvidence storage evidence = milestoneEvidence[milestoneId];

        bool approved = evidence.approvalVotes > evidence.rejectionVotes;

        if (approved) {
            milestone.status = MilestoneStatus.Approved;
            emit MilestoneApproved(milestoneId, evidence.approvalVotes, evidence.rejectionVotes);
            
            // Auto-release funds if configured
            uint256 campaignId = _findCampaignForMilestone(milestoneId);
            if (campaignManagement[campaignId].config.enableAutomaticRelease) {
                _releaseMilestoneFunds(milestoneId);
            }
        } else {
            milestone.status = MilestoneStatus.Rejected;
            emit MilestoneRejected(milestoneId, evidence.approvalVotes, evidence.rejectionVotes);
        }
    }

    /**
     * @dev Release funds for an approved milestone
     * @param milestoneId Milestone to release funds for
     */
    function releaseMilestoneFunds(uint256 milestoneId) 
        external 
        nonReentrant 
        milestoneExists(milestoneId) 
    {
        uint256 campaignId = _findCampaignForMilestone(milestoneId);
        if (campaignManagement[campaignId].creator != msg.sender) revert ICommonErrors.NotCampaignCreator();
        
        _releaseMilestoneFunds(milestoneId);
    }

    /**
     * @dev Internal function to release milestone funds
     * @param milestoneId Milestone to release funds for
     */
    function _releaseMilestoneFunds(uint256 milestoneId) internal {
        MilestoneDefinition storage milestone = milestones[milestoneId];
        if (milestone.status != MilestoneStatus.Approved) revert MilestoneNotApproved();

        milestone.status = MilestoneStatus.Completed;
        
        // Note: In a full implementation, this would trigger fund release from escrow
        // For now, we'll just emit the event
        emit MilestoneCompleted(milestoneId, milestone.targetAmount);
    }

    /**
     * @dev Find campaign ID for a given milestone
     * @param milestoneId Milestone to find campaign for
     * @return campaignId Associated campaign ID
     */
    function _findCampaignForMilestone(uint256 milestoneId) internal view returns (uint256 campaignId) {
        // Note: In a gas-optimized implementation, we would store this mapping directly
        // For now, we'll iterate through campaigns (not efficient for production)
        for (uint256 i = 1; i < 1000; i++) { // Arbitrary limit for demo
            CampaignManagement storage management = campaignManagement[i];
            if (management.isActive) {
                for (uint256 j = 0; j < management.milestoneIds.length; j++) {
                    if (management.milestoneIds[j] == milestoneId) {
                        return i;
                    }
                }
            }
        }
        revert MilestoneNotFoundInCampaign();
    }

    // View Functions
    function getCampaignManagement(uint256 campaignId) 
        external 
        view 
        returns (CampaignManagement memory) 
    {
        return campaignManagement[campaignId];
    }
    
    function getMilestone(uint256 milestoneId) 
        external 
        view 
        returns (MilestoneDefinition memory) 
    {
        return milestones[milestoneId];
    }
    
    function getMilestoneEvidence(uint256 milestoneId) 
        external 
        view 
        returns (
            bytes32 evidenceHash, 
            uint256 submissionTime, 
            address submitter, 
            uint256 approvalVotes, 
            uint256 rejectionVotes
        ) 
    {
        MilestoneEvidence storage evidence = milestoneEvidence[milestoneId];
        return (
            evidence.evidenceHash,
            evidence.submissionTime,
            evidence.submitter,
            evidence.approvalVotes,
            evidence.rejectionVotes
        );
    }
    
    function getCampaignMilestones(uint256 campaignId) 
        external 
        view 
        returns (uint256[] memory) 
    {
        return campaignManagement[campaignId].milestoneIds;
    }
    
    function getCreatorManagedCampaigns(address creator) 
        external 
        view 
        returns (uint256[] memory) 
    {
        return creatorManagedCampaigns[creator];
    }
    
    function getReviewerMilestones(address reviewer) 
        external 
        view 
        returns (uint256[] memory) 
    {
        return reviewerMilestones[reviewer];
    }
    
    function isReviewer(uint256 milestoneId, address reviewer) 
        external 
        view 
        returns (bool) 
    {
        return milestoneReviewers[milestoneId][reviewer];
    }
    
    function hasVoted(uint256 milestoneId, address reviewer) 
        external 
        view 
        returns (bool) 
    {
        return milestoneEvidence[milestoneId].hasVoted[reviewer];
    }
    
    function getVoteChoice(uint256 milestoneId, address reviewer) 
        external 
        view 
        returns (bool) 
    {
        return milestoneEvidence[milestoneId].voteChoice[reviewer];
    }
}
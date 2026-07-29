// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {ErrorLibrary} from "../libraries/ErrorLibrary.sol";
import {ICreatorReputationTracker} from "../interfaces/ICreatorReputationTracker.sol";
import {IPrivateGovernance} from "../interfaces/IPrivateGovernance.sol";
import {AegisCrowdShield} from "./AegisCrowdShield.sol";
import {VoluntaryCampaignManager} from "./VoluntaryCampaignManager.sol";
import {SharedTypes} from "../libraries/SharedTypes.sol";
import {CreatorProfileLibrary} from "../libraries/CreatorProfileLibrary.sol";
import {ValidationLibrary} from "../libraries/ValidationLibrary.sol";
import {ReputationCalculationLibrary} from "../libraries/ReputationCalculationLibrary.sol";
import {ReputationLogic} from "../libraries/ReputationLogic.sol";
import {BondManagementLibrary} from "../libraries/BondManagementLibrary.sol";
import {GovernanceAccessLib} from "../libraries/GovernanceAccessLib.sol";

/**
 * @title CreatorReputationTracker
 * @author Aegis Protocol Team
 * @notice Market-driven reputation system for crowdfunding campaign creators
 * @dev Market-driven reputation system implementing Austrian Economics principles:
 *      - Spontaneous Order: Reputation emerges from market interactions
 *      - Individual Sovereignty: Creator control over reputation data
 *      - Voluntary Association: Opt-in reputation sharing and verification
 *      - Market-Driven Evaluation: Reputation based on actual performance
 *      - Methodological Individualism: Individual assessment and feedback
 */
contract CreatorReputationTracker is ReentrancyGuard {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    // State Variables
    /// @notice Reference to the main crowdfunding contract
    AegisCrowdShield public immutable CROWD_SHIELD;
    /// @notice Reference to the voluntary campaign management contract
    VoluntaryCampaignManager public immutable CAMPAIGN_MANAGER;
    /// @notice Reference to the governance contract for decentralized control
    IPrivateGovernance public governanceContract;

    /// @notice Optional `AegisTimelockController` for delayed governance execution.
    address public timelockController;
    
    /// @notice Mapping of creator addresses to their profiles
    mapping(address => ICreatorReputationTracker.CreatorProfile) public creatorProfiles;
    /// @notice Mapping of creator addresses to their campaign IDs
    mapping(address => uint256[]) public creatorCampaigns;
    /// @notice Mapping of campaign IDs to backer feedback arrays
    mapping(uint256 => ICreatorReputationTracker.BackerFeedback[]) public campaignFeedback;
    /// @notice Mapping of creator addresses to skill endorsements by skill name
    mapping(address => mapping(string => ICreatorReputationTracker.SkillEndorsement[])) public skillEndorsements;
    /// @notice Mapping of creator addresses to their reputation bonds
    mapping(address => ICreatorReputationTracker.ReputationBond[]) public creatorBonds;
    /// @notice Mapping to track if a backer has provided feedback for a creator
    mapping(address => mapping(address => bool)) public hasProvidedFeedback;
    /// @notice Mapping to prevent feedback hash reuse
    mapping(bytes32 => bool) public usedFeedbackHashes;
    
    // Reputation leaderboards combined
    /// @notice Structure containing all leaderboard arrays
    SharedTypes.Leaderboards private leaderboards;
    
    // Austrian Economics Parameters
    /// @notice Maximum rating value for feedback (1-5 scale)
    uint256 public constant MAX_RATING = 5;
    /// @notice Minimum number of campaigns required for reputation calculation
    uint256 public constant MIN_CAMPAIGNS_FOR_REPUTATION = 3;
    /// @notice Period after which reputation scores decay (365 days)
    uint256 public constant REPUTATION_DECAY_PERIOD = 365 days;
    /// @notice Trust score threshold for verified status (80%)
    uint256 public constant TRUST_THRESHOLD = 80;
    /// @notice Lock period for reputation bonds (90 days)
    uint256 public constant BOND_LOCK_PERIOD = 90 days;
    
    // Market-driven parameters and reputation weights combined
    /// @notice System configuration containing all market parameters and weights
    SharedTypes.SystemConfig public systemConfig;

    // ============ EVENTS ============
    
    /// @notice Emitted when a new creator profile is created
    event ProfileCreated(address indexed creator, string profileName, uint256 timestamp);
    
    /// @notice Emitted when a creator profile is updated
    event ProfileUpdated(address indexed creator, uint256 timestamp);
    
    /// @notice Emitted when feedback is submitted for a campaign
    event FeedbackSubmitted(uint256 indexed campaignId, address indexed backer, address indexed creator, uint256 overallRating);
    
    /// @notice Emitted when a skill is endorsed
    event SkillEndorsed(address indexed endorser, address indexed creator, string skill, uint256 proficiencyLevel);
    
    /// @notice Emitted when a reputation bond is posted
    event BondPosted(address indexed creator, uint256 amount, uint256 indexed campaignId, string bondType);
    
    /// @notice Emitted when a reputation bond is slashed
    event BondSlashed(address indexed creator, uint256 bondIndex, uint256 slashAmount, string reason, address indexed slasher, uint256 disputeId);
    
    /// @notice Emitted when a dispute is resolved
    event DisputeResolved(address indexed creator, uint256 bondIndex, uint256 disputeId, bool isSlashApproved, uint256 slashAmount, string resolutionReason);
    
    /// @notice Emitted when a reputation bond is released
    event BondReleased(address indexed creator, uint256 releaseAmount, uint256 indexed campaignId);
    
    /// @notice Emitted when the governance contract is updated
    event GovernanceContractUpdated(address indexed newGovernanceContract);

    event TimelockControllerUpdated(address indexed previousTimelock, address indexed newTimelock);
    
    /// @notice Emitted when reputation weights are updated
    event ReputationWeightsUpdated(uint256 successRateWeight, uint256 completionRateWeight, uint256 backerSatisfactionWeight, uint256 disputeResolutionWeight, uint256 verificationWeight);
    
    /// @notice Emitted when reputation updated
    event ReputationUpdated(address indexed creator, uint256 oldScore, uint256 newScore);
    
    /// @notice Emitted when incentives are updated
    event IncentivesUpdated(uint256 feedbackReward, uint256 endorsementReward, uint256 verificationBonus, uint256 bondingIncentive);

    // ============ PRIVATE VALIDATION FUNCTIONS (REPLACING MODIFIERS) ============
    
    /**
     * @notice Validates that the caller has an active creator profile
     * @dev Reverts if the caller doesn't have an active creator profile
     */
    function _validateCreator() private view {
        if (!creatorProfiles[msg.sender].isActive) revert ErrorLibrary.CreatorProfileRequired();
    }
    
    /**
     * @notice Validates that a rating is within acceptable bounds
     * @dev Reverts if rating is not between 1 and MAX_RATING
     * @param rating The rating value to validate
     */
    function _validateRating(uint256 rating) private pure {
        if (rating < 1 || rating > MAX_RATING) revert ErrorLibrary.InvalidRating();
    }
    
    /**
     * @notice Validates that the caller is a verified backer for a campaign
     * @dev Reverts if the caller has not contributed to the specified campaign
     * @param campaignId The ID of the campaign to check backing status for
     */
    function _validateVerifiedBacker(uint256 campaignId) private view {
        AegisCrowdShield.ContributorSovereignty memory contribution = 
            CROWD_SHIELD.getContribution(campaignId, msg.sender);
        if (contribution.amount == 0) revert ErrorLibrary.NotVerifiedBacker();
    }
    
    /**
     * @notice Validates that the caller is the authorized governance contract
     * @dev Reverts if governance contract is not set or caller is not the governance contract
     */
    function _validateGovernance() private view {
        if (address(governanceContract) == address(0)) {
            revert ErrorLibrary.UnauthorizedGovernanceAccess();
        }
        if (!GovernanceAccessLib.isGovernanceTimelockOrCore(address(governanceContract), timelockController, msg.sender)) {
            revert ErrorLibrary.UnauthorizedGovernanceAccess();
        }
    }

    /**
     * @notice Modifier to restrict access to governance contract only
     * @dev Validates that the caller is the authorized governance contract
     */
    modifier onlyGovernance() {
        _validateGovernance();
        _;
    }

    /**
     * @notice Initialize the CreatorReputationTracker contract
     * @dev Initialize the CreatorReputationTracker contract
     * @param _crowdShield Address of the AegisCrowdShield contract
     * @param _campaignManager Address of the VoluntaryCampaignManager contract
     * @param _governanceContract Address of the governance contract for decentralized control
     */
    constructor(address _crowdShield, address _campaignManager, address _governanceContract) {
        if (_crowdShield == address(0)) revert ErrorLibrary.InvalidCrowdShieldAddress();
        if (_campaignManager == address(0)) revert ErrorLibrary.InvalidCampaignManagerAddress();
        if (_governanceContract == address(0)) revert ErrorLibrary.InvalidGovernanceAddress();
        
        CROWD_SHIELD = AegisCrowdShield(_crowdShield);
        CAMPAIGN_MANAGER = VoluntaryCampaignManager(_campaignManager);
        governanceContract = IPrivateGovernance(_governanceContract);
        
        // Initialize system configuration with default values
        systemConfig = SharedTypes.SystemConfig({
            successRateWeight: 30,
            completionRateWeight: 25,
            backerSatisfactionWeight: 20,
            disputeResolutionWeight: 15,
            verificationWeight: 10,
            fundingRatioWeight: 10,
            minimumBondAmount: 0.1 ether,
            feedbackIncentive: 0.01 ether,
            verificationStake: 0.05 ether,
            endorsementStake: 0.02 ether
        });
    }

    /**
     * @notice Creates a new creator profile or updates an existing one
     * @dev Validates input parameters and either creates new profile or updates existing one
     * @param profileName The display name for the creator profile
     * @param profileDescription A description of the creator and their work
     * @param profileImageHash IPFS hash for the creator's profile image
     * @param websiteUrl The creator's website URL
     * @param socialLinks JSON string containing social media links
     * @param metadata Additional profile metadata including skills, industries, etc.
     * @param isPublic Whether the profile should be publicly visible
     */
    function createOrUpdateProfile(
        string calldata profileName,
        string calldata profileDescription,
        string calldata profileImageHash,
        string calldata websiteUrl,
        string calldata socialLinks,
        ICreatorReputationTracker.ProfileMetadata calldata metadata,
        bool isPublic
    ) external nonReentrant {
        ValidationLibrary.validateProfileInputs(profileName, profileDescription);

        bool isNewProfile = !creatorProfiles[msg.sender].isActive;

        if (isNewProfile) {
            _createNewProfile(
                profileName, 
                profileDescription, 
                profileImageHash, 
                websiteUrl, 
                socialLinks, 
                metadata, 
                isPublic
            );
            emit ProfileCreated(msg.sender, profileName, block.timestamp);
        } else {
            _updateExistingProfile(
                profileName, 
                profileDescription, 
                profileImageHash, 
                websiteUrl, 
                socialLinks, 
                metadata, 
                isPublic
            );
            emit ProfileUpdated(msg.sender, block.timestamp);
        }
    }

    /**
     * @notice Creates a new creator profile with provided information
     * @dev Internal function that initializes a new profile using library
     * @param profileName Display name for the creator
     * @param profileDescription Brief description of the creator's background
     * @param profileImageHash IPFS hash of the creator's profile image
     * @param websiteUrl Creator's website URL
     * @param socialLinks JSON string containing social media links
     * @param metadata Additional structured metadata for the profile
     * @param isPublic Whether the profile should be publicly visible
     */
    function _createNewProfile(
        string calldata profileName,
        string calldata profileDescription,
        string calldata profileImageHash,
        string calldata websiteUrl,
        string calldata socialLinks,
        ICreatorReputationTracker.ProfileMetadata calldata metadata,
        bool isPublic
    ) internal {
        CreatorProfileLibrary.createNewProfile(
            creatorProfiles,
            msg.sender,
            profileName,
            profileDescription,
            profileImageHash,
            websiteUrl,
            socialLinks,
            metadata,
            isPublic
        );
    }

    /**
     * @notice Updates an existing creator profile with new information
     * @dev Internal function that modifies existing profile using library
     * @param profileName Updated display name for the creator
     * @param profileDescription Updated description of the creator's background
     * @param profileImageHash Updated IPFS hash of the creator's profile image
     * @param websiteUrl Updated creator's website URL
     * @param socialLinks Updated JSON string containing social media links
     * @param metadata Updated structured metadata for the profile
     * @param isPublic Updated visibility setting for the profile
     */
    function _updateExistingProfile(
        string calldata profileName,
        string calldata profileDescription,
        string calldata profileImageHash,
        string calldata websiteUrl,
        string calldata socialLinks,
        ICreatorReputationTracker.ProfileMetadata calldata metadata,
        bool isPublic
    ) internal {
        CreatorProfileLibrary.updateExistingProfile(
            creatorProfiles[msg.sender],
            profileName,
            profileDescription,
            profileImageHash,
            websiteUrl,
            socialLinks,
            metadata,
            isPublic
        );
    }

    /**
     * @notice Submits feedback for a creator after campaign completion
     * @dev Validates that caller is a verified backer and all ratings are within bounds
     * @param campaignId The ID of the campaign to provide feedback for
     * @param creator The address of the creator receiving feedback
     * @param overallRating Overall rating from 1-5 for the creator's performance
     * @param communicationRating Rating from 1-5 for creator's communication
     * @param deliveryRating Rating from 1-5 for delivery timeliness
     * @param qualityRating Rating from 1-5 for work quality
     * @param feedbackText Written feedback comments
     * @param isPublic Whether the feedback should be publicly visible
     */
    function submitFeedback(
        uint256 campaignId,
        address creator,
        uint8 overallRating,
        uint8 communicationRating,
        uint8 deliveryRating,
        uint8 qualityRating,
        string calldata feedbackText,
        bool isPublic
    ) external payable nonReentrant {
        _validateVerifiedBacker(campaignId);
        _validateRating(overallRating);
        _validateRating(communicationRating);
        _validateRating(deliveryRating);
        _validateRating(qualityRating);
        ValidationLibrary.validateFeedbackSubmission(
            campaignId,
            creator,
            feedbackText,
            hasProvidedFeedback[msg.sender][creator],
            creatorProfiles[creator].isActive,
            address(CROWD_SHIELD)
        );

        ICreatorReputationTracker.BackerFeedback memory feedback = _createFeedback(
            campaignId, creator, overallRating, communicationRating, 
            deliveryRating, qualityRating, feedbackText, isPublic
        );

        _processFeedback(campaignId, creator, feedback, overallRating);
    }

    /**
     * @notice Creates a feedback struct from provided parameters
     * @dev Internal view function that constructs feedback using library
     * @param campaignId Unique identifier for the campaign
     * @param creator Address of the creator being reviewed
     * @param overallRating Overall rating score (1-5)
     * @param communicationRating Communication quality rating (1-5)
     * @param deliveryRating Delivery performance rating (1-5)
     * @param qualityRating Work quality rating (1-5)
     * @param feedbackText Written feedback comments
     * @param isPublic Whether the feedback should be publicly visible
     * @return BackerFeedback struct containing all feedback data
     */
    function _createFeedback(
        uint256 campaignId,
        address creator,
        uint8 overallRating,
        uint8 communicationRating,
        uint8 deliveryRating,
        uint8 qualityRating,
        string calldata feedbackText,
        bool isPublic
    ) internal view returns (ICreatorReputationTracker.BackerFeedback memory) {
        return CreatorProfileLibrary.createFeedback(
            campaignId,
            msg.sender,
            creator,
            overallRating,
            communicationRating,
            deliveryRating,
            qualityRating,
            feedbackText,
            isPublic
        );
    }

    /**
     * @notice Processes feedback submission, updates reputation, and provides incentives
     * @dev Process feedback submission and update reputation
     * @param campaignId Campaign ID
     * @param creator Creator address
     * @param feedback Feedback struct
     * @param overallRating Overall rating for event emission
     */
    function _processFeedback(
        uint256 campaignId,
        address creator,
        ICreatorReputationTracker.BackerFeedback memory feedback,
        uint8 overallRating
    ) internal {
        campaignFeedback[campaignId].push(feedback);
        hasProvidedFeedback[msg.sender][creator] = true;

        // Cache creator profile to optimize storage access
        ICreatorReputationTracker.CreatorProfile storage profile = creatorProfiles[creator];
        
        // Update creator reputation using library
        ReputationCalculationLibrary.processFeedback(
            profile.reputation,
            feedback,
            systemConfig
        );

        // Incentivize feedback provision
        uint256 incentive = systemConfig.feedbackIncentive;
        if (incentive != 0 && address(this).balance > incentive) {
            (bool success, ) = payable(msg.sender).call{value: incentive}("");
            if (!success) revert ErrorLibrary.InsufficientIncentiveTransfer();
        }

        emit FeedbackSubmitted(campaignId, msg.sender, creator, overallRating);
    }

    /**
     * @notice Endorses a creator's skill with a proficiency rating and stake
     * @dev Validates proficiency level, creator existence, and requires endorsement stake
     * @param creator The address of the creator to endorse
     * @param skill The name of the skill being endorsed
     * @param proficiencyLevel Proficiency level rating from 1-5
     * @param endorsementText Written description of the endorsement
     */
    function endorseSkill(
        address creator,
        string calldata skill,
        uint8 proficiencyLevel,
        string calldata endorsementText
    ) external payable nonReentrant {
        _validateRating(proficiencyLevel);
        if (!creatorProfiles[creator].isActive) revert ErrorLibrary.CreatorProfileDoesNotExist();
        if (bytes(skill).length == 0 || bytes(skill).length > 50) revert ErrorLibrary.InvalidSkillName();
        if (bytes(endorsementText).length > 200) revert ErrorLibrary.EndorsementTextTooLong();
        if (msg.value < systemConfig.endorsementStake) revert ErrorLibrary.InsufficientEndorsementStake();

        ICreatorReputationTracker.SkillEndorsement memory endorsement = ICreatorReputationTracker.SkillEndorsement({
            endorser: msg.sender,
            creator: creator,
            skill: skill,
            proficiencyLevel: proficiencyLevel,
            endorsementText: endorsementText,
            isVerified: creatorProfiles[msg.sender].isActive, // Verified if endorser has profile
            timestamp: block.timestamp
        });

        skillEndorsements[creator][skill].push(endorsement);

        // Update creator verification status using library
        ReputationLogic.updateSkillVerification(creatorProfiles[creator], skillEndorsements, creator);
        ReputationLogic.updateVerificationLevel(creatorProfiles[creator]);

        emit SkillEndorsed(msg.sender, creator, skill, proficiencyLevel);
    }

    /**
     * @notice Posts a reputation bond for a campaign
     * @dev Post a reputation bond for a campaign
     * @param campaignId Campaign to bond for
     * @param bondType Type of bond
     */
    function postBond(
        uint256 campaignId,
        ICreatorReputationTracker.BondType bondType
    ) external payable nonReentrant {
        _validateCreator();
        // Validate bond posting using library
        BondManagementLibrary.validateBondPosting(
            CROWD_SHIELD,
            campaignId,
            msg.sender,
            msg.value
        );

        // Create bond using library
        ICreatorReputationTracker.ReputationBond memory bond = BondManagementLibrary.createBond(
            msg.sender,
            msg.value,
            campaignId,
            bondType
        );

        creatorBonds[msg.sender].push(bond);

        // Add to bonded creators if first bond
        if (creatorBonds[msg.sender].length == 1) {
            leaderboards.bondedCreators.push(msg.sender);
        }

        emit BondPosted(msg.sender, msg.value, campaignId, _bondTypeToString(bondType));
    }

    /**
     * @notice Slashes a creator's bond due to misconduct or dispute resolution
     * @dev Only callable by governance contract, validates bond status before slashing
     * @param creator Address of the creator whose bond is being slashed
     * @param bondIndex Index of the bond in the creator's bond array
     * @param slashAmount Amount to slash from the bond
     * @param reason Explanation for the bond slashing
     * @param disputeId Unique identifier for the associated dispute
     */
    function slashBond(
        address creator,
        uint256 bondIndex,
        uint256 slashAmount,
        string calldata reason,
        uint256 disputeId
    ) external nonReentrant {
        _validateGovernance();
        // Validate bond index
        if (bondIndex > creatorBonds[creator].length - 1) revert ErrorLibrary.InvalidBondIndex();
        
        // Slash bond using library
        BondManagementLibrary.slashBond(
            creatorBonds[creator][bondIndex],
            slashAmount,
            reason
        );

        // Update creator reputation negatively
        ICreatorReputationTracker.CreatorProfile storage profile = creatorProfiles[creator];
        ++profile.reputation.disputeCount;
        
        // Update reputation score based on new dispute count
        profile.reputation.lastMetricUpdate = block.timestamp;

        emit BondSlashed(creator, bondIndex, slashAmount, reason, msg.sender, disputeId);
    }

    /**
     * @notice Resolves a dispute and optionally slashes a creator's bond
     * @dev Only callable by governance contract, provides transparent dispute resolution
     * @param creator Address of the creator whose bond is being disputed
     * @param bondIndex Index of the bond in the creator's bond array
     * @param disputeId Unique identifier for the dispute being resolved
     * @param isSlashApproved Whether the governance approves slashing the bond
     * @param slashAmount Amount to slash from the bond (must not exceed bond amount)
     * @param resolutionReason Explanation for the dispute resolution decision
     */
    function resolveDisputeAndSlash(
        address creator,
        uint256 bondIndex,
        uint256 disputeId,
        bool isSlashApproved,
        uint256 slashAmount,
        string calldata resolutionReason
    ) external onlyGovernance nonReentrant {
        // Governance-controlled dispute resolution with transparent decision making
        if (bondIndex > creatorBonds[creator].length - 1) revert ErrorLibrary.InvalidBondIndex();
        
        ICreatorReputationTracker.ReputationBond storage bond = creatorBonds[creator][bondIndex];
        if (!bond.isActive || bond.isSlashed) revert ErrorLibrary.BondNotActiveOrAlreadySlashed();
        
        if (isSlashApproved) {
            if (slashAmount > bond.bondAmount) revert ErrorLibrary.SlashAmountExceedsBond();
            
            bond.isSlashed = true;
            bond.slashAmount = slashAmount;
            bond.slashReason = resolutionReason;

            // Update creator reputation negatively
            ICreatorReputationTracker.CreatorProfile storage profile = creatorProfiles[creator];
            ++profile.reputation.disputeCount;
            _updateCreatorReputation(creator);

            emit BondSlashed(creator, bondIndex, slashAmount, resolutionReason, msg.sender, disputeId);
        }
        
        // Emit dispute resolution event regardless of outcome
        emit DisputeResolved(creator, bondIndex, disputeId, isSlashApproved, slashAmount, resolutionReason);
    }

    /**
     * @notice Releases a creator's bond after the lock period expires
     * @dev Only callable by the bond owner, validates bond status and timing
     * @param bondIndex Index of the bond in the creator's bond array to release
     */
    function releaseBond(uint256 bondIndex) external nonReentrant {
        _validateCreator();
        // Validate bond index
        if (bondIndex > creatorBonds[msg.sender].length - 1) revert ErrorLibrary.InvalidBondIndex();
        
        // Validate and release bond using library
        uint256 releaseAmount = BondManagementLibrary.validateBondRelease(
            creatorBonds[msg.sender][bondIndex],
            msg.sender
        );

        // Release bond using library
        BondManagementLibrary.releaseBond(
            creatorBonds[msg.sender][bondIndex],
            msg.sender
        );

        emit BondReleased(msg.sender, releaseAmount, creatorBonds[msg.sender][bondIndex].campaignId);
    }

    /**
     * @notice Updates a creator's reputation metrics and timestamp
     * @dev Internal function that updates reputation timestamp and emits event
     * @param creator Address of the creator whose reputation is being updated
     */
    function _updateCreatorReputation(address creator) internal {
        // Update reputation timestamp
        creatorProfiles[creator].reputation.lastMetricUpdate = block.timestamp;

        emit ReputationUpdated(
            creator, 
            creatorProfiles[creator].reputation.reputationScore, 
            creatorProfiles[creator].reputation.trustScore
        );
    }

    /**
     * @notice Registers a campaign for reputation tracking and updates creator metrics
     * @dev Register a campaign for reputation tracking
     * @param campaignId Campaign to register
     * @param creator Creator address
     */
    function registerCampaign(uint256 campaignId, address creator) external nonReentrant {
        if (msg.sender != address(CAMPAIGN_MANAGER)) revert ErrorLibrary.UnauthorizedAccess();
        // Verify campaign exists and caller is creator
        AegisCrowdShield.CampaignSovereignty memory campaign = CROWD_SHIELD.getCampaign(campaignId);
        if (campaign.creator != creator) revert ErrorLibrary.NotCampaignCreator();
        
        // Check if campaign already registered
        uint256[] memory campaigns = creatorCampaigns[msg.sender];
        unchecked {
            for (uint256 i = 0; i < campaigns.length; ++i) {
                if (campaigns[i] == campaignId) revert ErrorLibrary.CampaignAlreadyRegistered();
            }
        }

        creatorCampaigns[msg.sender].push(campaignId);
        
        // Update reputation metrics
        _updateCreatorReputation(msg.sender);
    }

    // View Functions
    /**
     * @notice Retrieves the complete profile information for a creator
     * @param creator The address of the creator to query
     * @return The creator's profile data including metadata and reputation metrics
     */
    function getCreatorProfile(address creator) 
        external 
        view 
        returns (ICreatorReputationTracker.CreatorProfile memory) 
    {
        return creatorProfiles[creator];
    }
    
    /**
     * @notice Gets all campaign IDs associated with a creator
     * @param creator The address of the creator to query
     * @return Array of campaign IDs the creator has registered
     */
    function getCreatorCampaigns(address creator) external view returns (uint256[] memory) {
        return creatorCampaigns[creator];
    }
    
    /**
     * @notice Retrieves all feedback submitted for a specific campaign
     * @param campaignId The ID of the campaign to query feedback for
     * @return Array of all feedback entries for the campaign
     */
    function getCampaignFeedback(uint256 campaignId) 
        external 
        view 
        returns (ICreatorReputationTracker.BackerFeedback[] memory) 
    {
        return campaignFeedback[campaignId];
    }
    
    /**
     * @notice Gets all skill endorsements for a creator's specific skill
     * @param creator The address of the creator to query
     * @param skill The name of the skill to get endorsements for
     * @return Array of all endorsements for the creator's skill
     */
    function getSkillEndorsements(address creator, string calldata skill) 
        external 
        view 
        returns (ICreatorReputationTracker.SkillEndorsement[] memory) 
    {
        return skillEndorsements[creator][skill];
    }
    
    /**
     * @notice Retrieves all reputation bonds posted by a creator
     * @param creator The address of the creator to query bonds for
     * @return Array of all reputation bonds for the creator
     */
    function getCreatorBonds(address creator) 
        external 
        view 
        returns (ICreatorReputationTracker.ReputationBond[] memory) 
    {
        return creatorBonds[creator];
    }
    
    /**
     * @notice Gets the top creators ranked by reputation score
     * @return Array of creator addresses ordered by reputation (highest first)
     */
    function getTopCreatorsByReputation() external view returns (address[] memory) {
        return leaderboards.topCreatorsByReputation;
    }
    
    /**
     * @notice Gets the top creators ranked by trust score
     * @return Array of creator addresses ordered by trust score (highest first)
     */
    function getTopCreatorsByTrust() external view returns (address[] memory) {
        return leaderboards.topCreatorsByTrust;
    }
    
    /**
     * @notice Gets all verified creators in the system
     * @return Array of verified creator addresses
     */
    function getVerifiedCreators() external view returns (address[] memory) {
        return leaderboards.verifiedCreators;
    }
    
    /**
     * @notice Gets all bonded creators in the system
     * @return Array of bonded creator addresses
     */
    function getBondedCreators() external view returns (address[] memory) {
        return leaderboards.bondedCreators;
    }

    // Admin Functions
    /**
     * @notice Sets the governance contract address
     * @dev Can only be called once during initialization
     * @param _governanceContract Address of the governance contract
     */
    function setGovernanceContract(address _governanceContract) external {
        if (address(governanceContract) != address(0)) {
            if (msg.sender != address(governanceContract)) {
                revert ErrorLibrary.UnauthorizedGovernanceAccess();
            }
        }
        
        if (_governanceContract == address(0)) {
            revert ErrorLibrary.InvalidGovernanceAddress();
        }
        
        governanceContract = IPrivateGovernance(_governanceContract);
        emit GovernanceContractUpdated(_governanceContract);
    }

    /**
     * @notice Register the protocol timelock for delayed reputation admin.
     */
    function setTimelockController(address newTimelock) external {
        _validateGovernance();
        emit TimelockControllerUpdated(timelockController, newTimelock);
        timelockController = newTimelock;
    }
    
    /**
     * @notice Updates the weights used for reputation score calculations
     * @dev Only callable by governance contract, weights must sum to 100
     * @param _successRateWeight Weight for campaign success rate (0-100)
     * @param _completionRateWeight Weight for campaign completion rate (0-100)
     * @param _backerSatisfactionWeight Weight for backer satisfaction scores (0-100)
     * @param _disputeResolutionWeight Weight for dispute resolution performance (0-100)
     * @param _verificationWeight Weight for verification status (0-100)
     */
    function updateReputationWeights(
        uint256 _successRateWeight,
        uint256 _completionRateWeight,
        uint256 _backerSatisfactionWeight,
        uint256 _disputeResolutionWeight,
        uint256 _verificationWeight
    ) external {
        _validateGovernance();
        if (_successRateWeight + _completionRateWeight + _backerSatisfactionWeight +
            _disputeResolutionWeight + _verificationWeight != 100) {
            revert ErrorLibrary.InvalidWeightSum();
        }
        
        systemConfig.successRateWeight = _successRateWeight;
        systemConfig.completionRateWeight = _completionRateWeight;
        systemConfig.backerSatisfactionWeight = _backerSatisfactionWeight;
        systemConfig.disputeResolutionWeight = _disputeResolutionWeight;
        systemConfig.verificationWeight = _verificationWeight;
        
        emit ReputationWeightsUpdated(
            _successRateWeight,
            _completionRateWeight,
            _backerSatisfactionWeight,
            _disputeResolutionWeight,
            _verificationWeight
        );
    }
    
    /**
     * @notice Updates the incentive amounts for various system operations
     * @dev Only callable by governance contract
     * @param _minimumBondAmount Minimum amount required for creator bonds
     * @param _verificationStake Amount required for verification staking
     * @param _feedbackIncentive Reward amount for providing feedback
     * @param _endorsementStake Amount required for skill endorsements
     */
    function updateIncentives(
        uint256 _minimumBondAmount,
        uint256 _verificationStake,
        uint256 _feedbackIncentive,
        uint256 _endorsementStake
    ) external onlyGovernance {
        systemConfig.minimumBondAmount = _minimumBondAmount;
        systemConfig.verificationStake = _verificationStake;
        systemConfig.feedbackIncentive = _feedbackIncentive;
        systemConfig.endorsementStake = _endorsementStake;
        
        emit IncentivesUpdated(
            _minimumBondAmount,
            _verificationStake,
            _feedbackIncentive,
            _endorsementStake
        );
    }

    /**
     * @notice Converts BondType enum to string representation
     * @param bondType The BondType enum value to convert
     * @return The string representation of the bond type
     */
    function _bondTypeToString(ICreatorReputationTracker.BondType bondType) internal pure returns (string memory) {
        if (bondType == ICreatorReputationTracker.BondType.Performance) return "Performance";
        if (bondType == ICreatorReputationTracker.BondType.Delivery) return "Delivery";
        if (bondType == ICreatorReputationTracker.BondType.Quality) return "Quality";
        if (bondType == ICreatorReputationTracker.BondType.Communication) return "Communication";
        if (bondType == ICreatorReputationTracker.BondType.Dispute) return "Dispute";
        return "Unknown";
    }

    /**
     * @notice Allows the contract to receive ETH directly
     * @dev Required for receiving ETH payments for bonds and incentives
     */
    receive() external payable {}
}
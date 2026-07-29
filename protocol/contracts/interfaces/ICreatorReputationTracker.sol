// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ICommonErrors} from "./ICommonErrors.sol";

/**
 * @title ICreatorReputationTracker
 * @author Aegis Protocol Team
 * @notice Interface for the CreatorReputationTracker contract
 * @dev Market-driven reputation system interface implementing Austrian Economics principles
 */
interface ICreatorReputationTracker is ICommonErrors {
    // Structs
    struct CreatorProfile {
        address creator;                    // Creator address
        bool isActive;                      // Whether profile is active
        bool isPublic;                      // Whether profile is public
        uint256 createdAt;                  // Profile creation timestamp
        uint256 lastUpdated;                // Last update timestamp
        string profileName;                 // Creator display name
        string profileDescription;          // Creator description
        string profileImageHash;            // IPFS hash for profile image
        string websiteUrl;                  // Creator website
        string socialLinks;                 // JSON string of social media links
        ProfileMetadata metadata;           // Additional profile metadata
        ReputationMetrics reputation;       // Reputation metrics
        VerificationStatus verification;    // Verification status
    }

    struct ProfileMetadata {
        string[] skills;                    // Creator skills
        string[] industries;                // Industries of expertise
        string location;                    // Creator location
        string timezone;                    // Creator timezone
        string preferredLanguages;          // Preferred languages
        string experience;                  // Experience description
        string education;                   // Education background
        string certifications;              // Professional certifications
    }

    struct ReputationMetrics {
        uint256 totalCampaigns;             // Total campaigns created
        uint256 successfulCampaigns;        // Successfully funded campaigns
        uint256 completedCampaigns;         // Completed campaigns
        uint256 totalFundsRaised;           // Total funds raised across all campaigns
        uint256 averageFundingRatio;        // Average funding ratio (target vs raised)
        uint256 averageCompletionTime;      // Average project completion time
        uint256 averageBackerSatisfaction;  // Average backer satisfaction rating
        uint256 totalBackers;               // Total unique backers
        uint256 repeatBackerRate;           // Percentage of repeat backers
        uint256 disputeCount;               // Number of disputes
        uint256 disputeResolutionRate;      // Percentage of disputes resolved favorably
        uint256 reputationScore;            // Calculated reputation score
        uint256 trustScore;                 // Market-driven trust score
        uint256 lastMetricUpdate;           // Last metrics update timestamp
    }

    struct VerificationStatus {
        uint8 verificationLevel;            // Overall verification level (1-5) (1 byte)
        bool isIdentityVerified;            // Identity verification (1 byte)
        bool isAddressVerified;             // Address verification (1 byte)
        bool isBusinessVerified;            // Business verification (1 byte)
        bool isSkillVerified;               // Skill verification (1 byte)
        bool isSocialVerified;              // Social media verification (1 byte)
        uint256 lastVerificationUpdate;     // Last verification update
        address[] verifiers;                // Addresses that verified
        string[] verificationDocuments;     // IPFS hashes of verification docs
    }

    struct BackerFeedback {
        address backer;                     // Backer providing feedback
        uint8 overallRating;                // Overall rating (1-5)
        uint8 communicationRating;          // Communication rating (1-5)
        uint8 deliveryRating;               // Delivery rating (1-5)
        uint8 qualityRating;                // Quality rating (1-5)
        bool isVerifiedBacker;              // Whether backer is verified
        bool isPublic;                      // Whether feedback is public
        address creator;                    // Creator being rated
        uint256 campaignId;                 // Campaign this feedback is for
        uint256 timestamp;                  // Feedback timestamp
        string feedbackText;                // Written feedback
    }

    struct SkillEndorsement {
        address endorser;                   // Address providing endorsement
        uint8 proficiencyLevel;             // Proficiency level (1-5)
        bool isVerified;                    // Whether endorsement is verified
        address creator;                    // Creator being endorsed
        uint256 timestamp;                  // Endorsement timestamp
        string skill;                       // Skill being endorsed
        string endorsementText;             // Endorsement description
    }

    struct ReputationBond {
        address creator;                    // Creator posting bond
        uint64 lockPeriod;                  // Lock period for bond
        BondType bondType;                  // Type of bond
        bool isActive;                      // Whether bond is active
        bool isSlashed;                     // Whether bond was slashed
        uint256 bondAmount;                 // Amount bonded
        uint256 campaignId;                 // Associated campaign
        uint256 unlockTime;                 // When bond can be unlocked
        uint256 slashAmount;                // Amount slashed
        string slashReason;                 // Reason for slashing
    }

    enum BondType {
        Performance,        // Performance guarantee bond
        Delivery,          // Delivery guarantee bond
        Quality,           // Quality guarantee bond
        Communication,     // Communication guarantee bond
        Dispute            // Dispute resolution bond
    }

    // Custom Errors

    // Events
    event ProfileCreated(
        address indexed creator,
        string profileName,
        uint256 indexed timestamp
    );
    
    event ProfileUpdated(
        address indexed creator,
        uint256 indexed timestamp
    );
    
    event FeedbackSubmitted(
        uint256 indexed campaignId,
        address indexed backer,
        address indexed creator,
        uint8 overallRating
    );
    
    event SkillEndorsed(
        address indexed endorser,
        address indexed creator,
        string indexed skill,
        uint8 proficiencyLevel
    );
    
    event ReputationUpdated(
        address indexed creator,
        uint256 indexed reputationScore,
        uint256 indexed trustScore
    );
    
    event VerificationUpdated(
        address indexed creator,
        uint8 indexed verificationLevel,
        address indexed verifier
    );
    
    event BondPosted(
        address indexed creator,
        uint256 indexed bondAmount,
        uint256 indexed campaignId,
        BondType bondType
    );
    
    event BondSlashed(
        address indexed creator,
        uint256 indexed bondIndex,
        uint256 slashAmount,
        string reason,
        address indexed governanceDecision,
        uint256 disputeId
    );
    
    event DisputeResolved(
        address indexed creator,
        uint256 indexed bondIndex,
        uint256 indexed disputeId,
        bool isSlashApproved,
        uint256 slashAmount,
        string resolutionReason
    );
    
    event BondReleased(
        address indexed creator,
        uint256 indexed bondAmount,
        uint256 indexed campaignId
    );
    
    event GovernanceContractUpdated(
        address indexed newGovernanceContract
    );
    
    event ReputationWeightsUpdated(
        uint256 indexed successRateWeight,
        uint256 indexed completionRateWeight,
        uint256 indexed backerSatisfactionWeight,
        uint256 disputeResolutionWeight,
        uint256 verificationWeight
    );
    
    event IncentivesUpdated(
        uint256 indexed minimumBondAmount,
        uint256 indexed verificationStake,
        uint256 indexed feedbackIncentive,
        uint256 endorsementStake
    );

    // External Functions
    function createOrUpdateProfile(
        string calldata profileName,
        string calldata profileDescription,
        string calldata profileImageHash,
        string calldata websiteUrl,
        string calldata socialLinks,
        ProfileMetadata calldata metadata,
        bool isPublic
    ) external;

    function submitFeedback(
        uint256 campaignId,
        address creator,
        uint8 overallRating,
        uint8 communicationRating,
        uint8 deliveryRating,
        uint8 qualityRating,
        string calldata feedbackText,
        bool isPublic
    ) external payable;

    function endorseSkill(
        address creator,
        string calldata skill,
        uint8 proficiencyLevel,
        string calldata endorsementText
    ) external payable;

    function postBond(
        uint256 campaignId,
        BondType bondType
    ) external payable;

    function slashBond(
        address creator,
        uint256 bondIndex,
        uint256 slashAmount,
        string calldata reason,
        uint256 disputeId
    ) external;

    function releaseBond(uint256 bondIndex) external;

    function registerCampaign(uint256 campaignId) external;

    // View Functions
    function getCreatorProfile(address creator) 
        external 
        view 
        returns (CreatorProfile memory);
    
    function getCreatorCampaigns(address creator) 
        external 
        view 
        returns (uint256[] memory);
    
    function getCampaignFeedback(uint256 campaignId) 
        external 
        view 
        returns (BackerFeedback[] memory);
    
    function getSkillEndorsements(address creator, string calldata skill) 
        external 
        view 
        returns (SkillEndorsement[] memory);
    
    function getCreatorBonds(address creator) 
        external 
        view 
        returns (ReputationBond[] memory);
    
    function getTopCreatorsByReputation() 
        external 
        view 
        returns (address[] memory);
    
    function getTopCreatorsByTrust() 
        external 
        view 
        returns (address[] memory);
    
    function getVerifiedCreators() 
        external 
        view 
        returns (address[] memory);
    
    function getBondedCreators() 
        external 
        view 
        returns (address[] memory);

    // Admin Functions
    function setGovernanceContract(address _governanceContract) external;
    
    function updateReputationWeights(
        uint256 _successRateWeight,
        uint256 _completionRateWeight,
        uint256 _backerSatisfactionWeight,
        uint256 _disputeResolutionWeight,
        uint256 _verificationWeight
    ) external;
    
    function updateIncentives(
        uint256 _minimumBondAmount,
        uint256 _verificationStake,
        uint256 _feedbackIncentive,
        uint256 _endorsementStake
    ) external;
}
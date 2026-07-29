// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ICreatorReputationTracker} from "../interfaces/ICreatorReputationTracker.sol";

/**
 * @title CreatorProfileLibrary
 * @author Aegis Protocol Team
 * @notice Library for managing creator profile operations
 * @dev Extracted from CreatorReputationTracker to reduce contract size
 */
library CreatorProfileLibrary {
    /**
     * @notice Initialize reputation metrics for new profile with optimized struct creation
     * @dev Initialize reputation metrics for new profile
     * @return ReputationMetrics struct with default values
     */
    function initializeReputationMetrics() public view returns (ICreatorReputationTracker.ReputationMetrics memory) {
        // Cache timestamp to avoid multiple block.timestamp calls
        uint256 currentTimestamp = block.timestamp;
        
        return ICreatorReputationTracker.ReputationMetrics({
            totalCampaigns: 0,
            successfulCampaigns: 0,
            completedCampaigns: 0,
            totalFundsRaised: 0,
            averageFundingRatio: 0,
            averageCompletionTime: 0,
            averageBackerSatisfaction: 0,
            totalBackers: 0,
            repeatBackerRate: 0,
            disputeCount: 0,
            disputeResolutionRate: 0,
            reputationScore: 0,
            trustScore: 0,
            lastMetricUpdate: currentTimestamp
        });
    }

    /**
     * @notice Initialize verification status for new profile
     * @dev Initialize verification status for new profile
     * @return VerificationStatus struct with default values
     */
    function initializeVerificationStatus() 
        internal 
        pure 
        returns (ICreatorReputationTracker.VerificationStatus memory) 
    {
        return ICreatorReputationTracker.VerificationStatus({
            isIdentityVerified: false,
            isAddressVerified: false,
            isBusinessVerified: false,
            isSkillVerified: false,
            isSocialVerified: false,
            verificationLevel: 0,
            verifiers: new address[](0),
            verificationDocuments: new string[](0),
            lastVerificationUpdate: 0
        });
    }

    /**
     * @notice Create a new creator profile with optimized struct initialization
     * @dev Create a new creator profile
     * @param profiles Mapping of creator profiles
     * @param creator Creator address
     * @param profileName Name of the creator profile
     * @param profileDescription Description of the creator
     * @param profileImageHash IPFS hash for profile image
     * @param websiteUrl Creator's website URL
     * @param socialLinks Social media links
     * @param metadata Additional profile metadata
     * @param isPublic Whether the profile should be publicly visible
     */
    function createNewProfile(
        mapping(address => ICreatorReputationTracker.CreatorProfile) storage profiles,
        address creator,
        string calldata profileName,
        string calldata profileDescription,
        string calldata profileImageHash,
        string calldata websiteUrl,
        string calldata socialLinks,
        ICreatorReputationTracker.ProfileMetadata calldata metadata,
        bool isPublic
    ) public {
        // Cache timestamp to avoid multiple block.timestamp calls
        uint256 currentTimestamp = block.timestamp;
        
        profiles[creator] = ICreatorReputationTracker.CreatorProfile({
            creator: creator,
            profileName: profileName,
            profileDescription: profileDescription,
            profileImageHash: profileImageHash,
            websiteUrl: websiteUrl,
            socialLinks: socialLinks,
            metadata: metadata,
            reputation: initializeReputationMetrics(),
            verification: initializeVerificationStatus(),
            createdAt: currentTimestamp,
            lastUpdated: currentTimestamp,
            isActive: true,
            isPublic: isPublic
        });
    }

    /**
     * @notice Update an existing creator profile with batch updates
     * @dev Update an existing creator profile
     * @param profile Storage reference to the creator profile
     * @param profileName Name of the creator profile
     * @param profileDescription Description of the creator
     * @param profileImageHash IPFS hash for profile image
     * @param websiteUrl Creator's website URL
     * @param socialLinks Social media links
     * @param metadata Additional profile metadata
     * @param isPublic Whether the profile should be publicly visible
     */
    function updateExistingProfile(
        ICreatorReputationTracker.CreatorProfile storage profile,
        string calldata profileName,
        string calldata profileDescription,
        string calldata profileImageHash,
        string calldata websiteUrl,
        string calldata socialLinks,
        ICreatorReputationTracker.ProfileMetadata calldata metadata,
        bool isPublic
    ) public {
        // Batch update all profile fields to minimize storage writes
        profile.profileName = profileName;
        profile.profileDescription = profileDescription;
        profile.profileImageHash = profileImageHash;
        profile.websiteUrl = websiteUrl;
        profile.socialLinks = socialLinks;
        profile.metadata = metadata;
        profile.isPublic = isPublic;
        profile.lastUpdated = block.timestamp;
    }

    /**
     * @notice Create feedback struct with optimized initialization
     * @dev Create feedback struct
     * @param campaignId ID of the campaign being reviewed
     * @param backer Address of the backer providing feedback
     * @param creator Address of the creator being reviewed
     * @param overallRating Overall rating given (1-5)
     * @param communicationRating Communication rating given (1-5)
     * @param deliveryRating Delivery rating given (1-5)
     * @param qualityRating Quality rating given (1-5)
     * @param feedbackText Written feedback text
     * @param isPublic Whether the feedback should be public
     * @return BackerFeedback struct with provided data
     */
    function createFeedback(
        uint256 campaignId,
        address backer,
        address creator,
        uint8 overallRating,
        uint8 communicationRating,
        uint8 deliveryRating,
        uint8 qualityRating,
        string calldata feedbackText,
        bool isPublic
    ) public view returns (ICreatorReputationTracker.BackerFeedback memory) {
        // Cache timestamp for consistent feedback creation
        uint256 currentTimestamp = block.timestamp;
        
        return ICreatorReputationTracker.BackerFeedback({
            campaignId: campaignId,
            backer: backer,
            creator: creator,
            overallRating: overallRating,
            communicationRating: communicationRating,
            deliveryRating: deliveryRating,
            qualityRating: qualityRating,
            feedbackText: feedbackText,
            isVerifiedBacker: true,
            timestamp: currentTimestamp,
            isPublic: isPublic
        });
    }
}

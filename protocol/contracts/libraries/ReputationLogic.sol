// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ICreatorReputationTracker} from "../interfaces/ICreatorReputationTracker.sol";
import {AegisCrowdShield} from "../crowdfunding/AegisCrowdShield.sol";
import {SharedTypes} from "./SharedTypes.sol";
import {ErrorLibrary} from "./ErrorLibrary.sol";

/**
 * @title ReputationLogic
 * @author Aegis Protocol Team
 * @notice Library containing complex reputation calculation logic
 * @dev This library contains the core reputation calculation algorithms to reduce contract size
 */
library ReputationLogic {
    // Constants for reputation calculations
    uint256 private constant MIN_CAMPAIGNS_FOR_REPUTATION = 3;
    uint256 private constant REPUTATION_DECAY_PERIOD = 180 days;
    uint256 private constant HIGH_REPUTATION_THRESHOLD = 80;
    uint256 private constant MIN_VERIFIED_ENDORSEMENTS = 3;
    uint256 private constant MIN_VERIFICATION_LEVEL_FOR_TRUST = 3;

    /**
     * @notice Calculates comprehensive campaign metrics for a creator
     * @param campaigns Array of campaign IDs
     * @param crowdShield Reference to AegisCrowdShield contract
     * @param campaignFeedback Mapping of campaign feedback
     * @return metrics Calculated campaign metrics
     */
    function calculateCampaignMetrics(
        uint256[] memory campaigns,
        AegisCrowdShield crowdShield,
        mapping(uint256 => ICreatorReputationTracker.BackerFeedback[]) storage campaignFeedback
    ) public view returns (SharedTypes.CampaignMetrics memory metrics) {
        uint256 campaignCount = campaigns.length;
        metrics.totalCampaigns = campaignCount;
        
        // CRITICAL: Explicitly initialize to prevent uninitialized variable warnings
        uint256 totalSatisfactionRating = 0;
        uint256 totalRatings = 0;

        // Calculate metrics from campaigns
        for (uint256 i; i < campaignCount;) {
            AegisCrowdShield.CampaignSovereignty memory campaign = crowdShield.getCampaign(campaigns[i]);
            
            if (campaign.status == AegisCrowdShield.CampaignStatus.Successful) {
                unchecked { ++metrics.successfulCampaigns; }
                metrics.totalFundsRaised += campaign.totalRaised;
            }
            
            if (campaign.status == AegisCrowdShield.CampaignStatus.Successful ||
                campaign.status == AegisCrowdShield.CampaignStatus.Failed ||
                campaign.status == AegisCrowdShield.CampaignStatus.Withdrawn) {
                unchecked { ++metrics.completedCampaigns; }
            }

            metrics.totalBackers += campaign.contributorCount;

            // Calculate average satisfaction from feedback
            ICreatorReputationTracker.BackerFeedback[] storage feedback = campaignFeedback[campaigns[i]];
            uint256 feedbackLength = feedback.length;
            for (uint256 j; j < feedbackLength;) {
                totalSatisfactionRating += feedback[j].overallRating;
                unchecked { 
                    ++totalRatings;
                    ++j;
                }
            }
            unchecked { ++i; }
        }

        metrics.averageSatisfaction = totalRatings != 0 ? totalSatisfactionRating / totalRatings : 0;
    }

    /**
     * @notice Calculates weighted reputation score based on multiple factors
     * @param profile Creator profile data
     * @param config System configuration for weights
     * @return score Calculated reputation score (0-100)
     */
    function calculateReputationScore(
        ICreatorReputationTracker.CreatorProfile memory profile,
        SharedTypes.SystemConfig memory config
    ) public view returns (uint256 score) {
        if (profile.reputation.totalCampaigns < MIN_CAMPAIGNS_FOR_REPUTATION) {
            return 0; // Not enough campaigns for reputation
        }

        uint256 totalCampaigns = profile.reputation.totalCampaigns;
        uint256 successRate = (profile.reputation.successfulCampaigns * 100) / totalCampaigns;
        uint256 completionRate = (profile.reputation.completedCampaigns * 100) / totalCampaigns;
        uint256 backerSatisfaction = profile.reputation.averageBackerSatisfaction * 20; // Convert to 100 scale
        
        uint256 disputeResolutionScore = 100;
        uint256 disputeCount = profile.reputation.disputeCount;
        if (disputeCount != 0) {
            disputeResolutionScore = (profile.reputation.disputeResolutionRate * 100) / disputeCount;
        }

        uint256 verificationScore = profile.verification.verificationLevel * 20; // Convert to 100 scale

        // Weighted average
        score = (successRate * config.successRateWeight +
                completionRate * config.completionRateWeight +
                backerSatisfaction * config.backerSatisfactionWeight +
                disputeResolutionScore * config.disputeResolutionWeight +
                verificationScore * config.verificationWeight) / 100;

        // Apply time decay for inactive creators (guard clock anomaly / corrupt storage)
        uint256 lastUp = profile.reputation.lastMetricUpdate;
        uint256 timeSinceLastUpdate = lastUp > block.timestamp ? 0 : block.timestamp - lastUp;
        if (timeSinceLastUpdate > REPUTATION_DECAY_PERIOD) {
            uint256 decayFactor = timeSinceLastUpdate / REPUTATION_DECAY_PERIOD;
            score = score > decayFactor ? score - decayFactor : 0;
        }
    }

    /**
     * @notice Calculates trust score based on market interactions and bond history
     * @param profile Creator profile data
     * @param bondCount Number of bonds posted by creator
     * @return trustScore Calculated trust score (0-100)
     */
    function calculateTrustScore(
        ICreatorReputationTracker.CreatorProfile memory profile,
        uint256 bondCount
    ) public pure returns (uint256 trustScore) {
        // Base trust score from reputation
        trustScore = profile.reputation.reputationScore;

        // Bonus for verification
        if (profile.verification.verificationLevel >= MIN_VERIFICATION_LEVEL_FOR_TRUST) {
            trustScore += 10;
        }

        // Bonus for bonded creators
        if (bondCount != 0) {
            trustScore += 5;
        }

        // Penalty for disputes
        uint256 disputeCount = profile.reputation.disputeCount;
        if (disputeCount != 0) {
            uint256 disputePenalty = disputeCount * 5;
            trustScore = trustScore > disputePenalty ? trustScore - disputePenalty : 0;
        }

        // Cap at 100
        if (trustScore > 100) {
            trustScore = 100;
        }
    }

    /**
     * @notice Updates skill verification status based on verified endorsements
     * @param profile Creator profile storage reference
     * @param skillEndorsements Mapping of skill endorsements
     * @return isSkillVerified Whether skills are now verified
     */
    function updateSkillVerification(
        ICreatorReputationTracker.CreatorProfile storage profile,
        mapping(address => mapping(string => ICreatorReputationTracker.SkillEndorsement[])) storage skillEndorsements,
        address creator
    ) public returns (bool isSkillVerified) {
        // Count verified skill endorsements
        // CRITICAL: Explicitly initialize to prevent uninitialized variable warnings
        uint256 verifiedEndorsements = 0;
        string[] memory skills = profile.metadata.skills;
        uint256 skillsLength = skills.length;
        
        for (uint256 i; i < skillsLength;) {
            ICreatorReputationTracker.SkillEndorsement[] storage endorsements = 
                skillEndorsements[creator][skills[i]];
            
            uint256 endorsementsLength = endorsements.length;
            for (uint256 j; j < endorsementsLength;) {
                if (endorsements[j].isVerified) {
                    unchecked { ++verifiedEndorsements; }
                    break; // Count each skill only once
                }
                unchecked { ++j; }
            }
            unchecked { ++i; }
        }

        // Update skill verification status
        isSkillVerified = verifiedEndorsements >= MIN_VERIFIED_ENDORSEMENTS;
        profile.verification.isSkillVerified = isSkillVerified;
    }

    /**
     * @notice Updates overall verification level
     * @param profile Creator profile storage reference
     * @return verificationLevel New verification level
     */
    function updateVerificationLevel(
        ICreatorReputationTracker.CreatorProfile storage profile
    ) public returns (uint8 verificationLevel) {
        // CRITICAL: Explicitly initialize to prevent uninitialized variable warnings
        uint256 verificationCount = 0;
        ICreatorReputationTracker.VerificationStatus storage verification = profile.verification;
        
        unchecked {
            if (verification.isIdentityVerified) ++verificationCount;
            if (verification.isAddressVerified) ++verificationCount;
            if (verification.isBusinessVerified) ++verificationCount;
            if (verification.isSkillVerified) ++verificationCount;
            if (verification.isSocialVerified) ++verificationCount;
        }

        verificationLevel = uint8(verificationCount);
        verification.verificationLevel = verificationLevel;
        verification.lastVerificationUpdate = block.timestamp;
    }

    /**
     * @notice Checks if creator should be added to leaderboards
     * @param reputationScore Current reputation score
     * @param verificationLevel Current verification level
     * @return shouldAddToReputation Whether to add to reputation leaderboard
     * @return shouldAddToVerified Whether to add to verified creators list
     */
    function shouldUpdateLeaderboards(
        uint256 reputationScore,
        uint8 verificationLevel
    ) public pure returns (bool shouldAddToReputation, bool shouldAddToVerified) {
        shouldAddToReputation = reputationScore > HIGH_REPUTATION_THRESHOLD;
        shouldAddToVerified = verificationLevel > MIN_VERIFICATION_LEVEL_FOR_TRUST;
    }

    /**
     * @notice Updates reputation metrics in creator profile
     * @param profile Creator profile storage reference
     * @param metrics Calculated campaign metrics
     */
    function updateReputationMetrics(
        ICreatorReputationTracker.CreatorProfile storage profile,
        SharedTypes.CampaignMetrics memory metrics
    ) public {
        profile.reputation.totalCampaigns = metrics.totalCampaigns;
        profile.reputation.successfulCampaigns = metrics.successfulCampaigns;
        profile.reputation.completedCampaigns = metrics.completedCampaigns;
        profile.reputation.totalFundsRaised = metrics.totalFundsRaised;
        profile.reputation.totalBackers = metrics.totalBackers;
        profile.reputation.averageBackerSatisfaction = metrics.averageSatisfaction;
        profile.reputation.lastMetricUpdate = block.timestamp;
    }
}

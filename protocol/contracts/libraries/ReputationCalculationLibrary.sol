// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ICreatorReputationTracker} from "../interfaces/ICreatorReputationTracker.sol";
import {SharedTypes} from "./SharedTypes.sol";
import {ErrorLibrary} from "./ErrorLibrary.sol";

/**
 * @title ReputationCalculationLibrary
 * @author Aegis Protocol Team
 * @notice Library for reputation score calculations
 * @dev Extracted from CreatorReputationTracker to reduce contract size
 */
library ReputationCalculationLibrary {
    /// @notice Maximum reputation score
    uint256 public constant MAX_REPUTATION_SCORE = 1000;
    
    /// @notice Minimum reputation score
    uint256 public constant MIN_REPUTATION_SCORE = 0;

    /**
     * @dev Process feedback and update reputation metrics
     * @param reputation Storage reference to reputation metrics
     * @param feedback Feedback data
     * @param weights Reputation weights for calculations
     */
    function processFeedback(
        ICreatorReputationTracker.ReputationMetrics storage reputation,
        ICreatorReputationTracker.BackerFeedback memory feedback,
        SharedTypes.SystemConfig memory weights
    ) public {
        // Calculate weighted average for backer satisfaction
        uint256 totalRatings = reputation.totalBackers;
        uint256 currentSatisfaction = reputation.averageBackerSatisfaction;
        
        // Calculate new average satisfaction
        uint256 newSatisfaction = totalRatings == 0 ? feedback.overallRating : 
            ((currentSatisfaction * totalRatings) + feedback.overallRating) / (totalRatings + 1);
        
        reputation.averageBackerSatisfaction = newSatisfaction;
        unchecked { reputation.totalBackers += 1; }
        reputation.lastMetricUpdate = block.timestamp;
        
        // Update reputation score based on feedback
        _updateReputationScore(reputation, weights);
    }

    /**
     * @dev Update creator reputation metrics
     * @param reputation Storage reference to reputation metrics     * @param fundsRaised Amount of funds raised
     * @param fundingGoal Original funding goal
     * @param completionTime Time taken to complete
     * @param isSuccessful Whether campaign was successful
     * @param isCompleted Whether campaign was completed
     * @param weights Reputation weights for calculations
     */
    function updateCreatorReputation(
        ICreatorReputationTracker.ReputationMetrics storage reputation,
        uint256 /* campaignId */,
        uint256 fundsRaised,
        uint256 fundingGoal,
        uint256 completionTime,
        bool isSuccessful,
        bool isCompleted,
        SharedTypes.SystemConfig memory weights
    ) public {
        unchecked { reputation.totalCampaigns += 1; }
        
        if (isSuccessful) {
            unchecked { reputation.successfulCampaigns += 1; }
        }
        
        if (isCompleted) {
            unchecked { reputation.completedCampaigns += 1; }
        }
        
        // Update total funds raised
        reputation.totalFundsRaised += fundsRaised;
        
        // Calculate and update average funding ratio
        uint256 fundingRatio = fundingGoal > 0 ? (fundsRaised * 100) / fundingGoal : 0;
        reputation.averageFundingRatio = _calculateNewAverage(
            reputation.averageFundingRatio,
            fundingRatio,
            reputation.totalCampaigns
        );
        
        // Update average completion time if completed
        if (isCompleted && completionTime > 0) {
            reputation.averageCompletionTime = _calculateNewAverage(
                reputation.averageCompletionTime,
                completionTime,
                reputation.completedCampaigns
            );
        }
        
        reputation.lastMetricUpdate = block.timestamp;
        
        // Recalculate reputation score
        _updateReputationScore(reputation, weights);
    }

    /**
     * @dev Calculate new average value
     * @param currentAverage Current average value
     * @param newValue New value to include
     * @param count Total count including new value
     * @return New average value
     */
    function _calculateNewAverage(
        uint256 currentAverage,
        uint256 newValue,
        uint256 count
    ) private pure returns (uint256) {
        if (count == 0) return newValue;
        return ((currentAverage * (count - 1)) + newValue) / count;
    }

    /**
     * @dev Update reputation score based on metrics
     * @param reputation Storage reference to reputation metrics
     * @param weights Reputation weights for calculations
     */
    function _updateReputationScore(
        ICreatorReputationTracker.ReputationMetrics storage reputation,
        SharedTypes.SystemConfig memory weights
    ) private {
        // Cache values to reduce storage reads
        uint256 totalCampaigns = reputation.totalCampaigns;
        uint256 successfulCampaigns = reputation.successfulCampaigns;
        uint256 completedCampaigns = reputation.completedCampaigns;
        uint256 averageBackerSatisfaction = reputation.averageBackerSatisfaction;
        uint256 averageFundingRatio = reputation.averageFundingRatio;
        
        // Calculate success rate (0-100)
        uint256 successRate = totalCampaigns > 0 ? (successfulCampaigns * 100) / totalCampaigns : 0;
        
        // Calculate completion rate (0-100)
        uint256 completionRate = totalCampaigns > 0 ? (completedCampaigns * 100) / totalCampaigns : 0;
        
        // Calculate weighted reputation score
        uint256 score = (
            (successRate * weights.successRateWeight) +
            (completionRate * weights.completionRateWeight) +
            (averageBackerSatisfaction * weights.backerSatisfactionWeight) +
            (averageFundingRatio * weights.fundingRatioWeight)
        ) / 100;
        
        reputation.reputationScore = score;
    }

    /**
     * @dev Calculate trust score based on reputation metrics
     * @param reputation Reputation metrics
     * @return Trust score (0-100)
     */
    function _calculateTrustScore(
        ICreatorReputationTracker.ReputationMetrics storage reputation
    ) private view returns (uint256) {
        // Cache values to reduce storage reads
        uint256 totalCampaigns = reputation.totalCampaigns;
        uint256 disputeCount = reputation.disputeCount;
        uint256 reputationScore = reputation.reputationScore;
        
        if (totalCampaigns == 0) return 0;
        
        // Base trust score from reputation
        uint256 trustScore = reputationScore;
        
        // Apply dispute penalty
        if (disputeCount > 0) {
            uint256 disputeRate = (disputeCount * 100) / totalCampaigns;
            uint256 penalty = disputeRate * 5; // 5% penalty per 1% dispute rate
            trustScore = trustScore > penalty ? trustScore - penalty : 0;
        }
        
        return trustScore > MAX_REPUTATION_SCORE ? MAX_REPUTATION_SCORE : trustScore;
    }
}

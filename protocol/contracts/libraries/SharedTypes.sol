// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/**
 * @title SharedTypes
 * @notice Library containing shared data structures and constants for the reputation system
 * @dev Centralizes common types to reduce contract size and improve maintainability
 */
library SharedTypes {
    /**
     * @dev Campaign metrics structure for reputation calculations
     */
    struct CampaignMetrics {
        uint256 totalCampaigns;
        uint256 successfulCampaigns;
        uint256 completedCampaigns;
        uint256 totalFundsRaised;
        uint256 totalBackers;
        uint256 averageSatisfaction;
    }

    /**
     * @dev System configuration parameters
     */
    struct SystemConfig {
        uint256 successRateWeight;
        uint256 completionRateWeight;
        uint256 backerSatisfactionWeight;
        uint256 disputeResolutionWeight;
        uint256 verificationWeight;
        uint256 fundingRatioWeight;
        uint256 minimumBondAmount;
        uint256 feedbackIncentive;
        uint256 verificationStake;
        uint256 endorsementStake;
    }

    /**
     * @dev Leaderboard arrays structure
     */
    struct Leaderboards {
        address[] topCreatorsByReputation;
        address[] topCreatorsByTrust;
        address[] verifiedCreators;
        address[] bondedCreators;
    }

    /**
     * @dev Incentive configuration parameters
     */
    struct IncentiveConfig {
        uint256 feedbackReward;
        uint256 endorsementReward;
        uint256 verificationBonus;
        uint256 bondingIncentive;
    }

    // Reputation weight constants
    uint256 public constant DEFAULT_SUCCESS_RATE_WEIGHT = 30;
    uint256 public constant DEFAULT_COMPLETION_RATE_WEIGHT = 25;
    uint256 public constant DEFAULT_BACKER_SATISFACTION_WEIGHT = 20;
    uint256 public constant DEFAULT_DISPUTE_RESOLUTION_WEIGHT = 15;
    uint256 public constant DEFAULT_VERIFICATION_WEIGHT = 10;

    // Verification thresholds
    uint256 public constant MIN_VERIFICATION_LEVEL = 3;
    uint256 public constant MAX_VERIFICATION_LEVEL = 5;
    uint256 public constant SKILL_VERIFICATION_THRESHOLD = 3;

    // Incentive amounts (in wei)
    uint256 public constant DEFAULT_FEEDBACK_REWARD = 0.001 ether;
    uint256 public constant DEFAULT_ENDORSEMENT_REWARD = 0.0005 ether;
    uint256 public constant DEFAULT_VERIFICATION_BONUS = 0.01 ether;
    uint256 public constant DEFAULT_BONDING_INCENTIVE = 0.005 ether;
}

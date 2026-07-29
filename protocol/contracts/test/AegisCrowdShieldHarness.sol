// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "../crowdfunding/AegisCrowdShield.sol";

/**
 * @title AegisCrowdShieldHarness
 * @notice Harness for Certora formal verification
 * @dev Exposes struct fields as individual functions for CVL2 compatibility
 * @author Sentinel Security Team
 */
contract AegisCrowdShieldHarness is AegisCrowdShield {
    /**
     * @notice Constructor for harness contract
     * @param _verifierFactory Address of the verifier factory
     * @param _governanceContract Address of the governance contract
     */
    constructor(address _verifierFactory, address _governanceContract) 
        AegisCrowdShield(_verifierFactory, _governanceContract) 
    {}

    /**
     * @notice Get campaign creator address
     * @param campaignId The campaign identifier
     * @return The creator address
     */
    function getCampaignCreator(uint256 campaignId) external view returns (address) {
        return campaigns[campaignId].creator;
    }

    /**
     * @notice Get total amount raised for a campaign
     * @param campaignId The campaign identifier
     * @return The total amount raised
     */
    function getCampaignTotalRaised(uint256 campaignId) external view returns (uint256) {
        return campaigns[campaignId].totalRaised;
    }

    /**
     * @notice Get target amount for a campaign
     * @param campaignId The campaign identifier
     * @return The target amount
     */
    function getCampaignTargetAmount(uint256 campaignId) external view returns (uint256) {
        return campaigns[campaignId].targetAmount;
    }

    /**
     * @notice Get deadline for a campaign
     * @param campaignId The campaign identifier
     * @return The deadline timestamp
     */
    function getCampaignDeadline(uint256 campaignId) external view returns (uint256) {
        return campaigns[campaignId].deadline;
    }

    /**
     * @notice Get status of a campaign
     * @param campaignId The campaign identifier
     * @return The campaign status (as uint8)
     */
    function getCampaignStatus(uint256 campaignId) external view returns (uint8) {
        return uint8(campaigns[campaignId].status);
    }

    /**
     * @notice Get payment token for a campaign
     * @param campaignId The campaign identifier
     * @return The payment token address
     */
    function getCampaignPaymentToken(uint256 campaignId) external view returns (address) {
        return campaigns[campaignId].paymentToken;
    }

    /**
     * @notice Get contribution amount for a contributor
     * @param campaignId The campaign identifier
     * @param contributor The contributor address
     * @return The contribution amount
     */
    function getContributionAmount(uint256 campaignId, address contributor) external view returns (uint256) {
        return contributions[campaignId][contributor].amount;
    }

    /**
     * @notice Get contribution timestamp for a contributor
     * @param campaignId The campaign identifier
     * @param contributor The contributor address
     * @return The contribution timestamp
     */
    function getContributionTimestamp(uint256 campaignId, address contributor) external view returns (uint256) {
        return contributions[campaignId][contributor].timestamp;
    }

    /**
     * @notice Create campaign with default sovereignty config (for Certora verification)
     * @param targetAmount The funding goal
     * @param duration The campaign duration
     * @param paymentToken The payment token address
     * @param commitmentHash The commitment hash
     * @param isPrivate Whether the campaign is private
     * @return campaignId The created campaign ID
     */
    function createCampaignDefault(
        uint256 targetAmount,
        uint256 duration,
        address paymentToken,
        bytes32 commitmentHash,
        bool isPrivate
    ) external returns (uint256 campaignId) {
        // Create default sovereignty config
        IndividualSovereigntyConfig memory config = IndividualSovereigntyConfig({
            enablePrivateContributions: true,
            enableMarketDrivenDisputes: true,
            enableVoluntaryCompliance: false,
            enableSpontaneousOrder: true,
            minimumStakeForSovereignty: 0,
            minimumContribution: 1,
            maximumContribution: targetAmount
        });
        
        return this.createCampaign(targetAmount, duration, paymentToken, commitmentHash, isPrivate, config);
    }
}


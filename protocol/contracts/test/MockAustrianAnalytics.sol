// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/**
 * @title MockAustrianAnalytics
 * @dev Mock contract for testing PraxeologicalRewards
 * Provides simplified Austrian Economics analytics for testing purposes
 */
contract MockAustrianAnalytics {
    // Mock data structures
    struct ActorBehavior {
        uint256 totalActions;
        uint256 totalValue;
        uint256 praxeologicalScore;
        uint256 catallacticContribution;
        uint256 subjectiveValueIndex;
        uint256 temporalCoordination;
        uint256 entrepreneurialAction;
        uint256 marketProcessScore;
        uint256 marginalUtilityScore;
        uint256 lastActionTime;
        bool isActive;
    }

    struct CampaignAnalytics {
        uint256 campaignId;
        uint256 totalParticipants;
        uint256 totalActions;
        uint256 totalValue;
        uint256 praxeologicalScore;
        uint256 catallacticScore;
        uint256 marketProcessScore;
        uint256 coordinationEfficiency;
        uint256 informationTransmission;
        uint256 voluntaryExchangeIndex;
        uint256 competitiveDiscovery;
        uint256 spontaneousOrderIndex;
        bool isActive;
    }

    // Mock storage
    mapping(uint256 => mapping(address => ActorBehavior)) public campaignActorBehavior;
    mapping(address => ActorBehavior) public globalActorBehavior;
    mapping(uint256 => CampaignAnalytics) public campaignAnalytics;
    mapping(uint256 => bool) public activeCampaigns;
    mapping(uint256 => address[]) public campaignActors;

    // Mock events
    event CampaignAnalysisStarted(uint256 indexed campaignId);
    event ActionRecorded(uint256 indexed campaignId, address indexed actor, uint8 actionType, uint256 value);

    /**
     * @dev Start analysis for a campaign
     */
    function startCampaignAnalysis(uint256 campaignId) external {
        require(!activeCampaigns[campaignId], "Campaign already active");
        
        activeCampaigns[campaignId] = true;
        campaignAnalytics[campaignId] = CampaignAnalytics({
            campaignId: campaignId,
            totalParticipants: 0,
            totalActions: 0,
            totalValue: 0,
            praxeologicalScore: 100,
            catallacticScore: 100,
            marketProcessScore: 100,
            coordinationEfficiency: 100,
            informationTransmission: 100,
            voluntaryExchangeIndex: 100,
            competitiveDiscovery: 100,
            spontaneousOrderIndex: 100,
            isActive: true
        });

        emit CampaignAnalysisStarted(campaignId);
    }

    /**
     * @dev Record an action for Austrian Economics analysis
     */
    function recordAction(
        uint256 campaignId,
        address actor,
        uint8 actionType,
        uint256 value
    ) external {
        require(activeCampaigns[campaignId], "Campaign not active");

        // Update campaign-specific actor behavior
        ActorBehavior storage behavior = campaignActorBehavior[campaignId][actor];
        if (!behavior.isActive) {
            behavior.isActive = true;
            campaignAnalytics[campaignId].totalParticipants++;
            // Add actor to campaign actors list
            campaignActors[campaignId].push(actor);
        }

        behavior.totalActions++;
        behavior.totalValue += value;
        behavior.lastActionTime = block.timestamp;

        // Calculate mock scores based on contribution value
        uint256 baseScore = _calculateBaseScore(value);
        behavior.praxeologicalScore = baseScore;
        behavior.catallacticContribution = baseScore + 10;
        behavior.subjectiveValueIndex = baseScore + 5;
        behavior.temporalCoordination = baseScore + 15;
        behavior.entrepreneurialAction = baseScore + 20;
        behavior.marketProcessScore = baseScore + 8;
        behavior.marginalUtilityScore = baseScore + 12;

        // Update global actor behavior
        ActorBehavior storage globalBehavior = globalActorBehavior[actor];
        globalBehavior.totalActions++;
        globalBehavior.totalValue += value;
        globalBehavior.lastActionTime = block.timestamp;
        globalBehavior.isActive = true;

        // Update global scores (simplified)
        globalBehavior.praxeologicalScore = (globalBehavior.praxeologicalScore + baseScore) / 2;
        globalBehavior.catallacticContribution = (globalBehavior.catallacticContribution + baseScore + 10) / 2;
        globalBehavior.subjectiveValueIndex = (globalBehavior.subjectiveValueIndex + baseScore + 5) / 2;
        globalBehavior.temporalCoordination = (globalBehavior.temporalCoordination + baseScore + 15) / 2;
        globalBehavior.entrepreneurialAction = (globalBehavior.entrepreneurialAction + baseScore + 20) / 2;
        globalBehavior.marketProcessScore = (globalBehavior.marketProcessScore + baseScore + 8) / 2;
        globalBehavior.marginalUtilityScore = (globalBehavior.marginalUtilityScore + baseScore + 12) / 2;

        // Update campaign analytics
        CampaignAnalytics storage analytics = campaignAnalytics[campaignId];
        analytics.totalActions++;
        analytics.totalValue += value;

        emit ActionRecorded(campaignId, actor, actionType, value);
    }

    /**
     * @dev Get campaign actor behavior with debugging
     */
    function getCampaignActorBehavior(uint256 campaignId, address actor) 
        external 
        view 
        returns (ActorBehavior memory) 
    {
        ActorBehavior memory behavior = campaignActorBehavior[campaignId][actor];
        
        // Debug logging - these will show up in hardhat console
        // console.log("getCampaignActorBehavior - campaignId:", campaignId);
        // console.log("getCampaignActorBehavior - actor:", actor);
        // console.log("getCampaignActorBehavior - totalValue:", behavior.totalValue);
        // console.log("getCampaignActorBehavior - totalActions:", behavior.totalActions);
        
        return behavior;
    }

    /**
     * @dev Get global actor behavior
     */
    function getGlobalActorBehavior(address actor) 
        external 
        view 
        returns (ActorBehavior memory) 
    {
        return globalActorBehavior[actor];
    }

    /**
     * @dev Get campaign analytics
     */
    function getCampaignAnalytics(uint256 campaignId) 
        external 
        view 
        returns (CampaignAnalytics memory) 
    {
        return campaignAnalytics[campaignId];
    }

    /**
     * @dev Check if campaign is active
     */
    function isCampaignActive(uint256 campaignId) external view returns (bool) {
        return activeCampaigns[campaignId];
    }

    /**
     * @dev Get campaign actors list
     */
    function getCampaignActors(uint256 campaignId) external view returns (address[] memory) {
        return campaignActors[campaignId];
    }

    /**
     * @dev Calculate base score from value (simplified mock calculation)
     */
    function _calculateBaseScore(uint256 value) internal pure returns (uint256) {
        if (value == 0) return 50; // Base participation score
        
        // Simple logarithmic-like scaling
        uint256 score = 50 + (value / 1e16); // Scale down from wei
        
        // Cap at reasonable maximum
        if (score > 200) score = 200;
        
        return score;
    }

    /**
     * @dev Stop campaign analysis (for testing)
     */
    function stopCampaignAnalysis(uint256 campaignId) external {
        require(activeCampaigns[campaignId], "Campaign not active");
        
        activeCampaigns[campaignId] = false;
        campaignAnalytics[campaignId].isActive = false;
    }

    /**
     * @dev Reset all data (for testing)
     */
    function resetAllData() external {
        // This would reset all mappings in a real implementation
        // For testing purposes, we'll just emit an event
        emit CampaignAnalysisStarted(0); // Use as reset signal
    }
}
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "./../interfaces/ICommonErrors.sol";
import {IPrivateGovernance} from "../interfaces/IPrivateGovernance.sol";
import {Groth16Verifier} from "../Groth16Verifier.sol"; // Generated Groth16 verifier
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title CrowdfundingVerifier
 * @author Aegis Protocol Team
 * @dev Verifier wrapper for crowdfunding ZK circuit implementing Austrian Economics principles:
 *      - Individual Sovereignty: Private contribution verification without revealing amounts
 *      - Voluntary Association: Cryptographic proof of voluntary participation
 *      - Sound Money: Mathematical proof of contribution validity
 *      - Spontaneous Order: Decentralized contribution coordination
 *      - Methodological Individualism: Individual contribution tracking and verification
 *      - Decentralized Governance: No admin privileges, all decisions through DAO governance
 * 
 * @notice DAO TRANSFORMATION COMPLETE:
 *         - Removed all admin privileges and Ownable inheritance
 *         - Implemented automated reputation system based on contribution history
 *         - Added governance-based campaign status control via PrivateGovernance
 *         - Integrated automated campaign lifecycle management
 *         - All critical functions now operate autonomously or through community governance
 */
contract CrowdfundingVerifier is ReentrancyGuard, ICommonErrors{
    
    /// @notice The Groth16 verifier contract for crowdfunding circuit
    Groth16Verifier public immutable GROTH16_VERIFIER;

    /// @notice Contribution verification data
    struct ContributionProof {
        uint256[2] a;           // Proof point A
        uint256[2][2] b;        // Proof point B  
        uint256[2] c;           // Proof point C
        uint256[] publicInputs; // Public inputs to the circuit
        bytes32 nullifierHash;  // Nullifier to prevent double-spending
        uint256 timestamp;      // Proof generation timestamp
        bool verified;          // Whether proof has been verified
        address contributor;    // Address that submitted the proof
    }

    /// @notice Austrian Economics compliance metrics
    struct AustrianMetrics {
        uint256 voluntaryContributions;    // Count of voluntary contributions
        uint256 individualSovereignty;     // Individual sovereignty score
        uint256 soundMoneyProof;          // Sound money verification score
        uint256 spontaneousOrder;         // Spontaneous order coordination
        uint256 methodologicalIndividualism; // Individual action tracking
        bool austrianCompliance;          // Overall Austrian compliance
    }

    /// @notice Campaign contribution tracking
    struct CampaignContributions {
        mapping(bytes32 => bool) nullifiers;        // Used nullifiers
        mapping(address => uint256) contributorCount; // Contributions per address
        ContributionProof[] proofs;                 // All contribution proofs
        AustrianMetrics metrics;                    // Austrian Economics metrics
        uint256 totalContributions;                // Total contribution count
        uint256 verifiedContributions;             // Verified contribution count
        bool isActive;                              // Whether campaign is active
        uint256 creationTime;                       // Campaign creation timestamp
    }

    /// @notice Mapping of campaign ID to contribution data
    mapping(uint256 => CampaignContributions) public campaigns;

    /// @notice Mapping of nullifier hash to campaign ID
    mapping(bytes32 => uint256) public nullifierToCampaign;

    /// @notice Mapping of contributor to reputation score
    mapping(address => uint256) public contributorReputation;

    /// @notice Active campaigns list
    uint256[] public activeCampaigns;

    /// @notice Campaign counter
    uint256 public campaignCounter;

    /// @notice Maximum contributions per campaign
    uint256 public constant MAX_CONTRIBUTIONS_PER_CAMPAIGN = 10000;

    /// @notice Maximum contributions per contributor per campaign
    uint256 public constant MAX_CONTRIBUTIONS_PER_CONTRIBUTOR = 100;

    /// @notice Minimum reputation score for contributions
    uint256 public constant MIN_REPUTATION_SCORE = 50;

    /// @notice Events
    
    /// @notice Emitted when a new campaign is created
    /// @param campaignId The unique identifier of the campaign
    /// @param creator The address that created the campaign
    /// @param timestamp The block timestamp when the campaign was created
    event CampaignCreated(
        uint256 indexed campaignId,
        address indexed creator,
        uint256 timestamp
    );

    /// @notice Emitted when a contribution is successfully verified
    /// @param campaignId The campaign identifier
    /// @param nullifierHash The unique nullifier hash for this contribution
    /// @param contributor The address of the contributor
    /// @param timestamp The block timestamp when the contribution was verified
    event ContributionVerified(
        uint256 indexed campaignId,
        bytes32 indexed nullifierHash,
        address indexed contributor,
        uint256 timestamp
    );

    /// @notice Emitted when Austrian Economics metrics are updated
    /// @param campaignId The campaign identifier
    /// @param metrics The updated Austrian Economics metrics
    event AustrianMetricsUpdated(
        uint256 indexed campaignId,
        AustrianMetrics metrics
    );

    /// @notice Emitted when a contributor's reputation is updated
    /// @param contributor The contributor's address
    /// @param oldScore The previous reputation score
    /// @param newScore The new reputation score
    event ReputationUpdated(
        address indexed contributor,
        uint256 oldScore,
        uint256 newScore
    );

    /// @notice Emitted when a campaign's status changes
    /// @param campaignId The campaign identifier
    /// @param isActive The new active status of the campaign
    event CampaignStatusChanged(
        uint256 indexed campaignId,
        bool isActive
    );

    /// @notice Custom errors

    error CampaignNotFound();
    error CampaignNotActive();
    error MaxContributionsReached();
    error ContributorLimitReached();
    error InsufficientReputation();

    /// @notice The governance contract for decentralized decision making
    IPrivateGovernance public immutable GOVERNANCE;
    
    constructor(address _groth16Verifier, address _governance) {
        GROTH16_VERIFIER = Groth16Verifier(_groth16Verifier);
        GOVERNANCE = IPrivateGovernance(_governance);
    }

    /**
     * @notice Create a new crowdfunding campaign
     * @return campaignId The ID of the created campaign
     */
    function createCampaign() external returns (uint256 campaignId) {
        campaignId = ++campaignCounter;
        
        CampaignContributions storage campaign = campaigns[campaignId];
        campaign.isActive = true;
        campaign.creationTime = block.timestamp;
        campaign.metrics = AustrianMetrics(0, 0, 0, 0, 0, false);
        
        activeCampaigns.push(campaignId);
        
        emit CampaignCreated(campaignId, msg.sender, block.timestamp);
        return campaignId;
    }

    /**
     * @notice Verify a crowdfunding contribution proof
     * @param proof The ZK proof components (8 elements: a[2], b[2][2], c[2])
     * @param publicInputs The public inputs to the circuit (minimum 8 elements required)
     * @return bool Whether the proof is valid
     */
    function verifyContribution(
        uint256 campaignId,
        uint256[8] calldata proof,
        uint256[] calldata publicInputs
    ) external nonReentrant returns (bool) {
        CampaignContributions storage campaign = campaigns[campaignId];
        
        // Validate campaign and contribution limits
        _validateCampaignAndLimits(campaign, campaignId);
        
        // Validate public inputs and nullifier
        bytes32 nullifierHash = _validateInputsAndNullifier(campaign, publicInputs);
        
        // Verify ZK proof and store contribution
        ContributionProof memory contributionProof = _verifyAndStoreProof(
            campaign, 
            proof, 
            publicInputs, 
            nullifierHash
        );
        
        // Update tracking and metrics
        _updateContributionTracking(campaign, campaignId, nullifierHash, contributionProof);
        
        return true;
    }

    /**
     * @notice Validate campaign status and contribution limits
     * @param campaign The campaign storage reference     */
    function _validateCampaignAndLimits(
        CampaignContributions storage campaign,
        uint256 /* campaignId */) private view {
        if (campaign.creationTime == 0) revert CampaignNotFound();
        if (!campaign.isActive) revert CampaignNotActive();
        
        if (campaign.totalContributions >= MAX_CONTRIBUTIONS_PER_CAMPAIGN) {
            revert MaxContributionsReached();
        }
        if (campaign.contributorCount[msg.sender] >= MAX_CONTRIBUTIONS_PER_CONTRIBUTOR) {
            revert ContributorLimitReached();
        }
        if (contributorReputation[msg.sender] < MIN_REPUTATION_SCORE) {
            revert InsufficientReputation();
        }
    }

    /**
     * @notice Validate public inputs and nullifier uniqueness
     * @param campaign The campaign storage reference
     * @param publicInputs The public inputs array
     * @return nullifierHash The extracted nullifier hash
     */
    function _validateInputsAndNullifier(
        CampaignContributions storage campaign,
        uint256[] calldata publicInputs
    ) private view returns (bytes32) {
        if (publicInputs.length < 8) revert InvalidPublicInputs();
        
        bytes32 nullifierHash = bytes32(publicInputs[2]);
        
        if (campaign.nullifiers[nullifierHash]) revert NullifierAlreadyUsed();
        if (nullifierToCampaign[nullifierHash] != 0) revert NullifierAlreadyUsed();
        
        return nullifierHash;
    }

    /**
     * @notice Verify ZK proof and create contribution proof struct
     * @param campaign The campaign storage reference
     * @param proof The ZK proof components
     * @param publicInputs The public inputs array
     * @param nullifierHash The nullifier hash
     * @return contributionProof The created contribution proof
     */
    function _verifyAndStoreProof(
        CampaignContributions storage campaign,
        uint256[8] calldata proof,
        uint256[] calldata publicInputs,
        bytes32 nullifierHash
    ) private returns (ContributionProof memory) {
        uint256[2] memory a = [proof[0], proof[1]];
        uint256[2][2] memory b = [[proof[2], proof[3]], [proof[4], proof[5]]];
        uint256[2] memory c = [proof[6], proof[7]];
        
        bool isValid = GROTH16_VERIFIER.verifyProof(a, b, c, publicInputs);
        if (!isValid) revert InvalidProof();

        ContributionProof memory contributionProof = ContributionProof({
            a: a,
            b: b,
            c: c,
            publicInputs: publicInputs,
            nullifierHash: nullifierHash,
            timestamp: block.timestamp,
            verified: true,
            contributor: msg.sender
        });

        campaign.proofs.push(contributionProof);
        return contributionProof;
    }

    /**
     * @notice Update contribution tracking and metrics
     * @param campaign The campaign storage reference     * @param nullifierHash The nullifier hash
     * @param contributionProof The contribution proof
     */
    function _updateContributionTracking(
        CampaignContributions storage campaign,
        uint256 campaignId,
        bytes32 nullifierHash,
        ContributionProof memory contributionProof
    ) private {
        campaign.nullifiers[nullifierHash] = true;
        ++campaign.contributorCount[msg.sender];
        ++campaign.totalContributions;
        ++campaign.verifiedContributions;
        
        nullifierToCampaign[nullifierHash] = campaignId;

        _updateAustrianMetrics(campaignId, contributionProof);
        
        // Automated reputation update based on contribution history
        _updateAutomatedReputation(msg.sender);

        emit ContributionVerified(campaignId, nullifierHash, msg.sender, block.timestamp);
    }

    /**
     * @notice Update Austrian Economics metrics for a campaign     * @param proof The contribution proof
     */
    function _updateAustrianMetrics(
        uint256 campaignId,
        ContributionProof memory proof
    ) private {
        CampaignContributions storage campaign = campaigns[campaignId];
        AustrianMetrics storage metrics = campaign.metrics;

        // Individual Sovereignty: Each proof represents individual choice
        ++metrics.voluntaryContributions;
        metrics.individualSovereignty += _calculateSovereigntyScore(proof);

        // Sound Money: Cryptographic proof verification
        metrics.soundMoneyProof += _calculateSoundnessScore(proof);

        // Spontaneous Order: Decentralized coordination efficiency
        metrics.spontaneousOrder += _calculateOrderScore(campaign);

        // Methodological Individualism: Individual action tracking
        metrics.methodologicalIndividualism += _calculateIndividualismScore(proof);

        // Overall Austrian compliance check
        metrics.austrianCompliance = _validateAustrianCompliance(metrics);

        emit AustrianMetricsUpdated(campaignId, metrics);
    }

    /**
     * @notice Calculate individual sovereignty score
     * @param proof The contribution proof
     * @return uint256 The sovereignty score
     */
    function _calculateSovereigntyScore(ContributionProof memory proof) private pure returns (uint256) {
        // Score based on proof complexity and individual choice indicators
        uint256 score = 0;
        
        // Check for individual choice indicators in public inputs
        if (proof.publicInputs.length >= 8) {
            // Campaign ID uniqueness
            score += proof.publicInputs[0] != 0 ? 10 : 0;
            
            // Contribution commitment uniqueness
            score += proof.publicInputs[1] != 0 ? 15 : 0;
            
            // Nullifier uniqueness (prevents coercion)
            score += proof.publicInputs[2] != 0 ? 20 : 0;
            
            // Merkle root participation proof
            score += proof.publicInputs[3] != 0 ? 10 : 0;
        }
        
        return score;
    }

    /**
     * @notice Calculate sound money proof score
     * @param proof The contribution proof
     * @return uint256 The soundness score
     */
    function _calculateSoundnessScore(ContributionProof memory proof) private pure returns (uint256) {
        // Score based on cryptographic proof strength
        uint256 score = 0;
        
        // Proof point validation
        score += (proof.a[0] != 0 && proof.a[1] != 0) ? 25 : 0;
        score += (proof.b[0][0] != 0 && proof.b[0][1] != 0 && 
                 proof.b[1][0] != 0 && proof.b[1][1] != 0) ? 25 : 0;
        score += (proof.c[0] != 0 && proof.c[1] != 0) ? 25 : 0;
        
        // Public input validation
        score += proof.publicInputs.length >= 8 ? 25 : 0;
        
        return score;
    }

    /**
     * @notice Calculate spontaneous order score
     * @param campaign The campaign data
     * @return uint256 The order score
     */
    function _calculateOrderScore(CampaignContributions storage campaign) private view returns (uint256) {
        // Score based on decentralized coordination efficiency
        uint256 created = campaign.creationTime;
        uint256 timeElapsed = created > block.timestamp ? 0 : block.timestamp - created;
        if (timeElapsed == 0) return 0;
        
        // Higher score for more contributions in less time
        uint256 contributionRate = (campaign.totalContributions * 1000) / timeElapsed;
        
        // Bonus for diverse contributors
        uint256 uniqueContributors = 0;
        for (uint256 i = 0; i < campaign.proofs.length; i++) {
            // This is a simplified calculation - in practice would need more efficient tracking
            bool isUnique = true;
            for (uint256 j = 0; j < i; j++) {
                if (campaign.proofs[i].contributor == campaign.proofs[j].contributor) {
                    isUnique = false;
                    break;
                }
            }
            if (isUnique) ++uniqueContributors;
        }
        
        uint256 diversityBonus = (uniqueContributors * 100) / (campaign.totalContributions + 1);
        
        return contributionRate + diversityBonus;
    }

    /**
     * @notice Calculate methodological individualism score
     * @param proof The contribution proof
     * @return uint256 The individualism score
     */
    function _calculateIndividualismScore(ContributionProof memory proof) private view returns (uint256) {
        // Score based on individual action tracking
        uint256 score = 0;
        
        // Individual contributor tracking
        score += 20;
        
        // Unique nullifier (individual action)
        score += proof.nullifierHash != bytes32(0) ? 30 : 0;
        
        // Timestamp uniqueness (individual timing)
        score += proof.timestamp != 0 ? 20 : 0;
        
        // Contributor reputation (individual history)
        score += contributorReputation[proof.contributor] != 0 ? 30 : 0;
        
        return score;
    }

    /**
     * @notice Validate Austrian Economics compliance
     * @param metrics The Austrian metrics
     * @return bool Whether the metrics indicate Austrian compliance
     */
    function _validateAustrianCompliance(AustrianMetrics memory metrics) private pure returns (bool) {
        // Check all Austrian principles are sufficiently represented
        return (
            metrics.voluntaryContributions != 0 &&
            metrics.individualSovereignty >= 50 &&
            metrics.soundMoneyProof >= 80 &&
            metrics.spontaneousOrder >= 30 &&
            metrics.methodologicalIndividualism >= 70
        );
    }

    /**
     * @notice Update contributor reputation
     * @param contributor The contributor address
     * @param delta The reputation change
     */
    /// @notice Campaign lifecycle parameters
    uint256 public constant CAMPAIGN_DURATION = 30 days; // Default campaign duration
    uint256 public constant MIN_CONTRIBUTIONS_FOR_SUCCESS = 10; // Minimum contributions needed
    uint256 public constant INACTIVITY_THRESHOLD = 7 days; // Auto-deactivate after inactivity

    /**
     * @notice Automated campaign lifecycle management
     * @param campaignId The campaign ID to check
     * @dev Automatically manages campaign status based on time and activity
     */
    function updateCampaignLifecycle(uint256 campaignId) external {
        CampaignContributions storage campaign = campaigns[campaignId];
        if (campaign.creationTime == 0) revert CampaignNotFound();
        
        bool shouldDeactivate = false;
        
        // Auto-deactivate if campaign duration exceeded
        if (block.timestamp > campaign.creationTime + CAMPAIGN_DURATION) {
            shouldDeactivate = true;
        }
        
        // Auto-deactivate if inactive for too long
        if (campaign.totalContributions > 0) {
            // Find last contribution time (simplified - in practice would track this)
            uint256 created = campaign.creationTime;
            uint256 timeSinceLastActivity = created > block.timestamp ? 0 : block.timestamp - created;
            if (timeSinceLastActivity > INACTIVITY_THRESHOLD && 
                campaign.totalContributions < MIN_CONTRIBUTIONS_FOR_SUCCESS) {
                shouldDeactivate = true;
            }
        }
        
        if (shouldDeactivate && campaign.isActive) {
            campaign.isActive = false;
            emit CampaignStatusChanged(campaignId, false);
        }
    }

    /**
     * @notice Set campaign status through governance proposal
     * @param campaignId The campaign ID
     * @param isActive Whether the campaign should be active
     * @dev Only executable through governance proposals
     */
    function setCampaignStatus(uint256 campaignId, bool isActive) external {
        // Verify this call is from an executed governance proposal
        if(msg.sender != address(GOVERNANCE)) revert UnauthorizedAccess();
        
        CampaignContributions storage campaign = campaigns[campaignId];
        if (campaign.creationTime == 0) revert CampaignNotFound();
        
        campaign.isActive = isActive;
        emit CampaignStatusChanged(campaignId, isActive);
    }

    /**
     * @notice Automated reputation calculation based on contribution history
     * @param contributor The contributor address
     * @dev Reputation is calculated automatically based on verified contributions
     */
    function calculateAutomatedReputation(address contributor) public view returns (uint256) {
        uint256 baseReputation = 100; // Starting reputation
        uint256 contributionBonus = 0;
        uint256 consistencyBonus = 0;
        
        // Calculate contribution-based reputation
        for (uint256 i = 1; i <= campaignCounter; i++) {
            CampaignContributions storage campaign = campaigns[i];
            uint256 contributorContributions = campaign.contributorCount[contributor];
            
            if (contributorContributions > 0) {
                contributionBonus += 10; // 10 points per campaign participated
                
                // Bonus for multiple contributions in same campaign
                contributionBonus += contributorContributions * 2;
                
                // Bonus for early contributions (if campaign has few total contributions)
                if (campaign.totalContributions <= 10) {
                    contributionBonus += 5;
                }
            }
        }
        
        // Consistency bonus for regular participation
        if (contributionBonus >= 50) { // Participated in 5+ campaigns
            consistencyBonus = 25;
        }
        
        return baseReputation + contributionBonus + consistencyBonus;
    }

    /**
     * @notice Update contributor reputation automatically after each contribution
     * @param contributor The contributor address
     * @dev Called internally after successful contribution verification
     */
    function _updateAutomatedReputation(address contributor) internal {
        uint256 oldScore = contributorReputation[contributor];
        uint256 newScore = calculateAutomatedReputation(contributor);
        
        contributorReputation[contributor] = newScore;
        emit ReputationUpdated(contributor, oldScore, newScore);
    }

    /**
     * @notice Get campaign information
     * @return totalContributions The total number of contributions
     * @return verifiedContributions The number of verified contributions
     * @return isActive Whether the campaign is active
     * @return creationTime The campaign creation time
     * @return metrics The Austrian Economics metrics
     */
    function getCampaignInfo(uint256 campaignId) external view returns (
        uint256 totalContributions,
        uint256 verifiedContributions,
        bool isActive,
        uint256 creationTime,
        AustrianMetrics memory metrics
    ) {
        CampaignContributions storage campaign = campaigns[campaignId];
        return (
            campaign.totalContributions,
            campaign.verifiedContributions,
            campaign.isActive,
            campaign.creationTime,
            campaign.metrics
        );
    }

    /**
     * @notice Get contribution proofs for a campaign     * @param offset The starting index
     * @param limit The maximum number of proofs to return
     * @return ContributionProof[] Array of contribution proofs
     */
    function getContributionProofs(
        uint256 campaignId,
        uint256 offset,
        uint256 limit
    ) external view returns (ContributionProof[] memory) {
        CampaignContributions storage campaign = campaigns[campaignId];
        
        uint256 end = offset + limit;
        if (end > campaign.proofs.length) {
            end = campaign.proofs.length;
        }
        
        ContributionProof[] memory result = new ContributionProof[](end - offset);
        for (uint256 i = offset; i < end; i++) {
            result[i - offset] = campaign.proofs[i];
        }
        
        return result;
    }

    /**
     * @notice Get active campaigns
     * @return uint256[] Array of active campaign IDs
     */
    function getActiveCampaigns() external view returns (uint256[] memory) {
        return activeCampaigns;
    }

    /**
     * @notice Check if nullifier has been used
     * @param nullifierHash The nullifier hash
     * @return bool Whether the nullifier has been used
     */
    function isNullifierUsed(bytes32 nullifierHash) external view returns (bool) {
        return nullifierToCampaign[nullifierHash] != 0;
    }

    /**
     * @notice Get contributor statistics
     * @param contributor The contributor address
     * @return uint256 Number of contributions by this contributor to this campaign
     */
    function getContributorStats(address contributor, uint256 campaignId) external view returns (uint256) {
        return campaigns[campaignId].contributorCount[contributor];
    }

    /**
     * @notice Set contributor reputation (admin function)
     * @param contributor The contributor address
     * @param reputation The reputation score
     * @dev Only callable by governance for testing and initial setup
     */
    function setContributorReputation(address contributor, uint256 reputation) external {
        if(msg.sender != address(GOVERNANCE)) revert UnauthorizedAccess();
        uint256 oldScore = contributorReputation[contributor];
        contributorReputation[contributor] = reputation;
        emit ReputationUpdated(contributor, oldScore, reputation);
    }
}
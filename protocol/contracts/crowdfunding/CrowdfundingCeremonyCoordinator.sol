// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {CeremonyVerifier} from "../CeremonyVerifier.sol";
import {ICommonErrors} from "../interfaces/ICommonErrors.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/**
 * @title CrowdfundingCeremonyCoordinator
 * @author Aegis Protocol Team
 * @dev Enhanced ceremony coordinator for crowdfunding circuits implementing Austrian Economics principles:
 *      - Individual Sovereignty: Voluntary participation in trusted setup ceremonies
 *      - Spontaneous Order: Decentralized coordination of ceremony participants
 *      - Market-Driven Trust: Reputation-based ceremony validation
 *      - Sound Money: Cryptographic proof of ceremony integrity
 *      - Methodological Individualism: Individual contribution verification
 */
/// @notice Coordinates trusted setup ceremonies for crowdfunding circuits with Austrian Economics principles
contract CrowdfundingCeremonyCoordinator is Ownable, ReentrancyGuard, ICommonErrors {
    using ECDSA for bytes32;

    /// @notice Reference to the base ceremony verifier
    CeremonyVerifier public immutable CEREMONY_VERIFIER;

    /// @notice Supported circuit types for crowdfunding
    enum CircuitType {
        CROWDFUNDING,
        MILESTONE,
        REFUND,
        REPUTATION,
        ANALYTICS
    }

    /// @notice Circuit configuration for ceremonies
    struct CircuitConfig {
        string name;                    // Circuit name
        bytes32 powersOfTauHash;        // Powers of Tau hash
        uint256 minParticipants;        // Minimum participants required
        uint256 maxParticipants;        // Maximum participants allowed
        uint256 contributionDeadline;   // Deadline for contributions
        uint256 verificationPeriod;     // Time for verification
        uint256 minReputationScore;     // Minimum reputation score
        CircuitType circuitType;        // Type of circuit
        bool requiresReputation;        // Whether reputation is required
        bool isActive;                  // Whether circuit is active
    }

    /// @notice Participant information for ceremonies
    struct CeremonyParticipant {
        address participantAddress;     // Participant's address (20 bytes)
        bool verified;                  // Whether contribution is verified (1 byte)
        // 11 bytes remaining in slot 1
        bytes32 contributionHash;       // Hash of contribution (32 bytes - slot 2)
        uint256 reputationScore;        // Participant's reputation (32 bytes - slot 3)
        uint256 timestamp;              // Contribution timestamp (32 bytes - slot 4)
        uint256 stakeAmount;            // Staked amount for participation (32 bytes - slot 5)
        bytes contributionProof;        // Cryptographic proof of contribution (dynamic - slot 6+)
        string attestation;             // Signed attestation (dynamic - slot 7+)
    }

    /// @notice Austrian Economics ceremony metrics
    struct AustrianMetrics {
        uint256 voluntaryParticipation; // Number of voluntary participants
        uint256 marketTrustScore;       // Market-driven trust score
        uint256 individualContributions; // Individual contribution count
        uint256 spontaneousCoordination; // Coordination efficiency metric
        uint256 soundnessProof;         // Cryptographic soundness score
        bool austrianCompliance;        // Austrian Economics compliance
    }

    /// @notice Circuit ceremony state
    struct CircuitCeremony {
        bytes32 ceremonyId;             // Unique ceremony ID
        CircuitConfig config;           // Circuit configuration
        CeremonyParticipant[] participants; // List of participants
        AustrianMetrics metrics;        // Austrian Economics metrics
        uint256 startTime;              // Ceremony start time
        uint256 endTime;                // Ceremony end time
        bytes32 finalTranscriptHash;    // Final ceremony transcript
        bool isFinalized;               // Whether ceremony is complete
        bool isProduction;              // Production vs development
        mapping(address => bool) hasContributed; // Participant tracking
        mapping(address => uint256) participantIndex; // Participant indices
    }

    /// @notice Mapping of circuit type to ceremony
    mapping(CircuitType => CircuitCeremony) public circuitCeremonies;

    /// @notice Mapping of participant to reputation scores
    mapping(address => uint256) public participantReputation;

    /// @notice Mapping of participant to stake amounts
    mapping(address => uint256) public participantStakes;

    /// @notice Circuit configurations
    mapping(CircuitType => CircuitConfig) public circuitConfigs;

    /// @notice Minimum stake required for participation
    uint256 public constant MIN_PARTICIPATION_STAKE = 0.1 ether;

    /// @notice Maximum ceremony duration (7 days)
    uint256 public constant MAX_CEREMONY_DURATION = 7 days;

    /// @notice Reputation threshold for production ceremonies
    uint256 public constant PRODUCTION_REPUTATION_THRESHOLD = 80;

    /// @notice Events
    /// @notice Emitted when a circuit ceremony is started
    /// @param circuitType The type of circuit ceremony being started
    /// @param ceremonyId Unique identifier for the ceremony
    /// @param timestamp When the ceremony was started
    event CircuitCeremonyStarted(
        CircuitType indexed circuitType,
        bytes32 indexed ceremonyId,
        uint256 timestamp
    );

    /// @notice Emitted when a participant joins a ceremony
    /// @param circuitType The type of circuit ceremony being joined
    /// @param participant Address of the participant joining
    /// @param reputationScore Current reputation score of the participant
    /// @param stakeAmount Amount staked by the participant
    event ParticipantJoined(
        CircuitType indexed circuitType,
        address indexed participant,
        uint256 reputationScore,
        uint256 stakeAmount
    );

    /// @notice Emitted when a participant submits their contribution
    /// @param circuitType The type of circuit ceremony
    /// @param participant Address of the contributing participant
    /// @param contributionHash Hash of the submitted contribution
    /// @param timestamp When the contribution was submitted
    event ContributionSubmitted(
        CircuitType indexed circuitType,
        address indexed participant,
        bytes32 indexed contributionHash,
        uint256 timestamp
    );

    /// @notice Emitted when a ceremony is finalized with results
    /// @param circuitType The type of circuit ceremony being finalized
    /// @param finalTranscriptHash Hash of the final ceremony transcript
    /// @param metrics Austrian economics metrics from the ceremony
    event CeremonyFinalized(
        CircuitType indexed circuitType,
        bytes32 indexed finalTranscriptHash,
        AustrianMetrics metrics
    );

    /// @notice Emitted when a participant's reputation is updated
    /// @param participant Address of the participant whose reputation changed
    /// @param oldScore Previous reputation score
    /// @param newScore New reputation score
    event ReputationUpdated(
        address indexed participant,
        uint256 indexed oldScore,
        uint256 indexed newScore
    );

    /// @notice Owner withdrew ETH that remained after ceremony settlement (e.g. rounding dust)
    /// @param recipient Address that received the ETH
    /// @param amount Amount of wei transferred
    event EmergencyETHWithdrawn(address indexed recipient, uint256 amount);

    /// @notice Custom errors
    error CircuitNotConfigured();
    error CeremonyNotActive();
    error CeremonyAlreadyFinalized();
    error InsufficientReputation();
    error InsufficientStake();
    error ParticipantAlreadyJoined();
    error MaxParticipantsReached();
    error ContributionDeadlinePassed();
    error InvalidContribution();
    error CeremonyNotFound();
    error UnauthorizedParticipant();
    error InvalidCircuitConfig();
    error InsufficientCeremonyETH();

    /// @notice Initialize the ceremony coordinator with a verifier contract
    /// @param _ceremonyVerifier Address of the ceremony verifier contract
    constructor(address _ceremonyVerifier) Ownable(msg.sender) {
        if (_ceremonyVerifier == address(0)) revert InvalidAddress();
        CEREMONY_VERIFIER = CeremonyVerifier(_ceremonyVerifier);
        _initializeCircuitConfigs();
    }

    /**
     * @notice Initialize default circuit configurations
     */
    function _initializeCircuitConfigs() private {
        _initializeCrowdfundingConfig();
        _initializeMilestoneConfig();
        _initializeRefundConfig();
        _initializeReputationConfig();
        _initializeAnalyticsConfig();
    }

    /**
     * @notice Initialize crowdfunding circuit configuration
     */
    function _initializeCrowdfundingConfig() private {
        circuitConfigs[CircuitType.CROWDFUNDING] = CircuitConfig({
            name: "Crowdfunding Privacy Circuit",
            circuitType: CircuitType.CROWDFUNDING,
            minParticipants: 5,
            maxParticipants: 50,
            contributionDeadline: 3 days,
            verificationPeriod: 1 days,
            requiresReputation: true,
            minReputationScore: 60,
            powersOfTauHash: bytes32(0),
            isActive: true
        });
    }

    /**
     * @notice Initialize milestone circuit configuration
     */
    function _initializeMilestoneConfig() private {
        circuitConfigs[CircuitType.MILESTONE] = CircuitConfig({
            name: "Milestone Verification Circuit",
            circuitType: CircuitType.MILESTONE,
            minParticipants: 3,
            maxParticipants: 30,
            contributionDeadline: 2 days,
            verificationPeriod: 1 days,
            requiresReputation: true,
            minReputationScore: 70,
            powersOfTauHash: bytes32(0),
            isActive: true
        });
    }

    /**
     * @notice Initialize refund circuit configuration
     */
    function _initializeRefundConfig() private {
        circuitConfigs[CircuitType.REFUND] = CircuitConfig({
            name: "Refund Privacy Circuit",
            circuitType: CircuitType.REFUND,
            minParticipants: 3,
            maxParticipants: 25,
            contributionDeadline: 2 days,
            verificationPeriod: 1 days,
            requiresReputation: true,
            minReputationScore: 65,
            powersOfTauHash: bytes32(0),
            isActive: true
        });
    }

    /**
     * @notice Initialize reputation circuit configuration
     */
    function _initializeReputationConfig() private {
        circuitConfigs[CircuitType.REPUTATION] = CircuitConfig({
            name: "Reputation Tracking Circuit",
            circuitType: CircuitType.REPUTATION,
            minParticipants: 4,
            maxParticipants: 40,
            contributionDeadline: 3 days,
            verificationPeriod: 1 days,
            requiresReputation: true,
            minReputationScore: 75,
            powersOfTauHash: bytes32(0),
            isActive: true
        });
    }

    /**
     * @notice Initialize analytics circuit configuration
     */
    function _initializeAnalyticsConfig() private {
        circuitConfigs[CircuitType.ANALYTICS] = CircuitConfig({
            name: "Praxeological Analytics Circuit",
            circuitType: CircuitType.ANALYTICS,
            minParticipants: 6,
            maxParticipants: 60,
            contributionDeadline: 4 days,
            verificationPeriod: 2 days,
            requiresReputation: true,
            minReputationScore: 80,
            powersOfTauHash: bytes32(0),
            isActive: true
        });
    }

    /**
     * @notice Start a ceremony for a specific circuit type
     * @param circuitType The type of circuit for the ceremony
     * @param powersOfTauHash Hash of the Powers of Tau
     * @param isProduction Whether this is a production ceremony
     */
    function startCircuitCeremony(
        CircuitType circuitType,
        bytes32 powersOfTauHash,
        bool isProduction
    ) external onlyOwner {
        CircuitConfig storage config = circuitConfigs[circuitType];
        if (!config.isActive) revert CircuitNotConfigured();

        bytes32 ceremonyId = keccak256(abi.encodePacked(
            circuitType,
            block.timestamp,
            powersOfTauHash
        ));

        CircuitCeremony storage ceremony = circuitCeremonies[circuitType];
        if (ceremony.isFinalized && ceremony.startTime > 0) {
            // Reset for new ceremony
            delete ceremony.participants;
            ceremony.metrics = AustrianMetrics(0, 0, 0, 0, 0, false);
        }

        ceremony.ceremonyId = ceremonyId;
        ceremony.config = config;
        ceremony.config.powersOfTauHash = powersOfTauHash;
        ceremony.startTime = block.timestamp;
        ceremony.endTime = 0;
        ceremony.isFinalized = false;
        ceremony.isProduction = isProduction;

        // Start ceremony in base verifier
        CEREMONY_VERIFIER.startCeremony(
            ceremonyId,
            config.name,
            powersOfTauHash,
            isProduction
        );

        emit CircuitCeremonyStarted(circuitType, ceremonyId, block.timestamp);
    }

    /**
     * @notice Join a ceremony as a participant
     * @param circuitType The circuit type to join
     */
    function joinCeremony(CircuitType circuitType) external payable nonReentrant {
        CircuitCeremony storage ceremony = circuitCeremonies[circuitType];
        CircuitConfig storage config = ceremony.config;

        if (ceremony.startTime == 0) revert CeremonyNotFound();
        if (ceremony.isFinalized) revert CeremonyAlreadyFinalized();
        if (ceremony.hasContributed[msg.sender]) revert ParticipantAlreadyJoined();
        if (ceremony.participants.length > config.maxParticipants - 1) revert MaxParticipantsReached();

        // Check reputation requirements
        if (config.requiresReputation) {
            uint256 requiredScore = ceremony.isProduction ? 
                PRODUCTION_REPUTATION_THRESHOLD : config.minReputationScore;
            if (participantReputation[msg.sender] < requiredScore) {
                revert InsufficientReputation();
            }
        }

        // Check stake requirements
        if (msg.value < MIN_PARTICIPATION_STAKE) revert InsufficientStake();

        // Add participant
        ceremony.participants.push(CeremonyParticipant({
            participantAddress: msg.sender,
            reputationScore: participantReputation[msg.sender],
            contributionHash: bytes32(0),
            contributionProof: "",
            timestamp: 0,
            verified: false,
            attestation: "",
            stakeAmount: msg.value
        }));

        ceremony.hasContributed[msg.sender] = true;
        ceremony.participantIndex[msg.sender] = ceremony.participants.length - 1;
        participantStakes[msg.sender] += msg.value;

        // Update Austrian Economics metrics
        ++ceremony.metrics.voluntaryParticipation;
        ++ceremony.metrics.individualContributions;

        emit ParticipantJoined(
            circuitType,
            msg.sender,
            participantReputation[msg.sender],
            msg.value
        );
    }

    /**
     * @notice Submit a contribution to the ceremony
     * @param circuitType The circuit type
     * @param contributionHash Hash of the contribution
     * @param contributionProof Cryptographic proof of contribution
     * @param attestation Signed attestation
     */
    function submitContribution(
        CircuitType circuitType,
        bytes32 contributionHash,
        bytes calldata contributionProof,
        string calldata attestation
    ) external nonReentrant {
        CircuitCeremony storage ceremony = circuitCeremonies[circuitType];
        
        if (!ceremony.hasContributed[msg.sender]) revert UnauthorizedParticipant();
        if (ceremony.isFinalized) revert CeremonyAlreadyFinalized();
        if (block.timestamp > ceremony.startTime + ceremony.config.contributionDeadline) {
            revert ContributionDeadlinePassed();
        }
        if (contributionHash == bytes32(0)) revert InvalidContribution();

        uint256 participantIdx = ceremony.participantIndex[msg.sender];
        CeremonyParticipant storage participant = ceremony.participants[participantIdx];

        // CHECKS-EFFECTS-INTERACTIONS pattern: Update all state FIRST
        participant.contributionHash = contributionHash;
        participant.contributionProof = contributionProof;
        participant.timestamp = block.timestamp;
        participant.attestation = attestation;

        // Update Austrian Economics metrics BEFORE external call (CEI pattern)
        ceremony.metrics.soundnessProof += _calculateSoundnessScore(contributionProof);
        ceremony.metrics.spontaneousCoordination += _calculateCoordinationScore(
            ceremony.participants.length,
            ceremony.startTime > block.timestamp ? 0 : block.timestamp - ceremony.startTime
        );

        // INTERACTIONS: External call AFTER state updates (CEI pattern)
        // Record in base ceremony verifier AFTER updating local state
        CEREMONY_VERIFIER.recordContribution(
            ceremony.ceremonyId,
            msg.sender,
            contributionHash,
            attestation
        );

        emit ContributionSubmitted(circuitType, msg.sender, contributionHash, block.timestamp);
    }

    /**
     * @notice Verify a participant's contribution
     * @param circuitType The circuit type
     * @param participant The participant address
     * @param verified Whether the contribution is verified
     */
    function verifyContribution(
        CircuitType circuitType,
        address participant,
        bool verified
    ) external onlyOwner {
        if (participant == address(0)) revert ZeroAddress();
        CircuitCeremony storage ceremony = circuitCeremonies[circuitType];
        
        if (!ceremony.hasContributed[participant]) revert UnauthorizedParticipant();

        uint256 participantIdx = ceremony.participantIndex[participant];
        ceremony.participants[participantIdx].verified = verified;

        // Verify in base ceremony verifier
        CEREMONY_VERIFIER.verifyContribution(ceremony.ceremonyId, participant, verified);

        // Update reputation based on verification
        if (verified) {
            _updateReputation(participant, 5); // Increase reputation
        } else {
            _updateReputation(participant, -10); // Decrease reputation
        }
    }

    /**
     * @notice Finalize a ceremony
     * @param circuitType The circuit type
     * @param finalTranscriptHash Hash of the final transcript
     */
    function finalizeCeremony(
        CircuitType circuitType,
        bytes32 finalTranscriptHash
    ) external onlyOwner nonReentrant {
        CircuitCeremony storage ceremony = circuitCeremonies[circuitType];
        
        if (ceremony.isFinalized) revert CeremonyAlreadyFinalized();
        if (ceremony.participants.length < ceremony.config.minParticipants) {
            revert InsufficientParticipants();
        }

        ceremony.endTime = block.timestamp;
        ceremony.finalTranscriptHash = finalTranscriptHash;
        ceremony.isFinalized = true;

        // Calculate final Austrian Economics metrics
        ceremony.metrics.marketTrustScore = _calculateMarketTrustScore(ceremony);
        ceremony.metrics.austrianCompliance = _validateAustrianCompliance(ceremony);

        // Finalize in base ceremony verifier
        CEREMONY_VERIFIER.finalizeCeremony(ceremony.ceremonyId, finalTranscriptHash);

        // Distribute rewards to verified participants
        _distributeParticipationRewards(circuitType);

        emit CeremonyFinalized(circuitType, finalTranscriptHash, ceremony.metrics);
    }

    /**
     * @notice Update participant reputation
     * @param participant The participant address
     * @param delta The reputation change (can be negative)
     */
    function _updateReputation(address participant, int256 delta) private {
        uint256 oldScore = participantReputation[participant];
        
        if (delta < 0 && uint256(-delta) > oldScore) {
            participantReputation[participant] = 0;
        } else {
            participantReputation[participant] = uint256(int256(oldScore) + delta);
        }

        emit ReputationUpdated(participant, oldScore, participantReputation[participant]);
    }

    /**
     * @notice Calculate soundness score for a contribution
     * @param contributionProof The contribution proof
     * @return uint256 The soundness score
     */
    function _calculateSoundnessScore(bytes memory contributionProof) private pure returns (uint256) {
        // Simplified soundness calculation based on proof length and entropy
        if (contributionProof.length == 0) return 0;
        
        uint256 entropy = 0;
        for (uint256 i = 0; i < contributionProof.length && i < 32; ++i) {
            entropy += uint8(contributionProof[i]);
        }
        
        return (entropy * contributionProof.length) / 1000;
    }

    /**
     * @notice Calculate coordination score
     * @param participantCount Number of participants
     * @param timeElapsed Time elapsed since ceremony start
     * @return uint256 The coordination score
     */
    function _calculateCoordinationScore(
        uint256 participantCount,
        uint256 timeElapsed
    ) private pure returns (uint256) {
        // Higher score for more participants in less time
        if (timeElapsed == 0) return 0;
        return (participantCount * 1000) / timeElapsed;
    }

    /**
     * @notice Calculate market trust score for a ceremony
     * @param ceremony The ceremony data
     * @return uint256 The market trust score
     */
    function _calculateMarketTrustScore(
        CircuitCeremony storage ceremony
    ) private view returns (uint256) {
        uint256 verifiedCount = 0;
        uint256 totalReputation = 0;

        for (uint256 i = 0; i < ceremony.participants.length; ++i) {
            if (ceremony.participants[i].verified) {
                ++verifiedCount;
                totalReputation += ceremony.participants[i].reputationScore;
            }
        }

        if (verifiedCount == 0) return 0;
        
        uint256 verificationRate = (verifiedCount * 100) / ceremony.participants.length;
        uint256 avgReputation = totalReputation / verifiedCount;
        
        return (verificationRate * avgReputation) / 100;
    }

    /**
     * @notice Validate Austrian Economics compliance
     * @param ceremony The ceremony data
     * @return bool Whether the ceremony is Austrian Economics compliant
     */
    function _validateAustrianCompliance(
        CircuitCeremony storage ceremony
    ) private view returns (bool) {
        // Check voluntary participation (all participants staked voluntarily)
        if (ceremony.metrics.voluntaryParticipation < ceremony.config.minParticipants) {
            return false;
        }

        // Check individual sovereignty (each participant contributed individually)
        if (ceremony.metrics.individualContributions < ceremony.participants.length) {
            return false;
        }

        // Check market trust (sufficient verification rate)
        if (ceremony.metrics.marketTrustScore < 50) {
            return false;
        }

        // Check spontaneous coordination (efficient coordination)
        if (ceremony.metrics.spontaneousCoordination < 10) {
            return false;
        }

        return true;
    }

    /**
     * @notice Distribute participation rewards to verified participants
     * @param circuitType The circuit type
     */
    function _distributeParticipationRewards(CircuitType circuitType) private {
        CircuitCeremony storage ceremony = circuitCeremonies[circuitType];

        uint256 verifiedStakeSum = 0;
        uint256 unverifiedStakeSum = 0;
        uint256 verifiedCount = 0;

        for (uint256 i = 0; i < ceremony.participants.length; ++i) {
            uint256 stake = ceremony.participants[i].stakeAmount;
            if (ceremony.participants[i].verified) {
                verifiedStakeSum += stake;
                unchecked {
                    ++verifiedCount;
                }
            } else {
                unverifiedStakeSum += stake;
            }
        }

        if (verifiedCount == 0) return;

        uint256 totalStakeWei = verifiedStakeSum + unverifiedStakeSum;
        if (address(this).balance < totalStakeWei) revert InsufficientCeremonyETH();

        // Effects: settle accounting for every participant. Unverified stakes are forfeited
        // and distributed pro-rata among verified participants (by verified stake weight).
        for (uint256 i = 0; i < ceremony.participants.length; ++i) {
            CeremonyParticipant storage participant = ceremony.participants[i];
            uint256 stake = participant.stakeAmount;
            participantStakes[participant.participantAddress] -= stake;
            if (participant.verified) {
                _updateReputation(participant.participantAddress, 10);
            }
        }

        // Interactions: each verified participant receives principal + pro-rata share of forfeited stakes
        for (uint256 i = 0; i < ceremony.participants.length; ++i) {
            CeremonyParticipant storage participant = ceremony.participants[i];
            if (!participant.verified) continue;

            uint256 stake = participant.stakeAmount;
            uint256 bonus = 0;
            if (unverifiedStakeSum != 0) {
                if (verifiedStakeSum != 0) {
                    bonus = (unverifiedStakeSum * stake) / verifiedStakeSum;
                } else {
                    bonus = unverifiedStakeSum / verifiedCount;
                }
            }
            uint256 payout = stake + bonus;
            (bool ok, ) = payable(participant.participantAddress).call{value: payout}("");
            if (!ok) revert TransferFailed();
        }
    }

    /**
     * @notice Get ceremony information for a circuit type
     * @param circuitType The circuit type
     * @return ceremonyId The ceremony identifier
     * @return config The circuit configuration
     * @return metrics The Austrian Economics metrics
     * @return startTime The ceremony start time
     * @return endTime The ceremony end time
     * @return finalTranscriptHash The final transcript hash
     * @return isFinalized Whether the ceremony is finalized
     * @return isProduction Whether this is a production ceremony
     * @return participantCount The number of participants
     */
    function getCeremonyInfo(CircuitType circuitType) external view returns (
        bytes32 ceremonyId,
        CircuitConfig memory config,
        AustrianMetrics memory metrics,
        uint256 startTime,
        uint256 endTime,
        bytes32 finalTranscriptHash,
        bool isFinalized,
        bool isProduction,
        uint256 participantCount
    ) {
        CircuitCeremony storage ceremony = circuitCeremonies[circuitType];
        return (
            ceremony.ceremonyId,
            ceremony.config,
            ceremony.metrics,
            ceremony.startTime,
            ceremony.endTime,
            ceremony.finalTranscriptHash,
            ceremony.isFinalized,
            ceremony.isProduction,
            ceremony.participants.length
        );
    }

    /**
     * @notice Get participants for a ceremony
     * @param circuitType The circuit type
     * @return CeremonyParticipant[] Array of participants
     */
    function getCeremonyParticipants(CircuitType circuitType) external view returns (CeremonyParticipant[] memory) {
        return circuitCeremonies[circuitType].participants;
    }

    /**
     * @notice Update circuit configuration (admin function)
     * @param circuitType The circuit type
     * @param config The new configuration
     */
    function updateCircuitConfig(
        CircuitType circuitType,
        CircuitConfig calldata config
    ) external onlyOwner {
        if (config.minParticipants == 0 || config.maxParticipants == 0) revert InvalidCircuitConfig();
        if (config.maxParticipants < config.minParticipants) revert InvalidCircuitConfig();
        if (config.contributionDeadline == 0 || config.verificationPeriod == 0) revert InvalidCircuitConfig();
        circuitConfigs[circuitType] = config;
    }

    /**
     * @notice Set participant reputation (admin function)
     * @param participant The participant address
     * @param reputation The reputation score
     */
    function setParticipantReputation(
        address participant,
        uint256 reputation
    ) external onlyOwner {
        if (participant == address(0)) revert ZeroAddress();
        uint256 oldScore = participantReputation[participant];
        participantReputation[participant] = reputation;
        emit ReputationUpdated(participant, oldScore, reputation);
    }

    /**
     * @notice Emergency withdrawal for stuck funds
     * @param recipient The recipient address
     * @param amount The amount to withdraw
     */
    function emergencyWithdraw(address payable recipient, uint256 amount) external onlyOwner nonReentrant {
        if (recipient == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        (bool ok, ) = recipient.call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit EmergencyETHWithdrawn(recipient, amount);
    }

    /**
     * @notice Receive function to accept ETH
     */
    receive() external payable {}
}
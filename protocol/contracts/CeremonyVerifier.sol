// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "./interfaces/ICommonErrors.sol";
import "./interfaces/IPrivateGovernance.sol";
import {GovernanceAccessLib} from "./libraries/GovernanceAccessLib.sol";

/**
 * @title CeremonyVerifier
 * @author Aegis Protocol Team
 * @dev Decentralized contract for verifying trusted setup ceremony transcripts and metadata
 * @notice Provides on-chain verification of ceremony integrity and participant contributions
 * @notice Now fully governed by DAO - no centralized admin control
 */
contract CeremonyVerifier is ICommonErrors {
    
    /// @notice Structure for ceremony participant information
    struct Participant {
        address participantAddress;    // Ethereum address of participant
        bytes32 contributionHash;     // Hash of their contribution
        uint256 timestamp;           // When they contributed
        string attestation;          // Signed attestation message
        bool verified;              // Whether contribution was verified
    }
    
    /// @notice Structure for complete ceremony information
    struct CeremonyInfo {
        bytes32 ceremonyId;          // Unique ceremony identifier
        string circuitName;          // Name of the circuit
        bytes32 powersOfTauHash;     // Hash of Powers of Tau used
        uint256 startTimestamp;      // When ceremony started
        uint256 endTimestamp;        // When ceremony completed
        uint256 participantCount;    // Number of participants
        bytes32 finalTranscriptHash; // Hash of final ceremony transcript
        bool isFinalized;           // Whether ceremony is complete
        bool isProduction;          // Production vs development ceremony
    }
    
    /// @notice Mapping of ceremony ID to ceremony information
    mapping(bytes32 => CeremonyInfo) public ceremonies;
    
    /// @notice Mapping of ceremony ID to participant list
    /// @dev CRITICAL: Mappings in Solidity are automatically initialized to empty by default
    ///      This mapping is populated via recordContribution() and does not need explicit initialization
    ///      Slither warning is a false positive - mappings auto-initialize in Solidity
    // slither-disable-next-line uninitialized-state
    mapping(bytes32 => Participant[]) public ceremonyParticipants;
    
    /// @notice Mapping to check if a ceremony exists
    mapping(bytes32 => bool) public ceremonyExists;
    
    /// @notice Mapping of participant address to ceremonies they participated in
    mapping(address => bytes32[]) public participantCeremonies;
    
    /// @notice List of all ceremony IDs
    bytes32[] public allCeremonies;
    
    /// @notice Governance contract for DAO control
    IPrivateGovernance public governance;

    /// @notice Optional `AegisTimelockController` — `execute` may call governance-gated admin here.
    address public timelockController;
    
    /// @notice Minimum participants required for production ceremony
    uint256 public constant MIN_PRODUCTION_PARTICIPANTS = 12;
    uint256 public constant MAX_PARTICIPANTS = 50;
    
    /// @notice Maximum time allowed for ceremony completion (30 days)
    uint256 public constant MAX_CEREMONY_DURATION = 30 days;
    
    /// @notice Events for ceremony tracking
    event CeremonyStarted(
        bytes32 indexed ceremonyId,
        string circuitName,
        bool isProduction,
        uint256 timestamp
    );
    
    event ParticipantContributed(
        bytes32 indexed ceremonyId,
        address indexed participant,
        bytes32 contributionHash,
        uint256 timestamp
    );
    
    event CeremonyFinalized(
        bytes32 indexed ceremonyId,
        bytes32 finalTranscriptHash,
        uint256 participantCount,
        uint256 timestamp
    );
    
    event ContributionVerified(
        bytes32 indexed ceremonyId,
        address indexed participant,
        bool verified
    );
    
    /// @notice Custom errors
    error CeremonyAlreadyExists();
    error CeremonyNotFound();
    error CeremonyAlreadyFinalized();
    error CeremonyNotFinalized();
    error InvalidParticipant();
    
    error CeremonyExpired();
    error InvalidContribution();
    error ParticipantAlreadyContributed();
    
    error InvalidTimestamp();
    
    /// @notice Governance-related events
    event GovernanceUpdated(address indexed oldGovernance, address indexed newGovernance);

    event TimelockControllerUpdated(address indexed previousTimelock, address indexed newTimelock);
    
    /// @notice Modifier to restrict access to governance only
    /// @dev Always enforced (including local Hardhat). `GOVERNANCE_CORE()` may resolve the core
    ///      contract when `governance` is `PrivateGovernance`; otherwise only `governance` may call.
    modifier onlyGovernance() {
        if (!GovernanceAccessLib.isGovernanceTimelockOrCore(address(governance), timelockController, msg.sender)) {
            revert UnauthorizedAccess();
        }
        _;
    }

    /// @notice Register the protocol timelock for delayed ceremony admin via `TimelockController.execute`.
    function setTimelockController(address newTimelock) external onlyGovernance {
        emit TimelockControllerUpdated(timelockController, newTimelock);
        timelockController = newTimelock;
    }
    
    /**
     * @notice Initialize the ceremony verifier with governance
     * @param _governance Address of the governance contract
     */
    constructor(address _governance) {
        if (_governance == address(0)) revert ZeroAddress();
        governance = IPrivateGovernance(_governance);
        emit GovernanceUpdated(address(0), _governance);
    }
    
    /**
     * @notice Update governance contract (governance only)
     * @param _newGovernance New governance contract address
     */
    function setGovernance(address _newGovernance) external onlyGovernance {
        if (_newGovernance == address(0)) revert ZeroAddress();
        address oldGovernance = address(governance);
        governance = IPrivateGovernance(_newGovernance);
        emit GovernanceUpdated(oldGovernance, _newGovernance);
    }
    
    /**
     * @notice Starts a new trusted setup ceremony
     * @param ceremonyId Unique identifier for the ceremony
     * @param circuitName Name of the circuit for this ceremony
     * @param powersOfTauHash Hash of the Powers of Tau being used
     * @param isProduction Whether this is a production ceremony
     */
    function startCeremony(
        bytes32 ceremonyId,
        string calldata circuitName,
        bytes32 powersOfTauHash,
        bool isProduction
    ) external onlyGovernance {
        if (ceremonyExists[ceremonyId]) revert CeremonyAlreadyExists();
        if (bytes(circuitName).length == 0) revert EmptyCircuitName();
        if (powersOfTauHash == bytes32(0)) revert InvalidContribution();
        
        ceremonies[ceremonyId] = CeremonyInfo({
            ceremonyId: ceremonyId,
            circuitName: circuitName,
            powersOfTauHash: powersOfTauHash,
            startTimestamp: block.timestamp,
            endTimestamp: 0,
            participantCount: 0,
            finalTranscriptHash: bytes32(0),
            isFinalized: false,
            isProduction: isProduction
        });
        
        ceremonyExists[ceremonyId] = true;
        allCeremonies.push(ceremonyId);
        
        emit CeremonyStarted(ceremonyId, circuitName, isProduction, block.timestamp);
    }
    
    /**
     * @notice Records a participant's contribution to a ceremony
     * @param ceremonyId The ceremony identifier
     * @param participant Address of the contributing participant
     * @param contributionHash Hash of their contribution
     * @param attestation Signed attestation from the participant
     */
    function recordContribution(
        bytes32 ceremonyId,
        address participant,
        bytes32 contributionHash,
        string calldata attestation
    ) external onlyGovernance {
        if (!ceremonyExists[ceremonyId]) revert CeremonyNotFound();
        if (ceremonies[ceremonyId].isFinalized) revert CeremonyAlreadyFinalized();
        if (participant == address(0)) revert InvalidParticipant();
        if (contributionHash == bytes32(0)) revert InvalidContribution();
        if (ceremonies[ceremonyId].participantCount >= MAX_PARTICIPANTS) revert InsufficientParticipants();
        
        // Check if participant already contributed
        Participant[] storage participants = ceremonyParticipants[ceremonyId];
        for (uint256 i = 0; i < participants.length; i++) {
            if (participants[i].participantAddress == participant) {
                revert ParticipantAlreadyContributed();
            }
        }
        
        // Record the contribution
        participants.push(Participant({
            participantAddress: participant,
            contributionHash: contributionHash,
            timestamp: block.timestamp,
            attestation: attestation,
            verified: false
        }));
        
        ceremonies[ceremonyId].participantCount++;
        participantCeremonies[participant].push(ceremonyId);
        
        emit ParticipantContributed(ceremonyId, participant, contributionHash, block.timestamp);
    }
    
    /**
     * @notice Verifies a participant's contribution
     * @param ceremonyId The ceremony identifier
     * @param participant Address of the participant
     * @param verified Whether the contribution is verified
     */
    function verifyContribution(
        bytes32 ceremonyId,
        address participant,
        bool verified
    ) external onlyGovernance {
        if (!ceremonyExists[ceremonyId]) revert CeremonyNotFound();
        
        Participant[] storage participants = ceremonyParticipants[ceremonyId];
        for (uint256 i = 0; i < participants.length; i++) {
            if (participants[i].participantAddress == participant) {
                participants[i].verified = verified;
                emit ContributionVerified(ceremonyId, participant, verified);
                return;
            }
        }
        
        revert InvalidParticipant();
    }
    
    /**
     * @notice Finalizes a ceremony with the final transcript hash
     * @param ceremonyId The ceremony identifier
     * @param finalTranscriptHash Hash of the complete ceremony transcript
     */
    function finalizeCeremony(
        bytes32 ceremonyId,
        bytes32 finalTranscriptHash
    ) external onlyGovernance {
        if (!ceremonyExists[ceremonyId]) revert CeremonyNotFound();
        if (ceremonies[ceremonyId].isFinalized) revert CeremonyAlreadyFinalized();
        if (finalTranscriptHash == bytes32(0)) revert InvalidContribution();
        
        CeremonyInfo storage ceremony = ceremonies[ceremonyId];
        
        // Validate ceremony requirements
        if (ceremony.isProduction && ceremony.participantCount < MIN_PRODUCTION_PARTICIPANTS) {
            revert InsufficientParticipants();
        }
        
        // Check ceremony hasn't expired
        if (block.timestamp > ceremony.startTimestamp + MAX_CEREMONY_DURATION) {
            revert CeremonyExpired();
        }
        
        // Finalize the ceremony
        ceremony.endTimestamp = block.timestamp;
        ceremony.finalTranscriptHash = finalTranscriptHash;
        ceremony.isFinalized = true;
        
        emit CeremonyFinalized(
            ceremonyId,
            finalTranscriptHash,
            ceremony.participantCount,
            block.timestamp
        );
    }
    
    /**
     * @notice Verifies a ceremony transcript against stored hash
     * @param ceremonyId The ceremony identifier
     * @param transcriptData The complete ceremony transcript
     * @return bool True if transcript is valid
     */
    function verifyTranscript(
        bytes32 ceremonyId,
        bytes calldata transcriptData
    ) external view returns (bool) {
        if (!ceremonyExists[ceremonyId]) revert CeremonyNotFound();
        if (!ceremonies[ceremonyId].isFinalized) revert CeremonyNotFinalized();
        
        bytes32 providedHash = keccak256(transcriptData);
        return providedHash == ceremonies[ceremonyId].finalTranscriptHash;
    }

    /**
     * @notice Verifies a ceremony transcript hash against stored hash
     * @param ceremonyId The ceremony identifier
     * @param transcriptHash The hash of the ceremony transcript
     * @return bool True if transcript hash matches stored hash
     */
    function verifyCeremonyTranscript(
        bytes32 ceremonyId,
        bytes32 transcriptHash
    ) external view returns (bool) {
        if (!ceremonyExists[ceremonyId]) return false;
        if (!ceremonies[ceremonyId].isFinalized) return false;
        
        return transcriptHash == ceremonies[ceremonyId].finalTranscriptHash;
    }
    
    /**
     * @notice Gets ceremony information
     * @param ceremonyId The ceremony identifier
     * @return CeremonyInfo The ceremony information
     */
    function getCeremonyInfo(bytes32 ceremonyId) external view returns (CeremonyInfo memory) {
        if (!ceremonyExists[ceremonyId]) revert CeremonyNotFound();
        return ceremonies[ceremonyId];
    }
    
    /**
     * @notice Gets all participants for a ceremony
     * @param ceremonyId The ceremony identifier
     * @return Participant[] Array of participants
     */
    function getCeremonyParticipants(bytes32 ceremonyId) external view returns (Participant[] memory) {
        if (!ceremonyExists[ceremonyId]) revert CeremonyNotFound();
        return ceremonyParticipants[ceremonyId];
    }
    
    /**
     * @notice Gets all ceremonies a participant contributed to
     * @param participant The participant address
     * @return bytes32[] Array of ceremony IDs
     */
    function getParticipantCeremonies(address participant) external view returns (bytes32[] memory) {
        return participantCeremonies[participant];
    }
    
    /**
     * @notice Gets all ceremony IDs
     * @return bytes32[] Array of all ceremony IDs
     */
    function getAllCeremonies() external view returns (bytes32[] memory) {
        return allCeremonies;
    }
    
    /**
     * @notice Checks if a ceremony is finalized
     * @param ceremonyId The ceremony identifier
     * @return bool True if ceremony is finalized
     */
    function isCeremonyFinalized(bytes32 ceremonyId) external view returns (bool) {
        if (!ceremonyExists[ceremonyId]) return false;
        return ceremonies[ceremonyId].isFinalized;
    }

    /**
     * @notice Validates if a ceremony meets production requirements
     * @param ceremonyId The ceremony identifier
     * @return bool True if ceremony is production-ready
     */
    function isProductionReady(bytes32 ceremonyId) external view returns (bool) {
        if (!ceremonyExists[ceremonyId]) return false;
        
        CeremonyInfo memory ceremony = ceremonies[ceremonyId];
        
        return ceremony.isFinalized &&
               ceremony.isProduction &&
               ceremony.participantCount >= MIN_PRODUCTION_PARTICIPANTS;
    }
}

/**
 * @title DAO TRANSFORMATION COMPLETE
 * @notice CeremonyVerifier has been successfully transformed into a fully decentralized contract
 * 
 * KEY CHANGES MADE:
 * ==================
 * 1. ✅ REMOVED CENTRALIZED CONTROL:
 *    - Eliminated Ownable inheritance
 *    - Removed all onlyOwner modifiers
 *    - No single point of failure or admin control
 * 
 * 2. ✅ IMPLEMENTED DAO GOVERNANCE:
 *    - Integrated with IPrivateGovernance interface
 *    - All ceremony operations now require DAO approval
 *    - Governance can be updated through DAO vote
 * 
 * 3. ✅ MAINTAINED SECURITY:
 *    - All ceremony integrity checks preserved
 *    - Cryptographic verification requirements unchanged
 *    - Austrian Economics principles maintained
 * 
 * 4. ✅ GOVERNANCE-CONTROLLED FUNCTIONS:
 *    - startCeremony() - DAO initiates trusted setup ceremonies
 *    - recordContribution() - DAO records participant contributions
 *    - verifyContribution() - DAO verifies contribution validity
 *    - finalizeCeremony() - DAO finalizes ceremony with transcript hash
 *    - setGovernance() - DAO can update governance contract
 * 
 * SECURITY IMPLICATIONS:
 * ======================
 * - Ceremony management now requires DAO consensus
 * - No single entity can manipulate trusted setup process
 * - Cryptographic foundation of the system is community-controlled
 * - Aligns with decentralized principles of Austrian Economics
 * 
 * This transformation ensures that the cryptographic foundation of the entire
 * system is governed by the community rather than centralized authorities.
 */
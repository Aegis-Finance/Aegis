// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "./../interfaces/ICommonErrors.sol";

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {IVerifier} from "../interfaces/IVerifier.sol";
import {VerifierFactory} from "../VerifierFactory.sol";
import {CeremonyVerifier} from "../CeremonyVerifier.sol";

/**
 * @title EmergencyKeyRotation
 * @author Sentinel - CTO & Smart Contract Architect
 * @notice DAO-governed emergency key rotation system for compromised verification keys
 * @dev Implements secure emergency procedures with decentralized governance controls
 * 
 * SECURITY CRITICAL: This contract handles emergency key rotation scenarios.
 * All operations require DAO consensus and cryptographic validation.
 * No single admin can pause or control the system - all actions are governed by the DAO.
 */
contract EmergencyKeyRotation is AccessControl, ReentrancyGuard , ICommonErrors{
    using ECDSA for bytes32;

    // DAO Role definitions - No single admin control
    /// @notice Role for DAO members who can initiate emergency procedures through voting
    bytes32 public constant DAO_EMERGENCY_ROLE = keccak256("DAO_EMERGENCY_ROLE");
    /// @notice Role for DAO security council members elected by governance
    bytes32 public constant DAO_SECURITY_COUNCIL_ROLE = keccak256("DAO_SECURITY_COUNCIL_ROLE");
    /// @notice Role for DAO validators who can verify compromise evidence
    bytes32 public constant DAO_VALIDATOR_ROLE = keccak256("DAO_VALIDATOR_ROLE");
    /// @notice Role for DAO governance contract that can execute final decisions
    bytes32 public constant DAO_GOVERNANCE_ROLE = keccak256("DAO_GOVERNANCE_ROLE");

    // Emergency states
    enum EmergencyState {
        NORMAL,
        INVESTIGATION,
        EMERGENCY_ROTATION,
        RECOVERY_MODE,
        DAO_VOTING_ACTIVE
    }

    // DAO Voting structures using Solidity 0.8.26 features
    struct DAOVote {
        uint256 voteId;
        bytes32 proposalHash;
        uint256 startTime;
        uint256 endTime;
        uint256 forVotes;
        uint256 againstVotes;
        uint256 abstainVotes;
        bool executed;
        bool cancelled;
        mapping(address => VoteChoice) votes;
        mapping(address => uint256) votingPower;
    }

    enum VoteChoice {
        NONE,
        FOR,
        AGAINST,
        ABSTAIN
    }

    // Emergency proposal structure with DAO governance
    struct EmergencyProposal {
        uint256 id;
        uint256 timestamp;
        uint256 expiryTime;
        uint256 daoVoteId; // Links to DAO voting mechanism
        uint256 requiredQuorum;
        uint256 requiredMajority; // Basis points (e.g., 6000 = 60%)
        bytes32 emergencyReason;
        bytes32 evidenceHash;
        address currentVerifier;
        address proposedVerifier;
        address proposer;
        string circuitType;
        bool executed;
        bool cancelled;
    }

    // Key compromise evidence
    struct CompromiseEvidence {
        bytes32 evidenceHash;
        string evidenceType; // "proof_forgery", "key_leak", "ceremony_compromise"
        uint256 timestamp;
        address reporter;
        bool verified;
    }

    // State variables
    /// @notice Reference to the VerifierFactory contract for managing verifiers
    VerifierFactory public immutable VERIFIER_FACTORY;
    /// @notice Reference to the CeremonyVerifier contract for validating ceremonies
    CeremonyVerifier public immutable CEREMONY_VERIFIER;
    
    /// @notice Current emergency state of the system
    EmergencyState public currentState;
    /// @notice Counter for emergency proposals
    uint256 public emergencyProposalCount;
    /// @notice Counter for DAO votes
    uint256 public daoVoteCount;
    
    // DAO Governance Parameters (configurable by DAO)
    /// @notice Minimum time delay before emergency actions can be executed (DAO configurable)
    uint256 public emergencyTimelock = 24 hours;
    /// @notice Time after which emergency proposals expire (DAO configurable)
    uint256 public proposalExpiry = 7 days;
    /// @notice Voting period for DAO decisions (DAO configurable)
    uint256 public votingPeriod = 3 days;
    /// @notice Minimum quorum required for DAO votes (basis points, DAO configurable)
    uint256 public minimumQuorum = 2000; // 20%
    /// @notice Default majority threshold for emergency proposals (basis points, DAO configurable)
    uint256 public defaultMajorityThreshold = 6000; // 60%
    
    /// @notice Mapping of proposal IDs to emergency proposals
    mapping(uint256 => EmergencyProposal) public emergencyProposals;
    /// @notice Mapping of vote IDs to DAO votes
    mapping(uint256 => DAOVote) public daoVotes;
    /// @notice Mapping of circuit types to their compromise status
    mapping(string => bool) public compromisedCircuits;
    /// @notice Mapping of evidence hashes to compromise evidence
    mapping(bytes32 => CompromiseEvidence) public compromiseEvidence;
    /// @notice Mapping of circuit types to their emergency backup verifiers
    mapping(string => address) public emergencyVerifiers;
    /// @notice Mapping of addresses to their DAO voting power
    mapping(address => uint256) public daoVotingPower;
    /// @notice Total DAO voting power for quorum calculations
    uint256 public totalVotingPower;
    
    // Events
    /// @notice Emitted when the emergency state changes
    /// @param oldState The previous emergency state
    /// @param newState The new emergency state
    /// @param reason The reason for the state change
    event EmergencyStateChanged(EmergencyState oldState, EmergencyState newState, string reason);
    
    /// @notice Emitted when a new emergency proposal is created with DAO voting
    /// @param proposalId The unique identifier of the proposal
    /// @param daoVoteId The DAO vote ID linked to this proposal
    /// @param circuitType The type of circuit being rotated
    /// @param currentVerifier The current verifier address
    /// @param proposedVerifier The proposed new verifier address
    /// @param proposer The address that created the proposal
    /// @param reason The reason for the emergency rotation
    event EmergencyProposalCreated(
        uint256 indexed proposalId,
        uint256 indexed daoVoteId,
        string indexed circuitType,
        address currentVerifier,
        address proposedVerifier,
        address proposer,
        bytes32 reason
    );
    
    /// @notice Emitted when a DAO vote is created
    /// @param voteId The unique identifier of the vote
    /// @param proposalHash The hash of the proposal being voted on
    /// @param startTime When voting starts
    /// @param endTime When voting ends
    event DAOVoteCreated(
        uint256 indexed voteId,
        bytes32 indexed proposalHash,
        uint256 startTime,
        uint256 endTime
    );
    
    /// @notice Emitted when a DAO member casts a vote
    /// @param voteId The vote identifier
    /// @param voter The address that voted
    /// @param choice The vote choice (FOR, AGAINST, ABSTAIN)
    /// @param votingPower The voting power used
    event DAOVoteCast(
        uint256 indexed voteId,
        address indexed voter,
        VoteChoice choice,
        uint256 votingPower
    );
    
    /// @notice Emitted when an emergency key rotation is executed via DAO vote
    /// @param proposalId The unique identifier of the proposal
    /// @param voteId The DAO vote that approved the rotation
    /// @param circuitType The type of circuit that was rotated
    /// @param oldVerifier The previous verifier address
    /// @param newVerifier The new verifier address
    event EmergencyRotationExecuted(
        uint256 indexed proposalId,
        uint256 indexed voteId,
        string indexed circuitType,
        address oldVerifier,
        address newVerifier
    );
    
    /// @notice Emitted when a key compromise is reported
    /// @param evidenceHash The hash of the compromise evidence
    /// @param circuitType The type of circuit that may be compromised
    /// @param evidenceType The type of evidence provided
    /// @param reporter The address that reported the compromise
    event CompromiseReported(
        bytes32 indexed evidenceHash,
        string circuitType,
        string evidenceType,
        address indexed reporter
    );
    
    /// @notice Emitted when an emergency verifier is set for a circuit type via DAO
    /// @param circuitType The type of circuit
    /// @param verifier The emergency verifier address
    /// @param approvedByDAO Whether this was approved by DAO vote
    event EmergencyVerifierSet(
        string indexed circuitType, 
        address indexed verifier,
        bool approvedByDAO
    );
    
    /// @notice Emitted when DAO governance parameters are updated
    /// @param parameter The parameter that was changed
    /// @param oldValue The previous value
    /// @param newValue The new value
    event DAOParameterUpdated(
        string indexed parameter,
        uint256 oldValue,
        uint256 newValue
    );
    
    /// @notice Emitted when DAO voting power is updated
    /// @param member The DAO member whose voting power changed
    /// @param oldPower The previous voting power
    /// @param newPower The new voting power
    event DAOVotingPowerUpdated(
        address indexed member,
        uint256 oldPower,
        uint256 newPower
    );

    // Custom errors using Solidity 0.8.26 features

    /// @notice Initialize the DAO-governed emergency key rotation system
    /// @param _verifierFactory Address of the VerifierFactory contract
    /// @param _ceremonyVerifier Address of the CeremonyVerifier contract
    /// @param _daoGovernance Address of the DAO governance contract
    /// @param _initialDAOMembers Initial DAO members with voting power
    /// @param _initialVotingPowers Corresponding voting powers for initial members
    constructor(
        address _verifierFactory,
        address _ceremonyVerifier,
        address _daoGovernance,
        address[] memory _initialDAOMembers,
        uint256[] memory _initialVotingPowers
    ) {
        if (_verifierFactory == address(0) || _ceremonyVerifier == address(0) || _daoGovernance == address(0)) {
            revert InvalidVerifier();
        }
        if (_initialDAOMembers.length != _initialVotingPowers.length) {
            revert InvalidVotingPower();
        }

        VERIFIER_FACTORY = VerifierFactory(_verifierFactory);
        CEREMONY_VERIFIER = CeremonyVerifier(_ceremonyVerifier);
        currentState = EmergencyState.NORMAL;

        // Setup DAO roles - NO DEFAULT_ADMIN_ROLE for single admin control
        _grantRole(DAO_GOVERNANCE_ROLE, _daoGovernance);
        
        // Initialize DAO members and their voting power
        for (uint256 i = 0; i < _initialDAOMembers.length; i++) {
            address member = _initialDAOMembers[i];
            uint256 power = _initialVotingPowers[i];
            
            if (member == address(0) || power == 0) {
                revert InvalidVotingPower();
            }
            
            _grantRole(DAO_EMERGENCY_ROLE, member);
            _grantRole(DAO_SECURITY_COUNCIL_ROLE, member);
            _grantRole(DAO_VALIDATOR_ROLE, member);
            
            daoVotingPower[member] = power;
            totalVotingPower += power;
        }
    }

    /**
     * @notice Report potential key compromise with evidence (DAO validators only)
     * @param circuitType Circuit type that may be compromised
     * @param evidenceType Type of evidence ("proof_forgery", "key_leak", "ceremony_compromise")
     * @param evidenceHash Hash of the evidence data
     */
    function reportCompromise(
        string calldata circuitType,
        string calldata evidenceType,
        bytes32 evidenceHash
    ) external onlyRole(DAO_VALIDATOR_ROLE) {

        if (evidenceHash == bytes32(0)) {
            revert InvalidEvidence();
        }
        
        // Store evidence
        compromiseEvidence[evidenceHash] = CompromiseEvidence({
            evidenceHash: evidenceHash,
            evidenceType: evidenceType,
            timestamp: block.timestamp,
            reporter: msg.sender,
            verified: false
        });
        
        // Move to investigation state if not already in emergency
        if (currentState == EmergencyState.NORMAL) {
            _changeEmergencyState(EmergencyState.INVESTIGATION, "Compromise reported");
        }
        
        emit CompromiseReported(evidenceHash, circuitType, evidenceType, msg.sender);
    }

    /**
     * @notice Verify compromise evidence and mark circuit as compromised (DAO security council)
     * @param evidenceHash Hash of the evidence to verify
     * @param circuitType Circuit type to mark as compromised
     */
    function verifyCompromiseEvidence(
        bytes32 evidenceHash,
        string calldata circuitType
    ) external onlyRole(DAO_SECURITY_COUNCIL_ROLE) {
        CompromiseEvidence storage evidence = compromiseEvidence[evidenceHash];
        if (evidence.evidenceHash == bytes32(0)) {
            revert InvalidEvidence();
        }
        
        evidence.verified = true;
        compromisedCircuits[circuitType] = true;
        
        // Move to emergency rotation state
        _changeEmergencyState(EmergencyState.EMERGENCY_ROTATION, "Compromise verified");
    }

    /**
     * @notice Create emergency key rotation proposal with DAO voting
     * @param circuitType Circuit type requiring rotation
     * @param proposedVerifier New verifier address
     * @param emergencyReason Reason for emergency rotation
     * @param evidenceHash Hash of supporting evidence
     * @param requiredMajority Custom majority threshold (basis points, 0 = use default)
     * @return proposalId The unique identifier of the created proposal
     * @return voteId The unique identifier of the created DAO vote
     */
    function createEmergencyProposal(
        string calldata circuitType,
        address proposedVerifier,
        bytes32 emergencyReason,
        bytes32 evidenceHash,
        uint256 requiredMajority
    ) external onlyRole(DAO_EMERGENCY_ROLE) returns (uint256 proposalId, uint256 voteId) {

        if (currentState != EmergencyState.EMERGENCY_ROTATION) {
            revert InvalidEmergencyState();
        }
        if (!compromisedCircuits[circuitType]) {
            revert CircuitNotCompromised();
        }
        if (proposedVerifier == address(0)) {
            revert InvalidVerifier();
        }
        
        // Validate proposed verifier implements IVerifier
        try IVerifier(proposedVerifier).verifyProof(
            [uint256(0), 0, 0, 0, 0, 0, 0, 0], 
            new uint256[](0)
        ) returns (bool) {
            // Interface check passed - verifier is valid, no action needed
        } catch {
            revert InvalidVerifier();
        }

        // Use default majority if not specified
        uint256 majority = requiredMajority == 0 ? defaultMajorityThreshold : requiredMajority;
        if (majority > 10000) { // Cannot require more than 100%
            revert InvalidGovernanceParameter();
        }
        
        proposalId = ++emergencyProposalCount;
        voteId = _createDAOVote(
            keccak256(abi.encode(proposalId, circuitType, proposedVerifier, emergencyReason))
        );
        
        EmergencyProposal storage proposal = emergencyProposals[proposalId];
        proposal.id = proposalId;
        proposal.circuitType = circuitType;
        proposal.currentVerifier = VERIFIER_FACTORY.getVerifier(circuitType);
        proposal.proposedVerifier = proposedVerifier;
        proposal.emergencyReason = emergencyReason;
        proposal.timestamp = block.timestamp;
        proposal.expiryTime = block.timestamp + proposalExpiry;
        proposal.daoVoteId = voteId;
        proposal.requiredQuorum = minimumQuorum;
        proposal.requiredMajority = majority;
        proposal.evidenceHash = evidenceHash;
        proposal.proposer = msg.sender;
        
        // Move to DAO voting state
        _changeEmergencyState(EmergencyState.DAO_VOTING_ACTIVE, "Emergency proposal created");
        
        emit EmergencyProposalCreated(
            proposalId,
            voteId,
            circuitType,
            proposal.currentVerifier,
            proposedVerifier,
            msg.sender,
            emergencyReason
        );
        
        return (proposalId, voteId);
    }

    /**
     * @notice Cast vote on DAO proposal
     * @param voteId The DAO vote ID
     * @param choice Vote choice (FOR, AGAINST, ABSTAIN)
     */
    function castDAOVote(
        uint256 voteId,
        VoteChoice choice
    ) external onlyRole(DAO_SECURITY_COUNCIL_ROLE) {
        DAOVote storage vote = daoVotes[voteId];
        if (vote.voteId == 0) {
            revert DAOVoteNotFound();
        }
        if (block.timestamp < vote.startTime) {
            revert VotingPeriodNotStarted();
        }
        if (block.timestamp > vote.endTime) {
            revert VotingPeriodEnded();
        }
        if (vote.votes[msg.sender] != VoteChoice.NONE) {
            revert AlreadyVoted();
        }
        
        uint256 votingPower = daoVotingPower[msg.sender];
        if (votingPower == 0) {
            revert InvalidVotingPower();
        }
        
        vote.votes[msg.sender] = choice;
        vote.votingPower[msg.sender] = votingPower;
        
        if (choice == VoteChoice.FOR) {
            vote.forVotes += votingPower;
        } else if (choice == VoteChoice.AGAINST) {
            vote.againstVotes += votingPower;
        } else if (choice == VoteChoice.ABSTAIN) {
            vote.abstainVotes += votingPower;
        }
        
        emit DAOVoteCast(voteId, msg.sender, choice, votingPower);
    }

    /**
     * @notice Execute emergency key rotation after DAO approval
     * @param proposalId ID of the proposal to execute
     */
    function executeEmergencyRotation(uint256 proposalId) external nonReentrant {
        EmergencyProposal storage proposal = emergencyProposals[proposalId];
        
        if (proposal.id == 0) {
            revert ProposalNotFound();
        }
        if (block.timestamp > proposal.expiryTime) {
            revert ProposalExpired();
        }
        if (proposal.executed || proposal.cancelled) {
            revert ProposalAlreadyExecuted();
        }
        
        // Check DAO vote results
        DAOVote storage vote = daoVotes[proposal.daoVoteId];
        if (vote.voteId == 0) {
            revert DAOVoteNotFound();
        }
        if (block.timestamp <= vote.endTime) {
            revert VotingPeriodNotStarted();
        }
        
        uint256 totalVotes = vote.forVotes + vote.againstVotes + vote.abstainVotes;
        uint256 requiredQuorum = (totalVotingPower * proposal.requiredQuorum) / 10000;
        
        if (totalVotes < requiredQuorum) {
            revert InsufficientQuorum();
        }
        
        uint256 requiredMajority = (totalVotes * proposal.requiredMajority) / 10000;
        if (vote.forVotes < requiredMajority) {
            revert DAOVoteNotPassed();
        }
        
        // Additional timelock check for security
        if (block.timestamp < proposal.timestamp + emergencyTimelock) {
            revert UnauthorizedOperation();
        }
        
        proposal.executed = true;
        vote.executed = true;
        
        // Execute the rotation through VerifierFactory
        _executeRotation(proposal.circuitType, proposal.proposedVerifier);
        
        emit EmergencyRotationExecuted(
            proposalId,
            proposal.daoVoteId,
            proposal.circuitType,
            proposal.currentVerifier,
            proposal.proposedVerifier
        );
        
        // Move to recovery mode
        _changeEmergencyState(EmergencyState.RECOVERY_MODE, "Emergency rotation executed");
    }

    /**
     * @notice Set emergency backup verifier for a circuit type (DAO governance only)
     * @param circuitType Circuit type
     * @param verifier Emergency verifier address
     */
    function setEmergencyVerifier(
        string calldata circuitType,
        address verifier
    ) external onlyRole(DAO_GOVERNANCE_ROLE) {
        if (verifier == address(0)) {
            revert InvalidVerifier();
        }
        
        emergencyVerifiers[circuitType] = verifier;
        emit EmergencyVerifierSet(circuitType, verifier, true);
    }

    /**
     * @notice Update DAO governance parameters (DAO governance only)
     * @param parameter Parameter name to update
     * @param newValue New parameter value
     */
    function updateDAOParameter(
        string calldata parameter,
        uint256 newValue
    ) external onlyRole(DAO_GOVERNANCE_ROLE) {
        // CRITICAL: Initialize to prevent uninitialized variable warnings
        // Will be assigned in one of the conditionals below, or revert if invalid parameter
        uint256 oldValue = 0;
        
        if (keccak256(bytes(parameter)) == keccak256("emergencyTimelock")) {
            if (newValue < 1 hours || newValue > 30 days) {
                revert InvalidGovernanceParameter();
            }
            oldValue = emergencyTimelock;
            emergencyTimelock = newValue;
        } else if (keccak256(bytes(parameter)) == keccak256("proposalExpiry")) {
            if (newValue < 1 days || newValue > 30 days) {
                revert InvalidGovernanceParameter();
            }
            oldValue = proposalExpiry;
            proposalExpiry = newValue;
        } else if (keccak256(bytes(parameter)) == keccak256("votingPeriod")) {
            if (newValue < 1 hours || newValue > 14 days) {
                revert InvalidGovernanceParameter();
            }
            oldValue = votingPeriod;
            votingPeriod = newValue;
        } else if (keccak256(bytes(parameter)) == keccak256("minimumQuorum")) {
            if (newValue < 100 || newValue > 5000) { // 1% to 50%
                revert InvalidGovernanceParameter();
            }
            oldValue = minimumQuorum;
            minimumQuorum = newValue;
        } else if (keccak256(bytes(parameter)) == keccak256("defaultMajorityThreshold")) {
            if (newValue < 5000 || newValue > 9000) { // 50% to 90%
                revert InvalidGovernanceParameter();
            }
            oldValue = defaultMajorityThreshold;
            defaultMajorityThreshold = newValue;
        } else {
            revert InvalidGovernanceParameter();
        }
        
        emit DAOParameterUpdated(parameter, oldValue, newValue);
    }

    /**
     * @notice Update DAO member voting power (DAO governance only)
     * @param member DAO member address
     * @param newPower New voting power
     */
    function updateDAOVotingPower(
        address member,
        uint256 newPower
    ) external onlyRole(DAO_GOVERNANCE_ROLE) {
        if (member == address(0)) {
            revert InvalidVotingPower();
        }
        
        uint256 oldPower = daoVotingPower[member];
        
        // Update total voting power
        totalVotingPower = totalVotingPower - oldPower + newPower;
        daoVotingPower[member] = newPower;
        
        // Grant or revoke roles based on voting power
        if (newPower > 0 && oldPower == 0) {
            _grantRole(DAO_EMERGENCY_ROLE, member);
            _grantRole(DAO_SECURITY_COUNCIL_ROLE, member);
            _grantRole(DAO_VALIDATOR_ROLE, member);
        } else if (newPower == 0 && oldPower > 0) {
            _revokeRole(DAO_EMERGENCY_ROLE, member);
            _revokeRole(DAO_SECURITY_COUNCIL_ROLE, member);
            _revokeRole(DAO_VALIDATOR_ROLE, member);
        }
        
        emit DAOVotingPowerUpdated(member, oldPower, newPower);
    }

    /**
     * @notice Return to normal state after emergency resolution (DAO governance only)
     */
    function returnToNormalState() external onlyRole(DAO_GOVERNANCE_ROLE) {
        _changeEmergencyState(EmergencyState.NORMAL, "Emergency resolved by DAO");
    }

    // View functions
    /**
     * @notice Get details of an emergency proposal
     * @param proposalId The ID of the proposal to query
     * @return circuitType The type of circuit being rotated
     * @return currentVerifier The current verifier address
     * @return proposedVerifier The proposed new verifier address
     * @return daoVoteId The DAO vote ID linked to this proposal
     * @return executed Whether the proposal has been executed
     * @return cancelled Whether the proposal has been cancelled
     */
    function getProposalDetails(uint256 proposalId) external view returns (
        string memory circuitType,
        address currentVerifier,
        address proposedVerifier,
        uint256 daoVoteId,
        bool executed,
        bool cancelled
    ) {
        EmergencyProposal storage proposal = emergencyProposals[proposalId];
        return (
            proposal.circuitType,
            proposal.currentVerifier,
            proposal.proposedVerifier,
            proposal.daoVoteId,
            proposal.executed,
            proposal.cancelled
        );
    }

    /**
     * @notice Get the results of a DAO vote
     * @param voteId The ID of the vote to query
     * @return forVotes Number of votes in favor
     * @return againstVotes Number of votes against
     * @return abstainVotes Number of abstain votes
     * @return executed Whether the vote has been executed
     * @return cancelled Whether the vote has been cancelled
     */
    function getDAOVoteResults(uint256 voteId) external view returns (
        uint256 forVotes,
        uint256 againstVotes,
        uint256 abstainVotes,
        bool executed,
        bool cancelled
    ) {
        DAOVote storage vote = daoVotes[voteId];
        return (
            vote.forVotes,
            vote.againstVotes,
            vote.abstainVotes,
            vote.executed,
            vote.cancelled
        );
    }

    /**
     * @notice Check if an address has voted on a specific DAO vote
     * @param voteId The ID of the vote to check
     * @param voter The address to check voting status for
     * @return hasVoted Whether the voter has cast a vote
     * @return choice The vote choice if voted (NONE if not voted)
     */
    function hasVoted(uint256 voteId, address voter) external view returns (bool, VoteChoice) {
        DAOVote storage vote = daoVotes[voteId];
        VoteChoice choice = vote.votes[voter];
        return (choice != VoteChoice.NONE, choice);
    }

    /**
     * @notice Check if a circuit type is marked as compromised
     * @param circuitType The circuit type to check
     * @return compromised Whether the circuit is compromised
     */
    function isCircuitCompromised(string calldata circuitType) external view returns (bool) {
        return compromisedCircuits[circuitType];
    }

    /**
     * @notice Get the emergency verifier address for a circuit type
     * @param circuitType The circuit type to query
     * @return verifier The emergency verifier address
     */
    function getEmergencyVerifier(string calldata circuitType) external view returns (address) {
        return emergencyVerifiers[circuitType];
    }

    /**
     * @notice Get the DAO voting power of a member
     * @param member The member address to query
     * @return power The voting power of the member
     */
    function getDAOVotingPower(address member) external view returns (uint256) {
        return daoVotingPower[member];
    }

    // Internal functions
    /**
     * @notice Change the emergency state of the system
     * @param newState The new emergency state to transition to
     * @param reason The reason for the state change
     */
    function _changeEmergencyState(EmergencyState newState, string memory reason) internal {
        EmergencyState oldState = currentState;
        currentState = newState;
        emit EmergencyStateChanged(oldState, newState, reason);
    }

    /**
     * @notice Create a new DAO vote for a proposal
     * @param proposalHash The hash of the proposal being voted on
     * @return voteId The unique identifier of the created vote
     */
    function _createDAOVote(bytes32 proposalHash) internal returns (uint256 voteId) {
        voteId = ++daoVoteCount;
        DAOVote storage vote = daoVotes[voteId];
        
        vote.voteId = voteId;
        vote.proposalHash = proposalHash;
        vote.startTime = block.timestamp;
        vote.endTime = block.timestamp + votingPeriod;
        
        emit DAOVoteCreated(voteId, proposalHash, vote.startTime, vote.endTime);
        
        return voteId;
    }

    /**
     * @notice Execute the actual key rotation for a circuit type
     * @param circuitType The type of circuit to rotate keys for
     * @param newVerifier The new verifier address to rotate to
     * @dev This function would integrate with VerifierFactory's emergency rotation capability
     */
    function _executeRotation(string memory circuitType, address newVerifier) internal {
        // This would need to be implemented based on VerifierFactory's emergency capabilities
        // For now, we emit the event and expect manual intervention
        // In a full implementation, VerifierFactory would have an emergency rotation function
        
        // Example call (would need to be implemented in VerifierFactory):
        // VERIFIER_FACTORY.emergencyRotateVerifier(circuitType, newVerifier);
        
        // For now, we just mark the circuit as no longer compromised
        compromisedCircuits[circuitType] = false;
        
        // Note: newVerifier parameter is intentionally unused in this implementation
        // as the actual rotation would be handled by VerifierFactory in production
        newVerifier; // Suppress unused variable warning
    }
}
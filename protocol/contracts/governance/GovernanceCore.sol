// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ICommonErrors} from "../interfaces/ICommonErrors.sol";
import {IPrivateGovernance as IPPrivateGovernance} from "../interfaces/IPrivateGovernance.sol";
import {PrivateTokenContract} from "../PrivateTokenContract.sol";
import {VerifierFactory} from "../VerifierFactory.sol";
import {GovernanceProofValidator} from "./GovernanceProofValidator.sol";

// Note: Using IPrivateGovernance.ProposalState and IPrivateGovernance.VoteType enums from interface

/**
 * @title GovernanceCore
 * @author Aegis Protocol Team
 * @dev Core governance functionality: proposals, voting, and execution
 * @notice Extracted from PrivateGovernance to reduce contract size
 */
contract GovernanceCore is ReentrancyGuard, ICommonErrors {
    using GovernanceProofValidator for VerifierFactory;
    
    // Core contracts
    PrivateTokenContract public immutable GOVERNANCE_TOKEN;
    VerifierFactory public VERIFIER_FACTORY;
    
    // Governance parameters (defaults aligned with `scripts/config/sonic.ts` for faster iteration;
    // can be tuned via `setVotingAndExecutionTiming` by owner/governance manager within bounds).
    uint256 private constant DEFAULT_VOTING_PERIOD = 2 days;
    uint256 private constant DEFAULT_EXECUTION_DELAY = 12 hours;
    uint256 private constant DEFAULT_PROPOSAL_THRESHOLD = 100_000e18;
    uint256 private constant DEFAULT_QUORUM_THRESHOLD = 1_000_000e18;
    uint256 private constant DEFAULT_EXECUTION_MAJORITY = 500_000e18;

    /// @notice Minimum voting window (prevents instant governance grabs).
    uint256 public constant MIN_VOTING_PERIOD = 12 hours;
    /// @notice Maximum voting window (safety cap).
    uint256 public constant MAX_VOTING_PERIOD = 14 days;
    /// @notice Minimum timelock after queueing before execution.
    uint256 public constant MIN_EXECUTION_DELAY = 1 hours;
    /// @notice Maximum timelock after queueing.
    uint256 public constant MAX_EXECUTION_DELAY = 7 days;
    
    uint256 public votingPeriod;
    uint256 public executionDelay;
    uint256 public proposalThreshold;
    uint256 public quorumThreshold;
    uint256 public executionMajorityThreshold;
    address public governanceManager;
    uint256 public constant MAX_ACTIONS = 10;
    
    // Timestamp security constants
    uint256 private constant TIMESTAMP_TOLERANCE = 900;
    uint256 private constant MAX_FUTURE_TOLERANCE = 300;
    uint256 private constant MAX_PAST_TOLERANCE = 3600;
    
    // Global state
    struct GovernanceState {
        uint256 nextProposalId;
        uint256 totalVotingPower;
        uint256 activeProposals;
    }
    
    GovernanceState public governanceState;
    
    // Proposal storage
    mapping(uint256 => Proposal) public proposals;
    mapping(uint256 => mapping(bytes32 => Vote)) public votes;
    mapping(uint256 => ProposalVotes) public proposalVotes;
    mapping(bytes32 => bool) public nullifierUsed;
    mapping(uint256 => bytes32[]) public proposalVoters;
    
    address public owner;
    
    struct Proposal {
        uint256 id;
        bytes32 proposerCommitment;
        string title;
        string description;
        address[] targets;
        uint256[] values;
        bytes[] calldatas;
        uint256 startTime;
        uint256 endTime;
        uint256 executionTime;
        IPPrivateGovernance.ProposalState state;
        bytes32 proposalHash;
        bool isPrivate;
        bytes32 privacyNullifier;
    }
    
    struct ProposalVotes {
        uint256 forVotes;
        uint256 againstVotes;
        uint256 abstainVotes;
        uint256 totalVotes;
        bool quorumReached;
    }
    
    struct Vote {
        bytes32 voterCommitment;
        IPPrivateGovernance.VoteType voteType;
        uint256 votingPower;
        uint256 timestamp;
        bytes32 nullifier;
        bool isDelegated;
        bytes32 delegateCommitment;
    }
    
    struct VoteParams {
        uint256 proposalId;
        IPPrivateGovernance.VoteType voteType;
        bytes32 voterCommitment;
        uint256 votingPower;
        uint256 voteTimestamp;
        bytes32 nullifier;
        bytes zkProof;
    }
    
    // Events
    event ProposalCreated(
        uint256 indexed proposalId,
        bytes32 indexed proposerCommitment,
        string title,
        uint256 indexed startTime,
        uint256 endTime
    );
    
    event VoteCast(
        uint256 indexed proposalId,
        bytes32 indexed voterCommitment,
        IPPrivateGovernance.VoteType voteType,
        uint256 votingPower,
        bool isDelegated
    );
    
    event ProposalExecuted(
        uint256 indexed proposalId,
        bytes32 indexed proposerCommitment
    );
    
    event ProposalFailed(
        uint256 indexed proposalId,
        uint256 indexed failedActionIndex,
        bytes returnData
    );
    
    event ProposalCallFailed(
        uint256 indexed proposalId,
        uint256 indexed callIndex,
        address indexed target
    );
    
    event ProposalCancelled(
        uint256 indexed proposalId,
        bytes32 indexed proposerCommitment
    );
    
    event QuorumReached(
        uint256 indexed proposalId,
        uint256 indexed totalVotes,
        uint256 indexed timestamp
    );
    
    event ProposalCallReverted(
        address indexed target,
        bytes returnData
    );
    
    modifier validProposal(uint256 proposalId) {
        if (proposalId >= governanceState.nextProposalId) revert InvalidProposalId();
        _;
    }
    
    modifier onlyValidProof(bytes memory proof, bytes32 commitment) {
        GovernanceProofValidator.validateProof(VERIFIER_FACTORY, proof, commitment, governanceState.nextProposalId);
        _;
    }
    
    modifier onlyValidProofWithProposal(bytes memory proof, bytes32 commitment, uint256 proposalId) {
        GovernanceProofValidator.validateProof(VERIFIER_FACTORY, proof, commitment, proposalId);
        _;
    }
    
    constructor(
        address _governanceToken,
        address _verifierFactory
    ) {
        GOVERNANCE_TOKEN = PrivateTokenContract(_governanceToken);
        if (_verifierFactory == address(0)) revert InvalidAddress();
        VERIFIER_FACTORY = VerifierFactory(_verifierFactory);
        owner = msg.sender;
        votingPeriod = DEFAULT_VOTING_PERIOD;
        executionDelay = DEFAULT_EXECUTION_DELAY;
        proposalThreshold = DEFAULT_PROPOSAL_THRESHOLD;
        quorumThreshold = DEFAULT_QUORUM_THRESHOLD;
        executionMajorityThreshold = DEFAULT_EXECUTION_MAJORITY;
        governanceManager = msg.sender;
    }
    
    function setVerifierFactory(address _verifierFactory) external {
        if (msg.sender != owner) revert NotOwner();
        if (address(VERIFIER_FACTORY) != address(0)) revert AlreadySet();
        if (_verifierFactory == address(0)) revert InvalidAddress();
        VERIFIER_FACTORY = VerifierFactory(_verifierFactory);
    }
    
    /**
     * @notice Create a new governance proposal
     */
    function createProposal(
        IPPrivateGovernance.ProposalParams calldata params
    ) external nonReentrant onlyValidProof(params.zkProof, params.proposerCommitment) returns (uint256) {
        if (nullifierUsed[params.nullifier]) {
            revert NullifierAlreadyUsed();
        }
        if (params.targets.length == 0) revert NoActionsProvided();
        if (params.targets.length > MAX_ACTIONS) revert TooManyActions();
        if (params.targets.length != params.values.length || params.targets.length != params.calldatas.length) {
            revert MismatchedArrays();
        }
        if (bytes(params.title).length == 0) revert EmptyTitle();
        if (bytes(params.description).length == 0) revert EmptyDescription();
        uint256 proposerPower = _getVotingPower(params.proposerCommitment);
        if (proposerPower < proposalThreshold) {
            revert InsufficientVotingPower();
        }
        
        nullifierUsed[params.nullifier] = true;
        
        uint256 proposalId;
        unchecked {
            proposalId = governanceState.nextProposalId++;
            governanceState.activeProposals++;
        }
        
        bytes32 proposalHash = keccak256(
            abi.encode(proposalId, params.targets, params.values, params.calldatas, params.proposerCommitment)
        );
        
        uint256 currentTime = block.timestamp;
        
        proposals[proposalId] = Proposal({
            id: proposalId,
            proposerCommitment: params.proposerCommitment,
            title: params.title,
            description: params.description,
            targets: params.targets,
            values: params.values,
            calldatas: params.calldatas,
            startTime: currentTime,
            endTime: currentTime + votingPeriod,
            executionTime: 0,
            state: IPPrivateGovernance.ProposalState.ACTIVE,
            proposalHash: proposalHash,
            isPrivate: true,
            privacyNullifier: params.nullifier
        });
        
        emit ProposalCreated(
            proposalId,
            params.proposerCommitment,
            params.title,
            currentTime,
            currentTime + votingPeriod
        );
        return proposalId;
    }
    
    /**
     * @notice Cast a vote on a proposal
     */
    function castVote(
        VoteParams calldata params
    ) external nonReentrant validProposal(params.proposalId) 
        onlyValidProofWithProposal(params.zkProof, params.voterCommitment, params.proposalId) {
        if (nullifierUsed[params.nullifier]) revert NullifierAlreadyUsed();
        if (params.votingPower == 0) revert NoVotingPower();
        
        uint256 currentTime = block.timestamp;
        
        if (params.voteTimestamp > currentTime + MAX_FUTURE_TOLERANCE) revert VoteTimestampTooFarInFuture();
        if (params.voteTimestamp < currentTime - MAX_PAST_TOLERANCE) revert VoteTimestampTooOld();
        
        Proposal storage proposal = proposals[params.proposalId];
        uint8 stateValue = uint8(proposal.state);
        if (stateValue == 0 || stateValue > 1) revert ProposalNotActive();
        if (currentTime > proposal.endTime + TIMESTAMP_TOLERANCE) revert VotingPeriodEnded();
        if (votes[params.proposalId][params.voterCommitment].voterCommitment != bytes32(0)) revert AlreadyVoted();
        
        uint256 actualPower = _getVotingPower(params.voterCommitment);
        if (params.votingPower > actualPower) revert InsufficientVotingPower();
        
        nullifierUsed[params.nullifier] = true;
        
        votes[params.proposalId][params.voterCommitment] = Vote({
            voterCommitment: params.voterCommitment,
            voteType: params.voteType,
            votingPower: params.votingPower,
            timestamp: currentTime,
            nullifier: params.nullifier,
            isDelegated: false,
            delegateCommitment: bytes32(0)
        });
        
        ProposalVotes storage pVotes = proposalVotes[params.proposalId];
        uint8 voteTypeValue = uint8(params.voteType);
        unchecked {
            if (voteTypeValue < 1) {
                pVotes.againstVotes += params.votingPower;
            } else if (voteTypeValue < 2) {
                pVotes.forVotes += params.votingPower;
            } else {
                pVotes.abstainVotes += params.votingPower;
            }
            pVotes.totalVotes += params.votingPower;
        }
        
        if (!pVotes.quorumReached && pVotes.totalVotes >= quorumThreshold) {
            pVotes.quorumReached = true;
            emit QuorumReached(params.proposalId, pVotes.totalVotes, currentTime);
        }
        
        proposalVoters[params.proposalId].push(params.voterCommitment);
        
        emit VoteCast(
            params.proposalId,
            params.voterCommitment,
            params.voteType,
            params.votingPower,
            false
        );
    }
    
    /**
     * @notice Queue a successful proposal
     */
    function queueProposal(uint256 proposalId) external nonReentrant validProposal(proposalId) {
        uint256 currentTime = block.timestamp;
        Proposal storage proposal = proposals[proposalId];
        IPPrivateGovernance.ProposalState currentState = proposal.state;
        if (IPPrivateGovernance.ProposalState(currentState) != IPPrivateGovernance.ProposalState.ACTIVE) 
        revert ProposalNotActive();
        if (currentTime <= proposal.endTime + MAX_FUTURE_TOLERANCE) revert VotingStillActive();
        
        ProposalVotes memory pVotes = proposalVotes[proposalId];
        
        if (
            pVotes.quorumReached &&
            pVotes.forVotes > pVotes.againstVotes &&
            pVotes.forVotes >= executionMajorityThreshold
        ) {
            proposal.state = IPPrivateGovernance.ProposalState.QUEUED;
            proposal.executionTime = currentTime + executionDelay;
        } else {
            proposal.state = IPPrivateGovernance.ProposalState.DEFEATED;
            unchecked {
                governanceState.activeProposals--;
            }
        }
    }
    
    /**
     * @notice Execute a queued proposal
     */
    function executeProposal(uint256 proposalId) external nonReentrant validProposal(proposalId) {
        Proposal storage proposal = proposals[proposalId];
        
        _validateProposalForExecution(proposal);
        _validateExecutionTargets(proposal.targets.length);
        
        proposal.state = IPPrivateGovernance.ProposalState.EXECUTED;
        unchecked {
            governanceState.activeProposals--;
        }
        
        (uint256 successfulCalls, uint256 failedCalls) = _executeProposalCalls(proposalId, proposal);
        _handleExecutionOutcome(proposalId, proposal, successfulCalls, failedCalls);
    }
    
    /**
     * @notice Cancel a proposal
     * @dev ZK proof public inputs must reference this `proposalId` (not `nextProposalId`), matching
     *      `GovernanceProofValidator` / `onlyValidProofWithProposal`.
     */
    function cancelProposal(
        uint256 proposalId,
        bytes32 nullifier,
        bytes calldata zkProof
    ) external nonReentrant validProposal(proposalId)
        onlyValidProofWithProposal(zkProof, proposals[proposalId].proposerCommitment, proposalId) {
        if (nullifierUsed[nullifier]) revert NullifierAlreadyUsed();
        
        Proposal storage proposal = proposals[proposalId];
        if (IPPrivateGovernance.ProposalState(proposal.state) != IPPrivateGovernance.ProposalState.ACTIVE && 
            IPPrivateGovernance.ProposalState(proposal.state) != IPPrivateGovernance.ProposalState.QUEUED) {
            revert CannotCancelProposal();
        }
        
        nullifierUsed[nullifier] = true;
        proposal.state = IPPrivateGovernance.ProposalState.CANCELED;
        unchecked {
            governanceState.activeProposals--;
        }
        
        emit ProposalCancelled(proposalId, proposal.proposerCommitment);
    }
    
    function setGovernanceManager(address newManager) external {
        if (msg.sender != owner) revert NotOwner();
        if (newManager == address(0)) revert InvalidAddress();
        governanceManager = newManager;
        emit GovernanceManagerUpdated(newManager);
    }

    /**
     * @notice Adjust voting length and post-queue execution delay (e.g. testnet vs mainnet policy).
     * @dev Callable by `owner` or `governanceManager` (typically the `PrivateGovernance` facade).
     */
    function setVotingAndExecutionTiming(uint256 newVotingPeriod, uint256 newExecutionDelay) external {
        if (msg.sender != owner && msg.sender != governanceManager) revert NotOwner();
        if (newVotingPeriod < MIN_VOTING_PERIOD || newVotingPeriod > MAX_VOTING_PERIOD) revert InvalidDuration();
        if (newExecutionDelay < MIN_EXECUTION_DELAY || newExecutionDelay > MAX_EXECUTION_DELAY) revert InvalidDuration();
        votingPeriod = newVotingPeriod;
        executionDelay = newExecutionDelay;
        emit VotingAndExecutionTimingUpdated(newVotingPeriod, newExecutionDelay);
    }
    
    event GovernanceParametersUpdated(
        uint256 proposalThreshold,
        uint256 quorumThreshold,
        uint256 executionMajorityThreshold
    );
    
    event GovernanceManagerUpdated(address indexed newManager);
    
    event VotingAndExecutionTimingUpdated(uint256 votingPeriod, uint256 executionDelay);
    
    function updateGovernanceParameters(
        uint256 newProposalThreshold,
        uint256 newQuorumThreshold,
        uint256 newExecutionMajorityThreshold
    ) external {
        if (msg.sender != owner && msg.sender != governanceManager) revert NotOwner();
        if (newProposalThreshold == 0 || newQuorumThreshold == 0) revert InvalidAmount();
        if (newExecutionMajorityThreshold == 0) revert InvalidAmount();
        if (newProposalThreshold > newQuorumThreshold) revert InvalidAmount();
        if (newExecutionMajorityThreshold > newQuorumThreshold) revert InvalidAmount();
        proposalThreshold = newProposalThreshold;
        quorumThreshold = newQuorumThreshold;
        executionMajorityThreshold = newExecutionMajorityThreshold;
        emit GovernanceParametersUpdated(newProposalThreshold, newQuorumThreshold, newExecutionMajorityThreshold);
    }
    
    // Internal functions
    function _getVotingPower(bytes32 commitment) internal view returns (uint256) {
        uint256 basePower = GOVERNANCE_TOKEN.getBalance(commitment);
        return basePower;
    }
    
    function _validateProposalForExecution(Proposal storage proposal) internal view {
        uint256 currentTime = block.timestamp;
        IPPrivateGovernance.ProposalState currentState = proposal.state;
        if (IPPrivateGovernance.ProposalState(currentState) != IPPrivateGovernance.ProposalState.QUEUED) 
        revert ProposalNotQueued();
        if (currentTime < proposal.executionTime - TIMESTAMP_TOLERANCE) revert ExecutionDelayNotMet();
    }
    
    function _validateExecutionTargets(uint256 targetsLength) internal view {
        if (targetsLength > MAX_ACTIONS) revert TooManyTargets();
        if (targetsLength == 0) revert NoTargetsToExecute();
        uint256 minGasReserve = 100_000;
        if (gasleft() < minGasReserve + (targetsLength * 50_000) + 1) revert InsufficientGasForExecution();
    }
    
    function _executeProposalCalls(
        uint256 proposalId, 
        Proposal storage proposal
    ) internal returns (uint256 successfulCalls, uint256 failedCalls) {
        uint256 targetsLength = proposal.targets.length;
        uint256 minGasReserve = 100_000;
        
        for (uint256 i = 0; i < targetsLength; ++i) {
            if (gasleft() < minGasReserve + 50_000) {
                emit ProposalCallFailed(proposalId, i, proposal.targets[i]);
                unchecked { ++failedCalls; }
                continue;
            }
            
            if (proposal.targets[i] == address(this)) {
                emit ProposalCallFailed(proposalId, i, proposal.targets[i]);
                unchecked { ++failedCalls; }
                continue;
            }
            
            uint256 remainingCalls = targetsLength - i;
            if (remainingCalls == 0) {
                emit ProposalCallFailed(proposalId, i, proposal.targets[i]);
                unchecked { ++failedCalls; }
                continue;
            }
            uint256 gasForCall = (gasleft() - minGasReserve) / remainingCalls;
            if (gasForCall > 20_000_000) gasForCall = 20_000_000;
            
            bool success = _executeCall(
                proposal.targets[i],
                proposal.values[i],
                proposal.calldatas[i],
                gasForCall
            );
            
            if (success) {
                unchecked { ++successfulCalls; }
            } else {
                emit ProposalCallFailed(proposalId, i, proposal.targets[i]);
                unchecked { ++failedCalls; }
            }
        }
    }
    
    function _handleExecutionOutcome(
        uint256 proposalId,
        Proposal storage proposal,
        uint256 successfulCalls,
        uint256 failedCalls
    ) internal {
        uint256 totalCalls = successfulCalls + failedCalls;
        
        if (successfulCalls == totalCalls) {
            emit ProposalExecuted(proposalId, proposal.proposerCommitment);
        } else if (successfulCalls > 0) {
            emit ProposalExecuted(proposalId, proposal.proposerCommitment);
            emit ProposalFailed(proposalId, failedCalls, abi.encode("Partial execution", successfulCalls, failedCalls));
        } else {
            proposal.state = IPPrivateGovernance.ProposalState.QUEUED;
            unchecked {
                governanceState.activeProposals++;
            }
            emit ProposalFailed(proposalId, 0, abi.encode("All calls failed"));
            revert ProposalExecutionFailed();
        }
    }
    
    function _executeCall(
        address target,
        uint256 value,
        bytes memory data,
        uint256 gasLimit
    ) internal returns (bool success) {
        if (target == address(0)) revert InvalidTargetAddress();
        if (target.code.length == 0) revert TargetNotContract();
        if (gasLimit > 20_000_000) revert GasLimitTooHigh();
        if (gasleft() < gasLimit + 15000) return false;
        
        bytes memory returnData;
        assembly ("memory-safe") {
            returnData := mload(0x40)
            mstore(0x40, add(returnData, 0x420))
            
            success := call(
                gasLimit,
                target,
                value,
                add(data, 0x20),
                mload(data),
                add(returnData, 0x20),
                0x400
            )
            
            mstore(returnData, returndatasize())
            if gt(returndatasize(), 0x400) {
                mstore(returnData, 0x400)
            }
        }
        
        if (!success && returnData.length > 0) {
            emit ProposalCallReverted(target, returnData);
        }
        
        return success;
    }
    
    // View functions
    function getProposalState(uint256 proposalId) external view validProposal(proposalId) 
    returns (IPPrivateGovernance.ProposalState) {
        Proposal memory proposal = proposals[proposalId];
        if (proposal.state != IPPrivateGovernance.ProposalState.ACTIVE) return proposal.state;
        
        uint256 currentTime = block.timestamp;
        if (currentTime <= proposal.endTime + MAX_FUTURE_TOLERANCE) return IPPrivateGovernance.ProposalState.ACTIVE;
        
        ProposalVotes memory pVotes = proposalVotes[proposalId];
        if (pVotes.quorumReached && pVotes.forVotes > pVotes.againstVotes) {
            return IPPrivateGovernance.ProposalState.SUCCEEDED;
        } else {
            return IPPrivateGovernance.ProposalState.DEFEATED;
        }
    }
    
    function getProposal(uint256 proposalId) external view returns (
        string memory title,
        string memory description,
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        uint256 startTime,
        uint256 endTime,
        uint256 executionTime,
        IPPrivateGovernance.ProposalState state
    ) {
        Proposal memory proposal = proposals[proposalId];
        return (
            proposal.title,
            proposal.description,
            proposal.targets,
            proposal.values,
            proposal.calldatas,
            proposal.startTime,
            proposal.endTime,
            proposal.executionTime,
            proposal.state
        );
    }
    
    function getProposalVotes(uint256 proposalId) external view returns (ProposalVotes memory) {
        return proposalVotes[proposalId];
    }
    
    /**
     * @notice Get proposal votes as individual values (for facade compatibility)
     */
    function getProposalVotesUnpacked(uint256 proposalId) external view returns (
        uint256 forVotes,
        uint256 againstVotes,
        uint256 abstainVotes,
        uint256 totalVotes,
        bool quorumReached
    ) {
        ProposalVotes memory pVotes = proposalVotes[proposalId];
        return (pVotes.forVotes, pVotes.againstVotes, pVotes.abstainVotes, pVotes.totalVotes, pVotes.quorumReached);
    }
    
    function getVote(uint256 proposalId, bytes32 voterCommitment) external view returns (Vote memory) {
        return votes[proposalId][voterCommitment];
    }
    
    /**
     * @notice Get vote as individual values (for facade compatibility)
     */
    function getVoteUnpacked(uint256 proposalId, bytes32 voterCommitment) external view returns (
        bytes32 voterCommitmentOut,
        IPPrivateGovernance.VoteType voteType,
        uint256 votingPower,
        uint256 timestamp,
        bytes32 nullifier,
        bool isDelegated,
        bytes32 delegateCommitment
    ) {
        Vote memory vote = votes[proposalId][voterCommitment];
        return (
            vote.voterCommitment,
            vote.voteType,
            vote.votingPower,
            vote.timestamp,
            vote.nullifier,
            vote.isDelegated,
            vote.delegateCommitment
        );
    }
    
    /**
     * @notice Cast vote with individual parameters (for facade compatibility)
     */
    function castVoteUnpacked(
        uint256 proposalId,
        IPPrivateGovernance.VoteType voteType,
        bytes32 voterCommitment,
        uint256 votingPower,
        uint256 voteTimestamp,
        bytes32 nullifier,
        bytes calldata zkProof
    ) external nonReentrant validProposal(proposalId) 
        onlyValidProofWithProposal(zkProof, voterCommitment, proposalId) {
        // Inline the castVote logic to avoid circular dependency
        if (nullifierUsed[nullifier]) revert NullifierAlreadyUsed();
        if (votingPower == 0) revert NoVotingPower();
        
        uint256 currentTime = block.timestamp;
        if (voteTimestamp > currentTime + MAX_FUTURE_TOLERANCE) revert VoteTimestampTooFarInFuture();
        if (voteTimestamp < currentTime - MAX_PAST_TOLERANCE) revert VoteTimestampTooOld();
        
        Proposal storage proposal = proposals[proposalId];
        uint8 stateValue = uint8(proposal.state);
        if (stateValue == 0 || stateValue > 1) revert ProposalNotActive();
        if (currentTime > proposal.endTime + TIMESTAMP_TOLERANCE) revert VotingPeriodEnded();
        if (votes[proposalId][voterCommitment].voterCommitment != bytes32(0)) revert AlreadyVoted();
        
        uint256 actualPower = _getVotingPower(voterCommitment);
        if (votingPower > actualPower) revert InsufficientVotingPower();
        
        nullifierUsed[nullifier] = true;
        
        votes[proposalId][voterCommitment] = Vote({
            voterCommitment: voterCommitment,
            voteType: voteType,
            votingPower: votingPower,
            timestamp: currentTime,
            nullifier: nullifier,
            isDelegated: false,
            delegateCommitment: bytes32(0)
        });
        
        ProposalVotes storage pVotes = proposalVotes[proposalId];
        uint8 voteTypeValue = uint8(voteType);
        unchecked {
            if (voteTypeValue < 1) {
                pVotes.againstVotes += votingPower;
            } else if (voteTypeValue < 2) {
                pVotes.forVotes += votingPower;
            } else {
                pVotes.abstainVotes += votingPower;
            }
            pVotes.totalVotes += votingPower;
        }
        
        if (!pVotes.quorumReached && pVotes.totalVotes >= quorumThreshold) {
            pVotes.quorumReached = true;
            emit QuorumReached(proposalId, pVotes.totalVotes, currentTime);
        }
        
        proposalVoters[proposalId].push(voterCommitment);
        
        emit VoteCast(proposalId, voterCommitment, voteType, votingPower, false);
    }
    
    function getVotingPower(bytes32 commitment) external view returns (uint256) {
        return _getVotingPower(commitment);
    }
    
    function getProposalVoters(uint256 proposalId) external view returns (bytes32[] memory) {
        return proposalVoters[proposalId];
    }
    
    function getGovernanceMetrics() external view returns (
        uint256,
        uint256,
        uint256
    ) {
        return (
            governanceState.nextProposalId,
            governanceState.activeProposals,
            governanceState.totalVotingPower
        );
    }
    
    function isNullifierUsed(bytes32 nullifier) external view returns (bool) {
        return nullifierUsed[nullifier];
    }
    
    function hasVotingPower(address voter) external view returns (bool) {
        address tokenAddress = address(GOVERNANCE_TOKEN);
        uint256 codeSize;
        assembly {
            codeSize := extcodesize(tokenAddress)
        }
        
        if (codeSize > 0) {
            try GOVERNANCE_TOKEN.balanceOf(voter) returns (uint256 balance) {
                return balance > 0;
            } catch {
                return false;
            }
        } else {
            return voter != address(0);
        }
    }
    
    function getGovernanceConfig() external view returns (
        uint256 votingPeriodOut,
        uint256 executionDelayOut,
        uint256 proposalThresholdOut,
        uint256 quorumThresholdOut,
        uint256 executionMajorityThresholdOut
    ) {
        return (
            votingPeriod,
            executionDelay,
            proposalThreshold,
            quorumThreshold,
            executionMajorityThreshold
        );
    }
    
    error AlreadySet();
    // Other errors are inherited from ICommonErrors
}


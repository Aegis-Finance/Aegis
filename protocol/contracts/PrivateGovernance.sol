// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {ICommonErrors} from "./interfaces/ICommonErrors.sol";
import {IPrivateGovernance} from "./interfaces/IPrivateGovernance.sol";
import {GovernanceCore} from "./governance/GovernanceCore.sol";
import {GovernanceDelegation} from "./governance/GovernanceDelegation.sol";
import {GovernanceTreasury} from "./governance/GovernanceTreasury.sol";
import {IShieldedGovernanceTally} from "./interfaces/IShieldedGovernanceTally.sol";

/**
 * @title PrivateGovernance
 * @author Aegis Protocol Team
 * @dev Main governance facade that delegates to modular components
 * @notice This contract maintains the IPrivateGovernance interface while delegating
 *         to smaller modules (GovernanceCore, GovernanceDelegation) to reduce contract size
 */
contract PrivateGovernance is ReentrancyGuard, ICommonErrors, IPrivateGovernance {
    // Core governance modules
    GovernanceCore public immutable GOVERNANCE_CORE;
    GovernanceDelegation public immutable GOVERNANCE_DELEGATION;
    GovernanceTreasury public immutable GOVERNANCE_TREASURY;
    
    address public owner;
    bytes32 public auctionFallbackHookId;
    address public shieldedGovernanceTally;

    event AuctionFallbackHookRegistered(bytes32 indexed fallbackId);
    event ShieldedGovernanceTallyUpdated(address indexed previous, address indexed next);
    event GovernanceParametersQueued(
        uint256 proposalThreshold,
        uint256 quorumThreshold,
        uint256 executionMajorityThreshold
    );

    constructor(
        address _governanceCore,
        address _governanceDelegation,
        address payable _governanceTreasury
    ) {
        if (_governanceCore == address(0)) revert ZeroAddress();
        if (_governanceDelegation == address(0)) revert ZeroAddress();
        if (_governanceTreasury == address(0)) revert ZeroAddress();
        
        GOVERNANCE_CORE = GovernanceCore(_governanceCore);
        GOVERNANCE_DELEGATION = GovernanceDelegation(_governanceDelegation);
        GOVERNANCE_TREASURY = GovernanceTreasury(_governanceTreasury);
        owner = msg.sender;
    }
    
    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    /**
     * @notice Submit a new proposal (delegates to GovernanceCore)
     */
    function submitProposal(ProposalParams calldata params) external returns (uint256) {
        return GOVERNANCE_CORE.createProposal(params);
    }

    function createProposal(ProposalParams calldata params) external override returns (uint256) {
        return GOVERNANCE_CORE.createProposal(params);
    }
    
    /**
     * @notice Queue a successful proposal (delegates to GovernanceCore)
     */
    function queueProposal(uint256 proposalId) external {
        GOVERNANCE_CORE.queueProposal(proposalId);
    }
    
    /**
     * @notice Execute a queued proposal (delegates to GovernanceCore)
     */
    function executeProposal(uint256 proposalId) external {
        GOVERNANCE_CORE.executeProposal(proposalId);
    }
    
    /**
     * @notice Get proposal state (delegates to GovernanceCore)
     */
    function getProposalState(uint256 proposalId) external view returns (ProposalState) {
        return GOVERNANCE_CORE.getProposalState(proposalId);
    }
    
    /**
     * @notice Get proposal details (delegates to GovernanceCore)
     */
    function getProposal(uint256 proposalId) external view returns (
        string memory title,
        string memory description,
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        uint256 startTime,
        uint256 endTime,
        uint256 executionTime,
        ProposalState state
    ) {
        return GOVERNANCE_CORE.getProposal(proposalId);
    }
    
    /**
     * @notice Check if address has voting power (delegates to GovernanceCore)
     */
    function hasVotingPower(address voter) external view returns (bool) {
        return GOVERNANCE_CORE.hasVotingPower(voter);
    }
    
    /**
     * @notice Get governance configuration (delegates to GovernanceCore)
     */
    function getGovernanceConfig() external view returns (
        uint256 votingPeriod,
        uint256 executionDelay,
        uint256 proposalThreshold,
        uint256 quorumThreshold,
        uint256 executionMajorityThreshold
    ) {
        return GOVERNANCE_CORE.getGovernanceConfig();
    }
    
    /**
     * @notice Get voting power for a commitment (delegates to GovernanceDelegation)
     */
    function getVotingPower(bytes32 commitment) external view returns (uint256) {
        return GOVERNANCE_DELEGATION.getVotingPower(commitment);
    }
    
    /**
     * @notice Delegate voting power (delegates to GovernanceDelegation)
     */
    function delegateVotingPower(
        bytes32 delegatorCommitment,
        bytes32 delegateCommitment,
        uint256 delegatedPower,
        bytes32 nullifier,
        bytes calldata zkProof
    ) external {
        GOVERNANCE_DELEGATION.delegateVotingPowerUnpacked(
            delegatorCommitment,
            delegateCommitment,
            delegatedPower,
            nullifier,
            zkProof
        );
    }
    
    /**
     * @notice Revoke delegation (delegates to GovernanceDelegation)
     */
    function revokeDelegation(
        bytes32 delegatorCommitment,
        bytes32 nullifier,
        bytes calldata zkProof
    ) external {
        GOVERNANCE_DELEGATION.revokeDelegation(delegatorCommitment, nullifier, zkProof);
    }
    
    /**
     * @notice Cast a vote (delegates to GovernanceCore)
     */
    function castVote(
        uint256 proposalId,
        VoteType voteType,
        bytes32 voterCommitment,
        uint256 votingPower,
        uint256 voteTimestamp,
        bytes32 nullifier,
        bytes calldata zkProof
    ) external {
        GOVERNANCE_CORE.castVoteUnpacked(
            proposalId,
            voteType,
            voterCommitment,
            votingPower,
            voteTimestamp,
            nullifier,
            zkProof
        );
    }
    
    /**
     * @notice Cancel a proposal (delegates to GovernanceCore)
     */
    function cancelProposal(
        uint256 proposalId, 
        bytes32 nullifier,
        bytes calldata zkProof
    ) external {
        GOVERNANCE_CORE.cancelProposal(proposalId, nullifier, zkProof);
    }
    
    function registerAuctionFallbackHook(bytes32 fallbackId) external onlyOwner {
        if (fallbackId == bytes32(0)) revert InvalidCommitment();
        auctionFallbackHookId = fallbackId;
        emit AuctionFallbackHookRegistered(fallbackId);
    }

    function setShieldedGovernanceTally(address tally) external onlyOwner {
        emit ShieldedGovernanceTallyUpdated(shieldedGovernanceTally, tally);
        shieldedGovernanceTally = tally;
    }

    /**
     * @notice Register a proposal on `ShieldedGovernanceTally` for hidden-until-finalize vote aggregation.
     * @dev `ShieldedGovernanceTally` must have `governanceContract` set to this facade or `GovernanceCore`.
     */
    function registerShieldedTallyProposal(uint256 proposalId, uint256 votingEnds) external onlyOwner {
        if (shieldedGovernanceTally == address(0)) revert ZeroAddress();
        IShieldedGovernanceTally(shieldedGovernanceTally).registerProposal(proposalId, votingEnds);
    }

    /**
     * @notice Forward a call with `msg.sender` equal to this governance facade (for `GovernanceAccessLib` checks on targets).
     * @dev **Owner-only** bootstrap / ops hook. Rotate `owner` to a multisig before production; do not leave an EOA
     *      owner on mainnet with this surface live. Typical calldata: `VerifierFactory.deployVerifier`, `PrivateTokenContract.authorizeContract`.
     * @param target Contract to invoke (must implement the expected interface).
     * @param data ABI-encoded call on `target`.
     */
    function forwardGovernanceCall(address target, bytes calldata data) external onlyOwner {
        if (target == address(0)) revert ZeroAddress();
        Address.functionCall(target, data);
    }
    
    function updateGovernanceParameters(
        uint256 newProposalThreshold,
        uint256 newQuorumThreshold,
        uint256 newExecutionMajorityThreshold
    ) external onlyOwner {
        GOVERNANCE_CORE.updateGovernanceParameters(
            newProposalThreshold,
            newQuorumThreshold,
            newExecutionMajorityThreshold
        );
        emit GovernanceParametersQueued(
            newProposalThreshold,
            newQuorumThreshold,
            newExecutionMajorityThreshold
        );
    }

    /**
     * @notice Tune voting period and execution delay within on-chain bounds (see `GovernanceCore` min/max).
     * @dev Only the facade `owner` (bootstrap deployer / DAO-assigned owner) may call; execution uses
     *      `governanceManager` auth on the core module so the call path is valid.
     */
    function setVotingAndExecutionTiming(uint256 newVotingPeriod, uint256 newExecutionDelay) external onlyOwner {
        GOVERNANCE_CORE.setVotingAndExecutionTiming(newVotingPeriod, newExecutionDelay);
    }
    
    // Note: The following functions return structs from modules
    // Since structs are internal, we expose the module functions directly
    // Users can call GOVERNANCE_CORE.getProposalVotes() etc. directly
    
    /**
     * @notice Get proposal votes - delegates to GovernanceCore
     */
    function getProposalVotes(uint256 proposalId) external view returns (
        uint256 forVotes,
        uint256 againstVotes,
        uint256 abstainVotes,
        uint256 totalVotes,
        bool quorumReached
    ) {
        return GOVERNANCE_CORE.getProposalVotesUnpacked(proposalId);
    }
    
    /**
     * @notice Get vote details - delegates to GovernanceCore  
     */
    function getVote(uint256 proposalId, bytes32 voterCommitment) external view returns (
        bytes32 voterCommitmentOut,
        VoteType voteType,
        uint256 votingPower,
        uint256 timestamp,
        bytes32 nullifier,
        bool isDelegated,
        bytes32 delegateCommitment
    ) {
        return GOVERNANCE_CORE.getVoteUnpacked(proposalId, voterCommitment);
    }
    
    /**
     * @notice Get delegation info - delegates to GovernanceDelegation
     */
    function getDelegation(bytes32 delegatorCommitment) external view returns (
        bytes32 delegatorCommitmentOut,
        bytes32 delegateCommitment,
        uint256 delegatedPower,
        uint256 timestamp,
        bool isActive,
        bytes32 nullifier
    ) {
        return GOVERNANCE_DELEGATION.getDelegationUnpacked(delegatorCommitment);
    }
    
    function isNullifierUsed(bytes32 nullifier) external view returns (bool) {
        return GOVERNANCE_CORE.isNullifierUsed(nullifier);
    }
    
    function getGovernanceMetrics() external view returns (
        uint256 nextProposalId,
        uint256 activeProposals,
        uint256 totalVotingPower
    ) {
        return GOVERNANCE_CORE.getGovernanceMetrics();
    }

    // ============ TREASURY FUNCTIONS ============
    
    /**
     * @notice Create a treasury proposal (delegates to GovernanceTreasury)
     * @param title Proposal title
     * @param description Proposal description
     * @param proposalType Type of treasury proposal
     * @param recipient Address to receive treasury funds
     * @param amount Amount to transfer
     * @param proposerCommitment Proposer's commitment (for ZK proof)
     * @param nullifier Nullifier for ZK proof
     * @param zkProof ZK proof for proposal creation
     * @return proposalId The governance proposal ID
     */
    function createTreasuryProposal(
        string memory title,
        string memory description,
        GovernanceTreasury.TreasuryProposalType proposalType,
        address recipient,
        uint256 amount,
        bytes32 proposerCommitment,
        bytes32 nullifier,
        bytes calldata zkProof
    ) external returns (uint256 proposalId) {
        return GOVERNANCE_TREASURY.createTreasuryProposal(
            title,
            description,
            proposalType,
            recipient,
            amount,
            proposerCommitment,
            nullifier,
            zkProof
        );
    }

    /**
     * @notice Get treasury state (delegates to GovernanceTreasury)
     * @return state Treasury state struct
     */
    function getTreasuryState() external view returns (GovernanceTreasury.TreasuryState memory state) {
        return GOVERNANCE_TREASURY.getTreasuryState();
    }

    /**
     * @notice Get treasury proposal (delegates to GovernanceTreasury)
     * @param proposalId Governance proposal ID
     * @return proposal Treasury proposal struct
     */
    function getTreasuryProposal(uint256 proposalId) 
    external view returns (GovernanceTreasury.TreasuryProposal memory proposal) {
        return GOVERNANCE_TREASURY.getTreasuryProposal(proposalId);
    }
}

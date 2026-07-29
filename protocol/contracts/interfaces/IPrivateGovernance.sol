// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/**
 * @title IPrivateGovernance
 * @dev Interface for PrivateGovernance contract
 */
interface IPrivateGovernance {
    enum ProposalState {
        PENDING,
        ACTIVE,
        CANCELED,
        DEFEATED,
        SUCCEEDED,
        QUEUED,
        EXPIRED,
        EXECUTED
    }
    
    enum VoteType {
        AGAINST,
        FOR,
        ABSTAIN
    }
    
    struct ProposalParams {
        string title;
        string description;
        address[] targets;
        uint256[] values;
        bytes[] calldatas;
        bytes32 proposerCommitment;
        bytes32 nullifier;
        bytes zkProof;
    }
    
    /**
     * @dev Create a new proposal with full parameter set
     * @param params Proposal parameters including ZK proof
     * @return proposalId The ID of the created proposal
     */
    function createProposal(ProposalParams calldata params) external returns (uint256 proposalId);
    
    /**
     * @dev Submit a new proposal (legacy entry-point)
     * @param params Proposal parameters including ZK proof
     * @return proposalId The ID of the created proposal
     */
    function submitProposal(ProposalParams calldata params) external returns (uint256 proposalId);
    
    /**
     * @dev Queue a successful proposal for execution
     * @param proposalId Proposal to queue
     */
    function queueProposal(uint256 proposalId) external;
    
    /**
     * @dev Execute a queued proposal
     * @param proposalId Proposal to execute
     */
    function executeProposal(uint256 proposalId) external;
    
    /**
     * @dev Get proposal state
     * @param proposalId Proposal ID
     * @return state Current state of the proposal
     */
    function getProposalState(uint256 proposalId) external view returns (ProposalState state);
    
    /**
     * @dev Get proposal details
     * @param proposalId Proposal ID
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
    );
    
    /**
     * @dev Check if address has voting power
     * @param voter Address to check
     * @return hasVotingPower Whether the address can vote
     */
    function hasVotingPower(address voter) external view returns (bool hasVotingPower);
    
    /**
     * @dev Get governance configuration
     */
    function getGovernanceConfig() external view returns (
        uint256 votingPeriod,
        uint256 executionDelay,
        uint256 proposalThreshold,
        uint256 quorumThreshold,
        uint256 executionMajorityThreshold
    );
}
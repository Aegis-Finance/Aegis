// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "../interfaces/IPrivateGovernance.sol";

/**
 * @title GovernanceCoreStub
 * @notice Minimal stub that satisfies the subset of GovernanceCore behaviour required by GovernanceTreasury.
 *         It tracks proposal lifecycles, enforces sequential IDs, and allows tests to manipulate state
 *         without invoking the full governance engine.
 */
contract GovernanceCoreStub is IPrivateGovernance {
    uint256 private _nextProposalId = 1;

    struct StoredProposal {
        ProposalState state;
        address[] targets;
        uint256[] values;
        bytes[] calldatas;
    }

    mapping(uint256 => StoredProposal) private _proposals;

    event ProposalCreated(uint256 indexed proposalId, address indexed proposer);
    event ProposalStateSet(uint256 indexed proposalId, ProposalState state);

    modifier validProposal(uint256 proposalId) {
        require(proposalId > 0 && proposalId < _nextProposalId, "governance: invalid proposal id");
        _;
    }

    function createProposal(ProposalParams calldata params) external override returns (uint256 proposalId) {
        proposalId = _nextProposalId++;

        _proposals[proposalId] = StoredProposal({
            state: ProposalState.ACTIVE,
            targets: params.targets,
            values: params.values,
            calldatas: params.calldatas
        });

        emit ProposalCreated(proposalId, msg.sender);
    }

    function setProposalState(uint256 proposalId, ProposalState newState) external validProposal(proposalId) {
        _proposals[proposalId].state = newState;
        emit ProposalStateSet(proposalId, newState);
    }

    function getProposalState(uint256 proposalId) external view validProposal(proposalId) returns (ProposalState) {
        return _proposals[proposalId].state;
    }

    function getProposal(uint256 proposalId)
        external
        view
        validProposal(proposalId)
        returns (
            string memory,
            string memory,
            address[] memory targets,
            uint256[] memory values,
            bytes[] memory calldatas,
            uint256,
            uint256,
            uint256,
            ProposalState state
        )
    {
        StoredProposal storage stored = _proposals[proposalId];
        return ("", "", stored.targets, stored.values, stored.calldatas, 0, 0, 0, stored.state);
    }

    // Unused interface methods kept for compatibility.
    function submitProposal(ProposalParams calldata) external pure override returns (uint256) {
        revert("governance: unsupported");
    }

    function queueProposal(uint256 proposalId) external override validProposal(proposalId) {
        _proposals[proposalId].state = ProposalState.QUEUED;
        emit ProposalStateSet(proposalId, ProposalState.QUEUED);
    }

    function executeProposal(uint256 proposalId) external override validProposal(proposalId) {
        _proposals[proposalId].state = ProposalState.EXECUTED;
        emit ProposalStateSet(proposalId, ProposalState.EXECUTED);
    }

    function cancelProposal(uint256 proposalId) external validProposal(proposalId) {
        _proposals[proposalId].state = ProposalState.CANCELED;
        emit ProposalStateSet(proposalId, ProposalState.CANCELED);
    }

    function activeProposalCount() external view returns (uint256) {
        return _nextProposalId - 1;
    }

    function hasVotingPower(address) external pure override returns (bool) {
        return true;
    }

    function getGovernanceConfig()
        external
        pure
        override
        returns (
            uint256 votingPeriod,
            uint256 executionDelay,
            uint256 proposalThreshold,
            uint256 quorumThreshold,
            uint256 executionMajorityThreshold
        )
    {
        return (2 days, 12 hours, 100_000e18, 1_000_000e18, 500_000e18);
    }
}


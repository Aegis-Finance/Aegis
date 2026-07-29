// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {EcosystemZkBase} from "./libraries/EcosystemZkBase.sol";

/**
 * @title ShieldedGovernanceTally
 * @notice Accumulate private vote commitments; reveal aggregate tallies only after voting ends.
 */
contract ShieldedGovernanceTally is EcosystemZkBase {
    string private constant GOVERNANCE_CIRCUIT = "governance";

    struct ProposalTally {
        uint256 votingEnds;
        bool finalized;
        uint256 forVotes;
        uint256 againstVotes;
        uint256 abstainVotes;
    }

    mapping(uint256 => ProposalTally) public proposals;
    mapping(uint256 => mapping(bytes32 => bool)) public proposalNullifiers;

    event ProposalRegistered(uint256 indexed proposalId, uint256 votingEnds);
    event PrivateVoteRecorded(uint256 indexed proposalId, bytes32 indexed nullifierHash);
    event TallyFinalized(uint256 indexed proposalId, uint256 forVotes, uint256 againstVotes, uint256 abstainVotes);

    error VotingClosed();
    error VotingOpen();
    error AlreadyFinalized();

    constructor(address token_, address verifierFactory_) EcosystemZkBase(token_, verifierFactory_) {}

    function registerProposal(uint256 proposalId, uint256 votingEnds) external onlyGovernance {
        proposals[proposalId] = ProposalTally({
            votingEnds: votingEnds,
            finalized: false,
            forVotes: 0,
            againstVotes: 0,
            abstainVotes: 0
        });
        emit ProposalRegistered(proposalId, votingEnds);
    }

    /**
     * @param publicInputs per `governance.circom`: nullifierHash, merkleRoot, proposalId, voteCommitment, votingPowerCommitment
     * @param voteChoice 0=against, 1=for, 2=abstain (private in circuit; passed for tally aggregation after verify)
     */
    function castPrivateVote(
        uint8 voteChoice,
        uint256 votingPower,
        uint256[8] calldata proof,
        uint256[] calldata publicInputs
    ) external whenNotPaused {
        if (publicInputs.length < 5) revert InvalidPublicInputs();
        uint256 proposalId = publicInputs[2];
        ProposalTally storage t = proposals[proposalId];
        if (block.timestamp >= t.votingEnds) revert VotingClosed();
        bytes32 nullifier = bytes32(publicInputs[0]);
        if (proposalNullifiers[proposalId][nullifier]) revert NullifierAlreadyUsed();

        _requireValidProof(GOVERNANCE_CIRCUIT, proof, publicInputs);
        proposalNullifiers[proposalId][nullifier] = true;

        if (voteChoice == 1) t.forVotes += votingPower;
        else if (voteChoice == 0) t.againstVotes += votingPower;
        else t.abstainVotes += votingPower;

        emit PrivateVoteRecorded(proposalId, nullifier);
    }

    function finalizeTally(uint256 proposalId) external {
        ProposalTally storage t = proposals[proposalId];
        if (block.timestamp < t.votingEnds) revert VotingOpen();
        if (t.finalized) revert AlreadyFinalized();
        t.finalized = true;
        emit TallyFinalized(proposalId, t.forVotes, t.againstVotes, t.abstainVotes);
    }
}

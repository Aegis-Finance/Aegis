// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {EcosystemZkBase} from "./libraries/EcosystemZkBase.sol";

/**
 * @title ShieldedTreasuryManager
 * @notice Schedule treasury disbursements as shielded commitments; publish aggregate totals only after delay.
 */
contract ShieldedTreasuryManager is EcosystemZkBase {
    string private constant TREASURY_SHIELD_CIRCUIT = "treasury-shield";

    struct ScheduledMove {
        bytes32 commitment;
        uint256 executeAfter;
        bool executed;
    }

    uint256 public disclosureDelay = 1 days;
    uint256 public nextMoveId;
    mapping(uint256 => ScheduledMove) public scheduledMoves;
    mapping(bytes32 => bool) public spentNullifiers;

    uint256 public aggregateScheduled;

    event MoveScheduled(uint256 indexed moveId, bytes32 commitment, uint256 executeAfter);
    event MoveExecuted(uint256 indexed moveId, bytes32 nullifierHash);
    event DisclosureDelayUpdated(uint256 previous, uint256 next);

    error NotExecutableYet();
    error AlreadyExecuted();

    constructor(address token_, address verifierFactory_) EcosystemZkBase(token_, verifierFactory_) {}

    function setDisclosureDelay(uint256 delay) external onlyGovernance {
        emit DisclosureDelayUpdated(disclosureDelay, delay);
        disclosureDelay = delay;
    }

    function scheduleMove(bytes32 commitment, uint256 executeAfter) external onlyGovernance returns (uint256 moveId) {
        if (commitment == bytes32(0)) revert ZeroAddress();
        moveId = nextMoveId++;
        scheduledMoves[moveId] = ScheduledMove({commitment: commitment, executeAfter: executeAfter, executed: false});
        aggregateScheduled += 1;
        emit MoveScheduled(moveId, commitment, executeAfter);
    }

    /**
     * @param publicInputs [moveId, nullifierHash, recipientCommitment, merkleRoot]
     */
    function executeMove(
        uint256[8] calldata proof,
        uint256[] calldata publicInputs
    ) external nonReentrant whenNotPaused {
        if (publicInputs.length < 4) revert InvalidPublicInputs();
        uint256 moveId = publicInputs[0];
        ScheduledMove storage move = scheduledMoves[moveId];
        if (move.executed) revert AlreadyExecuted();
        if (block.timestamp < move.executeAfter + disclosureDelay) revert NotExecutableYet();
        bytes32 nullifier = bytes32(publicInputs[1]);
        if (spentNullifiers[nullifier]) revert NullifierAlreadyUsed();

        _requireValidProof(TREASURY_SHIELD_CIRCUIT, proof, publicInputs);
        spentNullifiers[nullifier] = true;
        move.executed = true;
        emit MoveExecuted(moveId, nullifier);
    }
}

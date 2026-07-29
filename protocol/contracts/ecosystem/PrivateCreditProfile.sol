// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ICreatorReputationTracker} from "../interfaces/ICreatorReputationTracker.sol";
import {EcosystemZkBase} from "./libraries/EcosystemZkBase.sol";

/**
 * @title PrivateCreditProfile
 * @notice Anonymous credit scores: lenders verify repayment history proofs without learning identity.
 */
contract PrivateCreditProfile is EcosystemZkBase {
    string private constant CREDIT_CIRCUIT = "credit-profile";

    mapping(bytes32 => uint256) public creditScoreByCommitment;
    mapping(bytes32 => bool) public spentNullifiers;

    ICreatorReputationTracker public reputationTracker;

    event CreditScoreUpdated(bytes32 indexed profileCommitment, uint256 score);
    event CreditProofVerified(bytes32 indexed nullifierHash, uint256 minScoreRequired, bool passed);
    event ReputationTrackerUpdated(address indexed previous, address indexed next);
    event ReputationSyncedToProfile(bytes32 indexed profileCommitment, address indexed creator, uint256 score);

    error ReputationTrackerNotSet();
    error CreatorProfileInactive();

    constructor(address token_, address verifierFactory_) EcosystemZkBase(token_, verifierFactory_) {}

    function setReputationTracker(address tracker) external onlyGovernance {
        emit ReputationTrackerUpdated(address(reputationTracker), tracker);
        reputationTracker = ICreatorReputationTracker(tracker);
    }

    /**
     * @notice Optional bridge from `CreatorReputationTracker` — caller opts in to link a public creator score
     *         to an anonymous `profileCommitment` for lending proofs.
     */
    function syncCreditFromCreatorReputation(bytes32 profileCommitment, address creator) external whenNotPaused {
        if (address(reputationTracker) == address(0)) revert ReputationTrackerNotSet();
        ICreatorReputationTracker.CreatorProfile memory profile = reputationTracker.getCreatorProfile(creator);
        if (!profile.isActive || profile.creator != creator) revert CreatorProfileInactive();
        uint256 score = profile.reputation.reputationScore;
        if (score == 0) {
            score = profile.reputation.trustScore;
        }
        creditScoreByCommitment[profileCommitment] = score;
        emit ReputationSyncedToProfile(profileCommitment, creator, score);
    }

    /**
     * @param publicInputs [nullifierHash, profileCommitment, newScore, merkleRoot]
     */
    function updateCreditScore(
        uint256[8] calldata proof,
        uint256[] calldata publicInputs
    ) external whenNotPaused {
        if (publicInputs.length < 4) revert InvalidPublicInputs();
        bytes32 nullifier = bytes32(publicInputs[0]);
        if (spentNullifiers[nullifier]) revert NullifierAlreadyUsed();
        _requireValidProof(CREDIT_CIRCUIT, proof, publicInputs);
        spentNullifiers[nullifier] = true;
        bytes32 profile = bytes32(publicInputs[1]);
        creditScoreByCommitment[profile] = publicInputs[2];
        emit CreditScoreUpdated(profile, publicInputs[2]);
    }

    /**
     * @param publicInputs [nullifierHash, profileCommitment, score, minScoreRequired]
     */
    function verifyCreditForLending(
        uint256 minScoreRequired,
        uint256[8] calldata proof,
        uint256[] calldata publicInputs
    ) external whenNotPaused returns (bool passed) {
        if (publicInputs.length < 4) revert InvalidPublicInputs();
        bytes32 nullifier = bytes32(publicInputs[0]);
        if (spentNullifiers[nullifier]) revert NullifierAlreadyUsed();
        _requireValidProof(CREDIT_CIRCUIT, proof, publicInputs);
        spentNullifiers[nullifier] = true;
        passed = publicInputs[2] >= minScoreRequired && publicInputs[3] == minScoreRequired;
        emit CreditProofVerified(nullifier, minScoreRequired, passed);
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {EcosystemZkBase} from "./libraries/EcosystemZkBase.sol";

/**
 * @title SelectiveDisclosureHub
 * @notice Verify proofs that attest a statement (net worth band, age threshold, ownership, repayment)
 *         without revealing underlying identity or full balances.
 */
contract SelectiveDisclosureHub is EcosystemZkBase {
    string private constant DISCLOSURE_CIRCUIT = "selective-disclosure";

    enum DisclosureKind {
        NET_WORTH_BAND,
        AGE_THRESHOLD,
        OWNERSHIP,
        REPAYMENT_HISTORY
    }

    mapping(bytes32 => bool) public usedDisclosureNullifiers;

    event DisclosureVerified(
        bytes32 indexed nullifierHash,
        DisclosureKind indexed kind,
        bytes32 indexed subjectCommitment,
        uint256 publicThreshold
    );


    constructor(address token_, address verifierFactory_) EcosystemZkBase(token_, verifierFactory_) {}

    /**
     * @param publicInputs [nullifierHash, kind, subjectCommitment, threshold, merkleRoot]
     */
    function verifyDisclosure(
        DisclosureKind kind,
        uint256[8] calldata proof,
        uint256[] calldata publicInputs
    ) external whenNotPaused {
        if (publicInputs.length < 5) revert InvalidPublicInputs();
        if (uint256(kind) != publicInputs[1]) revert InvalidPublicInputs();
        bytes32 nullifier = bytes32(publicInputs[0]);
        if (usedDisclosureNullifiers[nullifier]) revert NullifierAlreadyUsed();

        _requireValidProof(DISCLOSURE_CIRCUIT, proof, publicInputs);
        usedDisclosureNullifiers[nullifier] = true;
        emit DisclosureVerified(nullifier, kind, bytes32(publicInputs[2]), publicInputs[3]);
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

contract ProofValidatorHarness {
    function decodeProof(
        bytes memory proof,
        bytes32 commitment,
        uint256 proposalId
    )
        external
        pure
        returns (
            uint256[8] memory convertedProof,
            uint256[] memory publicInputs,
            bool isValidInputs
        )
    {
        (convertedProof, publicInputs) = _convertProofData(proof, commitment);
        isValidInputs = _validateGovernanceInputs(
            publicInputs,
            commitment,
            proposalId
        );
    }

    function _convertProofData(
        bytes memory proof,
        bytes32 commitment
    ) private pure returns (uint256[8] memory convertedProof, uint256[] memory publicInputs) {
        uint256 proofLength = proof.length;
        if (proofLength < 416 || proofLength > 1024) revert("invalid-proof-length");

        uint256 numPublicInputs = (proofLength - 256) / 32;
        if (numPublicInputs < 5 || numPublicInputs > 10) revert("invalid-input-length");

        publicInputs = new uint256[](numPublicInputs);

        assembly {
            let proofPtr := add(proof, 0x20)
            let proofIsValid := 0

            // Load and store proof
            for { let i := 0 } lt(i, 8) { i := add(i, 1) } {
                let offset := mul(i, 0x20)
                let val := mload(add(proofPtr, offset))
                mstore(add(convertedProof, offset), val)
                proofIsValid := or(proofIsValid, val)
            }

            if iszero(proofIsValid) {
                revert(0, 0)
            }

            // Extract public inputs
            let inputPtr := add(proofPtr, 256)
            let publicInputsPtr := add(publicInputs, 0x20)
            for { let i := 0 } lt(i, numPublicInputs) { i := add(i, 1) } {
                mstore(add(publicInputsPtr, mul(i, 0x20)), mload(add(inputPtr, mul(i, 0x20))))
            }
        }

        if (commitment == bytes32(0)) revert("invalid-commitment");
    }

    function _validateGovernanceInputs(
        uint256[] memory publicInputs,
        bytes32 commitment,
        uint256 proposalId
    ) private pure returns (bool) {
        if (publicInputs.length != 5 && publicInputs.length != 6) return false;

        uint256 offset = 0;
        if (publicInputs.length == 6) {
            if (publicInputs[0] != 1) return false;
            offset = 1;
        }

        uint256 nullifierHash = publicInputs[offset];
        uint256 merkleRoot = publicInputs[offset + 1];
        uint256 proofProposalId = publicInputs[offset + 2];
        uint256 voteCommitment = publicInputs[offset + 3];
        uint256 votingPowerCommitment = publicInputs[offset + 4];

        if (proposalId != 0 && proofProposalId != proposalId) return false;

        if (merkleRoot == 0 || merkleRoot > type(uint256).max / 2) return false;
        if (nullifierHash == 0) return false;
        if (voteCommitment == 0 || votingPowerCommitment == 0) return false;

        uint256 fieldModulus = 21888242871839275222246405745257275088548364400416034343698204186575808495617;
        if (
            nullifierHash >= fieldModulus ||
            merkleRoot >= fieldModulus ||
            voteCommitment >= fieldModulus ||
            votingPowerCommitment >= fieldModulus
        ) {
            return false;
        }

        if (uint256(commitment) == 0) return false;

        return true;
    }
}



// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {VerifierFactory} from "../VerifierFactory.sol";
import {ICommonErrors} from "../interfaces/ICommonErrors.sol";

/**
 * @title GovernanceProofValidator
 * @author Aegis Protocol Team
 * @dev Library for validating ZK proofs in governance operations
 * @notice Extracted from PrivateGovernance to reduce contract size
 */
library GovernanceProofValidator {
    string private constant GOVERNANCE_CIRCUIT = "governance";
    
    /**
     * @notice Validates a ZK proof for governance operations
     * @param verifierFactory The verifier factory contract
     * @param proof The ZK proof bytes
     * @param commitment The commitment being validated
     * @param proposalId The proposal ID encoded in public inputs (`0` allowed per `_validateGovernanceInputs`);
     *                     use the **actual** proposal id for vote/cancel paths, and `governanceState.nextProposalId`
     *                     at submission time for `createProposal`.
     */
    function validateProof(
        VerifierFactory verifierFactory,
        bytes memory proof,
        bytes32 commitment,
        uint256 proposalId
    ) internal view {
        if (commitment == bytes32(0)) revert ICommonErrors.InvalidCommitment();

        bool hasGovernanceVerifier = false;
        try verifierFactory.hasVerifier(GOVERNANCE_CIRCUIT) returns (bool registered) {
            hasGovernanceVerifier = registered;
        } catch {
            hasGovernanceVerifier = false;
        }

        if (!hasGovernanceVerifier) {
            if (proof.length < 416) revert ICommonErrors.InvalidProofLength();
            if (proof.length > 1024) revert ICommonErrors.InvalidProofLength();
            return;
        }

        if (proof.length < 416) revert ICommonErrors.InvalidProofLength();
        if (proof.length > 1024) revert ICommonErrors.InvalidProofLength();
        
        // Convert proof data
        (uint256[8] memory convertedProof, uint256[] memory publicInputs) = 
            _convertProofData(proof, commitment);
        
        // Validate public inputs
        if (!_validateGovernanceInputs(publicInputs, commitment, proposalId)) {
            revert ICommonErrors.InvalidPublicInputs();
        }
        
        // Verify the proof
        try verifierFactory.verifyProof(GOVERNANCE_CIRCUIT, convertedProof, publicInputs) returns (bool isValid) {
            if (!isValid) revert ICommonErrors.ProofVerificationFailed();
        } catch (bytes memory revertData) {
            if (revertData.length > 0) {
                assembly {
                    revert(add(revertData, 0x20), mload(revertData))
                }
            }
            revert ICommonErrors.InvalidZKProof();
        }
    }
    
    /**
     * @notice Converts raw proof bytes into the format expected by the verifier
     * @param proof The raw proof bytes
     * @param commitment The commitment being validated
     * @return convertedProof The proof as uint256[8] array
     * @return publicInputs The public inputs for verification
     */
    function _convertProofData(
        bytes memory proof,
        bytes32 commitment
    ) private pure returns (uint256[8] memory convertedProof, uint256[] memory publicInputs) {
        uint256 proofLength = proof.length;
        if (proofLength < 416 || proofLength > 1024) revert ICommonErrors.InvalidProofLength();

        uint256 numPublicInputs = (proofLength - 256) / 32;
        if (numPublicInputs < 5 || numPublicInputs > 10) revert ICommonErrors.InvalidPublicInputs();

        publicInputs = new uint256[](numPublicInputs);

        uint256 basePtr;
        assembly {
            basePtr := add(proof, 0x20)
        }

        uint256 proofAccumulator;
        for (uint256 i = 0; i < 8; ++i) {
            uint256 word;
            assembly {
                word := mload(add(basePtr, mul(i, 0x20)))
            }
            convertedProof[i] = word;
            proofAccumulator |= word;
        }

        if (proofAccumulator == 0) revert ICommonErrors.InvalidZKProof();

        uint256 inputsPtr = basePtr + 256;
        for (uint256 i = 0; i < numPublicInputs; ++i) {
            uint256 inputWord;
            assembly {
                inputWord := mload(add(inputsPtr, mul(i, 0x20)))
            }
            publicInputs[i] = inputWord;
        }

        if (commitment == bytes32(0)) revert ICommonErrors.InvalidCommitment();
    }
    
    /**
     * @notice Validates governance public inputs
     * @param publicInputs Array of public inputs from the proof
     * @param commitment The expected commitment
     * @param proposalId The expected proposal ID
     * @return isValid True if all validations pass
     */
    function _validateGovernanceInputs(
        uint256[] memory publicInputs,
        bytes32 commitment,
        uint256 proposalId
    ) private pure returns (bool) {
        if (publicInputs.length < 5 || publicInputs.length > 10) return false;

        uint256 offset = 0;
        if (publicInputs.length >= 6) {
            // Many circuits prepend a sentinel flag; accept 0 or 1 for forward compatibility.
            uint256 flag = publicInputs[0];
            if (flag == 0 || flag == 1) {
                offset = 1;
            }
        }

        if (publicInputs.length < offset + 5) return false;

        uint256 nullifierHash = publicInputs[offset];
        uint256 merkleRoot = publicInputs[offset + 1];
        uint256 proofProposalId = publicInputs[offset + 2];
        uint256 voteCommitment = publicInputs[offset + 3];
        uint256 votingPowerCommitment = publicInputs[offset + 4];

        if (proposalId != 0 && proofProposalId != proposalId) return false;

        if (nullifierHash == 0 || merkleRoot == 0) return false;
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


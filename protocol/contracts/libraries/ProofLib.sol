// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "./../libraries/ErrorLibrary.sol";

import {IVerifier} from "../interfaces/IVerifier.sol";

/**
 * @title ProofLib
 * @author Aegis Protocol Team
 * @notice Library for handling zero-knowledge proof operations with optimized error handling
 * @dev Library for handling zero-knowledge proof operations
 * Provides utilities for proof validation and management
 */
library ProofLib {
    /**
     * @dev Structure representing a ZK proof
     * @param proof The proof data
     * @param publicInputs The public inputs for verification
     * @param verifier The verifier contract address
     */
    struct ZKProof {
        uint256[8] proof;
        uint256[] publicInputs;
        address verifier;
    }

    /**
     * @notice Verifies a zero-knowledge proof with optimized error handling
     * @dev Verifies a zero-knowledge proof
     * @param zkProof The proof structure to verify
     * @return True if the proof is valid
     */
    function verifyProof(ZKProof memory zkProof) public view returns (bool) {
        if (zkProof.verifier == address(0)) {
            revert ErrorLibrary.InvalidVerifier();
        }
        
        try IVerifier(zkProof.verifier).verifyProof(
            zkProof.proof,
            zkProof.publicInputs
        ) returns (bool isValid) {
            return isValid;
        } catch {
            return false;
        }
    }
    
    /**
     * @notice Validates and verifies a proof, reverting on failure with optimized error handling
     * @dev Validates and verifies a proof, reverting on failure
     * @param zkProof The proof structure to validate
     */
    function requireValidProof(ZKProof memory zkProof) public view {
        if (!verifyProof(zkProof)) {
            revert ErrorLibrary.InvalidProof();
        }
    }
    
    /**
     * @notice Internal function to validate array bounds
     * @dev Internal function to validate array bounds
     * @param publicInputs The public inputs array
     * @param index The index to validate
     */
    function _validateBounds(
        uint256[] memory publicInputs,
        uint256 index
    ) private pure {
        if (index >= publicInputs.length) revert ErrorLibrary.IndexOutOfBounds();
    }
    
    /**
     * @notice Extracts commitment from public inputs with optimized bounds checking
     * @dev Extracts commitment from public inputs
     * @param publicInputs The public inputs array
     * @param index The index of the commitment in the array
     * @return The commitment value
     */
    function extractCommitment(
        uint256[] memory publicInputs,
        uint256 index
    ) public pure returns (bytes32) {
        _validateBounds(publicInputs, index);
        return bytes32(publicInputs[index]);
    }
    
    /// @notice Extracts nullifier from public inputs with optimized bounds checking
    /// @param publicInputs The public inputs array
    /// @param index The index of the nullifier in the array
    /// @return The nullifier value
    function extractNullifier(
        uint256[] memory publicInputs,
        uint256 index
    ) public pure returns (bytes32) {
        _validateBounds(publicInputs, index);
        return bytes32(publicInputs[index]);
    }
    
    /// @notice Extracts amount from public inputs with optimized bounds checking
    /// @param publicInputs The public inputs array
    /// @param index The index of the amount in the array
    /// @return The amount value
    function extractAmount(
        uint256[] memory publicInputs,
        uint256 index
    ) public pure returns (uint256) {
        _validateBounds(publicInputs, index);
        return publicInputs[index];
    }
    
    /// @notice Validates that public inputs have the expected length with optimized error handling
    /// @param publicInputs The public inputs array
    /// @param expectedLength The expected length
    function requireValidInputLength(
        uint256[] memory publicInputs,
        uint256 expectedLength
    ) public pure {
        if (publicInputs.length != expectedLength) revert ErrorLibrary.InvalidInputLength();
    }
}

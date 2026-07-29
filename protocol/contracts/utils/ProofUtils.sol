// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ICommonErrors} from "../interfaces/ICommonErrors.sol";

/**
 * @title ProofUtils
 * @dev Optimized and secure utility library for ZK proof conversions
 * @notice This library provides gas-optimized assembly functions for proof handling
 */
library ProofUtils {
    /// @dev Error thrown when commitment is zero

    /// @dev Minimum required proof length (8 * 32 bytes = 256 bytes)
    uint256 private constant MIN_PROOF_LENGTH = 256;
    
    /**
     * @dev Converts bytes proof to uint256[8] array with optimized assembly
     * @param proof The proof bytes to convert
     * @param commitment The commitment bytes32 value
     * @return convertedProof The converted proof as uint256[8]
     * @return publicInputs The public inputs array containing the commitment
     */
    function convertProofWithCommitment(
        bytes calldata proof,
        bytes32 commitment
    ) internal pure returns (uint256[8] memory convertedProof, uint256[] memory publicInputs) {
        // Input validation
        if (proof.length < MIN_PROOF_LENGTH) revert ICommonErrors.InvalidProofLength();
        if (commitment == bytes32(0)) revert ICommonErrors.InvalidCommitment();
        
        // Convert bytes proof to uint256[8] using optimized assembly
        // solhint-disable-next-line no-inline-assembly
        assembly ("memory-safe") {
            let proofData := proof.offset
            
            // Load proof data directly from calldata
            mstore(convertedProof, calldataload(proofData))
            mstore(add(convertedProof, 0x20), calldataload(add(proofData, 0x20)))
            mstore(add(convertedProof, 0x40), calldataload(add(proofData, 0x40)))
            mstore(add(convertedProof, 0x60), calldataload(add(proofData, 0x60)))
            mstore(add(convertedProof, 0x80), calldataload(add(proofData, 0x80)))
            mstore(add(convertedProof, 0xa0), calldataload(add(proofData, 0xa0)))
            mstore(add(convertedProof, 0xc0), calldataload(add(proofData, 0xc0)))
            mstore(add(convertedProof, 0xe0), calldataload(add(proofData, 0xe0)))
        }
        
        // Convert commitment to public inputs array
        publicInputs = new uint256[](1);
        publicInputs[0] = uint256(commitment);
    }
    
    /**
     * @dev Converts bytes proof to uint256[8] array (without commitment)
     * @param proof The proof bytes to convert
     * @return convertedProof The converted proof as uint256[8]
     */
    function convertProof(
        bytes calldata proof
    ) internal pure returns (uint256[8] memory convertedProof) {
        // Input validation
        if (proof.length < MIN_PROOF_LENGTH) revert ICommonErrors.InvalidProofLength();
        
        // Convert bytes proof to uint256[8] using optimized assembly
        // solhint-disable-next-line no-inline-assembly
        assembly ("memory-safe") {
            let proofData := proof.offset
            
            // Load proof data directly from calldata (more gas efficient)
            mstore(convertedProof, calldataload(proofData))
            mstore(add(convertedProof, 0x20), calldataload(add(proofData, 0x20)))
            mstore(add(convertedProof, 0x40), calldataload(add(proofData, 0x40)))
            mstore(add(convertedProof, 0x60), calldataload(add(proofData, 0x60)))
            mstore(add(convertedProof, 0x80), calldataload(add(proofData, 0x80)))
            mstore(add(convertedProof, 0xa0), calldataload(add(proofData, 0xa0)))
            mstore(add(convertedProof, 0xc0), calldataload(add(proofData, 0xc0)))
            mstore(add(convertedProof, 0xe0), calldataload(add(proofData, 0xe0)))
        }
    }
    
    /**
     * @dev Converts memory bytes proof to uint256[8] array (for memory data)
     * @param proof The proof bytes in memory to convert
     * @return convertedProof The converted proof as uint256[8]
     */
    function convertProofFromMemory(
        bytes memory proof
    ) internal pure returns (uint256[8] memory convertedProof) {
        // Input validation
        if (proof.length < MIN_PROOF_LENGTH) revert ICommonErrors.InvalidProofLength();
        
        // Convert bytes proof to uint256[8] using optimized assembly
        // solhint-disable-next-line no-inline-assembly
        assembly ("memory-safe") {
            let proofPtr := add(proof, 0x20)
            
            // Load proof data from memory
            mstore(convertedProof, mload(proofPtr))
            mstore(add(convertedProof, 0x20), mload(add(proofPtr, 0x20)))
            mstore(add(convertedProof, 0x40), mload(add(proofPtr, 0x40)))
            mstore(add(convertedProof, 0x60), mload(add(proofPtr, 0x60)))
            mstore(add(convertedProof, 0x80), mload(add(proofPtr, 0x80)))
            mstore(add(convertedProof, 0xa0), mload(add(proofPtr, 0xa0)))
            mstore(add(convertedProof, 0xc0), mload(add(proofPtr, 0xc0)))
            mstore(add(convertedProof, 0xe0), mload(add(proofPtr, 0xe0)))
        }
    }
    
    /**
     * @dev Validates proof length and basic structure
     * @param proof The proof bytes to validate
     * @return isValid Whether the proof has valid structure
     */
    function validateProofStructure(bytes calldata proof) internal pure returns (bool isValid) {
        return proof.length >= MIN_PROOF_LENGTH && proof.length % 32 == 0;
    }
    
    /**
     * @dev Creates public inputs array from multiple commitments
     * @param commitments Array of commitment values
     * @return publicInputs The public inputs array
     */
    function createPublicInputs(
        bytes32[] memory commitments
    ) internal pure returns (uint256[] memory publicInputs) {
        uint256 length = commitments.length;
        publicInputs = new uint256[](length);
        
        // solhint-disable-next-line no-inline-assembly
        assembly ("memory-safe") {
            let commitmentsPtr := add(commitments, 0x20)
            let publicInputsPtr := add(publicInputs, 0x20)
            
            for { let i := 0 } lt(i, length) { i := add(i, 1) } {
                let commitment := mload(add(commitmentsPtr, mul(i, 0x20)))
                mstore(add(publicInputsPtr, mul(i, 0x20)), commitment)
            }
        }
    }
}
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/**
 * @title CommitmentLib
 * @author Aegis Protocol Team
 * @notice Library for handling cryptographic commitments in the privacy system
 * @dev Library for handling cryptographic commitments in the privacy system
 * Provides utilities for creating, verifying, and managing commitments
 */
library CommitmentLib {
    /**
     * @dev Structure representing a commitment
     * @param commitment The commitment value (hash)
     * @param nullifier The nullifier to prevent double-spending
     * @param timestamp When the commitment was created
     */
    struct Commitment {
        bytes32 commitment;
        bytes32 nullifier;
        uint256 timestamp;
    }
    
    /**
     * @notice Creates a commitment hash from value and randomness
     * @dev Creates a commitment hash from value and randomness
     * @param value The value to commit to
     * @param randomness The random value for hiding
     * @return The commitment hash
     */
    function createCommitment(
        uint256 value,
        uint256 randomness
    ) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(value, randomness));
    }
    
    /**
     * @notice Creates a nullifier from commitment and secret
     * @dev Creates a nullifier from commitment and secret
     * @param commitment The commitment value
     * @param secret The secret value
     * @return The nullifier hash
     */
    function createNullifier(
        bytes32 commitment,
        uint256 secret
    ) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(commitment, secret));
    }
    
    /**
     * @notice Verifies that a commitment is properly formed
     * @dev Verifies that a commitment is properly formed
     * @param commitment The commitment to verify
     * @param value The claimed value
     * @param randomness The claimed randomness
     * @return True if the commitment is valid
     */
    function verifyCommitment(
        bytes32 commitment,
        uint256 value,
        uint256 randomness
    ) public pure returns (bool) {
        return commitment == createCommitment(value, randomness);
    }
    
    /**
     * @notice Combines multiple commitments into a single commitment
     * @dev Combines multiple commitments into a single commitment
     * @param commitments Array of commitments to combine
     * @return The combined commitment
     */
    function combineCommitments(
        bytes32[] memory commitments
    ) public pure returns (bytes32) {
        bytes32 combined = bytes32(0);
        for (uint256 i = 0; i < commitments.length; ++i) {
            combined = keccak256(abi.encodePacked(combined, commitments[i]));
        }
        return combined;
    }
    
    /**
     * @notice Validates that a nullifier hasn't been used before
     * @dev Validates that a nullifier hasn't been used before
     * @param usedNullifiers Mapping of used nullifiers
     * @param nullifier The nullifier to check
     * @return True if the nullifier is unused
     */
    function isNullifierUnused(
        mapping(bytes32 => bool) storage usedNullifiers,
        bytes32 nullifier
    ) public view returns (bool) {
        return !usedNullifiers[nullifier];
    }
    
    /**
     * @notice Marks a nullifier as used to prevent double-spending
     * @dev Marks a nullifier as used
     * @param usedNullifiers Mapping of used nullifiers
     * @param nullifier The nullifier to mark as used
     */
    function markNullifierUsed(
        mapping(bytes32 => bool) storage usedNullifiers,
        bytes32 nullifier
    ) public {
        usedNullifiers[nullifier] = true;
    }
}

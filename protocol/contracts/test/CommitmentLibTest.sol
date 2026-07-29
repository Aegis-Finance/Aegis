// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {CommitmentLib} from "../libraries/CommitmentLib.sol";

/**
 * @title CommitmentLibTest
 * @dev Test contract to expose CommitmentLib functions for testing
 */
contract CommitmentLibTest {
    using CommitmentLib for mapping(bytes32 => bool);
    
    // Storage for nullifier tracking
    mapping(bytes32 => bool) private usedNullifiers;

    /**
     * @dev Test function for createCommitment
     */
    function testCreateCommitment(
        uint256 value,
        uint256 randomness
    ) external pure returns (bytes32) {
        return CommitmentLib.createCommitment(value, randomness);
    }

    /**
     * @dev Test function for createNullifier
     */
    function testCreateNullifier(
        bytes32 commitment,
        uint256 secret
    ) external pure returns (bytes32) {
        return CommitmentLib.createNullifier(commitment, secret);
    }

    /**
     * @dev Test function for verifyCommitment
     */
    function testVerifyCommitment(
        bytes32 commitment,
        uint256 value,
        uint256 randomness
    ) external pure returns (bool) {
        return CommitmentLib.verifyCommitment(commitment, value, randomness);
    }

    /**
     * @dev Test function for combineCommitments
     */
    function testCombineCommitments(
        bytes32[] memory commitments
    ) external pure returns (bytes32) {
        return CommitmentLib.combineCommitments(commitments);
    }

    /**
     * @dev Test function for isNullifierUnused
     */
    function testIsNullifierUnused(bytes32 nullifier) external view returns (bool) {
        return usedNullifiers.isNullifierUnused(nullifier);
    }

    /**
     * @dev Test function for markNullifierUsed
     */
    function testMarkNullifierUsed(bytes32 nullifier) external {
        usedNullifiers.markNullifierUsed(nullifier);
    }
}
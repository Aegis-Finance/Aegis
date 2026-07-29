// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "./../interfaces/ICommonErrors.sol";

/**
 * @title IFactoryVerifierWrapper
 * @dev Abstract interface for factory-based verifier wrappers
 * @notice Defines the standard interface for verifier wrappers that use VerifierFactory
 * @author Aegis Protocol Team
 * @custom:security-contact security@aegisprotocol.com
 */
abstract contract IFactoryVerifierWrapper is ICommonErrors {
    
    /// @dev Custom errors for better gas efficiency and debugging

    /// @dev Events for better transparency and monitoring
    event VerifierUpdated(address indexed oldVerifier, address indexed newVerifier);
    event ProofVerified(address indexed verifier, bool result);
    
    /**
     * @dev Verify a ZK proof using the factory-managed verifier
     * @param a First component of the proof
     * @param b Second component of the proof  
     * @param c Third component of the proof
     * @param input Public inputs to the circuit
     * @return success True if the proof is valid
     * @custom:throws VerifierNotAvailable When verifier is not deployed
     * @custom:throws VerificationFailed When proof verification fails
     * @custom:throws InvalidProofFormat When proof format is invalid
     */
    function verifyProof(
        uint256[2] calldata a,
        uint256[2][2] calldata b,
        uint256[2] calldata c,
        uint256[] calldata input
    ) external view virtual returns (bool success);
    
    /**
     * @dev Get the current verifier address from factory
     * @return verifierAddress Address of the current verifier for this circuit type
     * @custom:throws VerifierNotFound When no verifier is deployed for this circuit type
     */
    function getVerifierAddress() public view virtual returns (address verifierAddress);
    
    /**
     * @dev Check if verifier is available and valid
     * @return available True if verifier is available
     */
    function isVerifierAvailable() external view virtual returns (bool available);
    
    /**
     * @dev Get comprehensive verifier information
     * @return circuitType The circuit type this wrapper handles
     * @return verifierAddress Current verifier address
     * @return isAvailable Whether the verifier is currently available
     */
    function getVerifierInfo() external view virtual returns (
        string memory circuitType,
        address verifierAddress,
        bool isAvailable
    );
    
    /**
     * @dev Get the circuit type this wrapper handles
     * @return circuitType The circuit type string
     */
    function getCircuitType() external view virtual returns (string memory circuitType);
    
    /**
     * @dev Get the factory address
     * @return factoryAddress The VerifierFactory contract address
     */
    function getFactoryAddress() external view virtual returns (address factoryAddress);
}
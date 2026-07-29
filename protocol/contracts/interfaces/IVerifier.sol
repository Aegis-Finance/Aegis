// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/**
 * @title IVerifier
 * @dev Interface for ZK proof verifiers with trusted setup ceremony validation
 * @notice Standard interface for verifying zero-knowledge proofs using Groth16 format
 */
interface IVerifier {
    /**
     * @notice Verifies a Groth16 zero-knowledge proof (detailed format)
     * @param _pA Proof element A (G1 point)
     * @param _pB Proof element B (G2 point) 
     * @param _pC Proof element C (G1 point)
     * @param _pubSignals The public signals/inputs for the proof
     * @return True if the proof is valid, false otherwise
     */
    function verifyProof(
        uint256[2] calldata _pA,
        uint256[2][2] calldata _pB,
        uint256[2] calldata _pC,
        uint256[] calldata _pubSignals
    ) external view returns (bool);

    /**
     * @notice Verifies a Groth16 zero-knowledge proof (compact format)
     * @param proof Proof data in compact format [pA.x, pA.y, pB.x[0], pB.x[1], pB.y[0], pB.y[1], pC.x, pC.y]
     * @param publicInputs The public signals/inputs for the proof
     * @return True if the proof is valid, false otherwise
     */
    function verifyProof(
        uint256[8] calldata proof,
        uint256[] calldata publicInputs
    ) external view returns (bool);

    /**
     * @notice Returns the verification key hash for this verifier
     * @return The hash of the verification key
     */
    function getVerificationKeyHash() external view returns (bytes32);
    
    /**
     * @notice Checks if this verifier uses a production ceremony key
     * @return True if production ceremony, false if development
     */
    function isProductionKey() external view returns (bool);
    
    /**
     * @notice Gets the ceremony ID for this verifier
     * @return The ceremony identifier
     */
    function getCeremonyId() external view returns (bytes32);
    
    /**
     * @notice Validates that this verifier is safe for production use
     * @dev Should revert if using development keys in production context
     */
    function validateProductionSafety() external view;
}
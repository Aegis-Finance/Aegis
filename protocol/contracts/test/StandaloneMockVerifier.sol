// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "./../interfaces/ICommonErrors.sol";

import {IVerifier} from "../interfaces/IVerifier.sol";

/**
 * @title StandaloneMockVerifier
 * @dev Mock implementation of IVerifier for testing purposes
 * @notice This contract provides a mock verifier that can be configured to return specific results
 */
contract StandaloneMockVerifier is IVerifier , ICommonErrors{
    /// @dev Mock verification key hash
    bytes32 private constant MOCK_VK_HASH = keccak256("mock_verification_key");
    
    /// @dev Mock ceremony ID
    bytes32 private constant MOCK_CEREMONY_ID = keccak256("mock_ceremony");
    
    /// @dev Configurable verification result
    bool private verificationResult = true;
    
    /// @dev Whether this is a production key (false for testing)
    bool private isProduction = false;
    
    /// @dev Owner for configuration
    address private owner;
    
    /// @dev Events
    event VerificationResultChanged(bool newResult);
    event ProductionStatusChanged(bool isProduction);
    
    /// @dev Errors

    modifier onlyOwner() {
        if (msg.sender != owner) revert OnlyOwner();
        _;
    }
    
    constructor() {
        owner = msg.sender;
    }
    
    /**
     * @notice Verifies a Groth16 zero-knowledge proof (detailed format)     * @return True if the proof is valid, false otherwise
     */
    function verifyProof(
        uint256[2] calldata /* _pA */,
        uint256[2][2] calldata /* _pB */,
        uint256[2] calldata /* _pC */,
        uint256[] calldata /* _pubSignals */
    ) external view override returns (bool) {
        // Mock verification - just return the configured result
        // In a real implementation, this would perform cryptographic verification
        return verificationResult;
    }

    /**
     * @notice Verifies a Groth16 zero-knowledge proof (compact format)     * @return True if the proof is valid, false otherwise
     */
    function verifyProof(
        uint256[8] calldata /* proof */,
        uint256[] calldata /* publicInputs */
    ) external view override returns (bool) {
        // Mock verification - just return the configured result
        return verificationResult;
    }

    /**
     * @notice Returns the verification key hash for this verifier
     * @return The hash of the verification key
     */
    function getVerificationKeyHash() external pure override returns (bytes32) {
        return MOCK_VK_HASH;
    }
    
    /**
     * @notice Checks if this verifier uses a production ceremony key
     * @return True if production ceremony, false if development
     */
    function isProductionKey() external view override returns (bool) {
        return isProduction;
    }
    
    /**
     * @notice Gets the ceremony ID for this verifier
     * @return The ceremony identifier
     */
    function getCeremonyId() external pure override returns (bytes32) {
        return MOCK_CEREMONY_ID;
    }
    
    /**
     * @notice Validates that this verifier is safe for production use
     * @dev Should revert if using development keys in production context
     */
    function validateProductionSafety() external view override {
        if (isProduction) {
            revert ProductionKeyViolation();
        }
    }
    
    // Configuration functions for testing
    
    /**
     * @notice Sets the verification result for testing
     * @param _result The result to return for verification calls
     */
    function setVerificationResult(bool _result) external {
        verificationResult = _result;
        emit VerificationResultChanged(_result);
    }
    
    /**
     * @notice Gets the current verification result setting
     * @return The current verification result
     */
    function getVerificationResult() external view returns (bool) {
        return verificationResult;
    }
    
    /**
     * @notice Sets the production status for testing
     * @param _isProduction Whether this should be treated as a production key
     */
    function setProductionStatus(bool _isProduction) external {
        isProduction = _isProduction;
        emit ProductionStatusChanged(_isProduction);
    }
    
    /**
     * @notice Gets the owner address
     * @return The owner address
     */
    function getOwner() external view returns (address) {
        return owner;
    }
}
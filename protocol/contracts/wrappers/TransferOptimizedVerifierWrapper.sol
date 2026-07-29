// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IFactoryVerifierWrapper} from "./IFactoryVerifierWrapper.sol";
import {VerifierFactory} from "../VerifierFactory.sol";

/**
 * @title TransferOptimizedVerifierWrapper
 * @dev Factory-based wrapper for transfer-optimized ZK proof verification
 * @notice Uses VerifierFactory to get the appropriate verifier instance
 * @author Aegis Protocol Team
 * @custom:security-contact security@aegisprotocol.com
 * @custom:version 2.0.0
 */
contract TransferOptimizedVerifierWrapper is IFactoryVerifierWrapper {
    /// @notice Immutable factory reference for gas optimization
    VerifierFactory public immutable VERIFIER_FACTORY;
    
    /// @notice Circuit type constant for this wrapper
    string public constant CIRCUIT_TYPE = "transfer-optimized";
    
    /// @notice Function selector for verifyProof to optimize gas usage
    bytes4 private constant VERIFY_PROOF_SELECTOR = 0x43753b4d;
    
    /**
     * @notice Constructor with enhanced validation
     * @dev Constructor with enhanced validation
     * @param _verifierFactory Address of the VerifierFactory contract
     * @custom:throws InvalidFactoryAddress When factory address is zero
     * @custom:throws CircuitTypeNotSupported When circuit type is not supported by factory
     */
    constructor(address _verifierFactory) {
        if (_verifierFactory == address(0)) {
            revert InvalidFactoryAddress();
        }
        
        VERIFIER_FACTORY = VerifierFactory(_verifierFactory);
        
        // Verify that the circuit type is supported
        address verifierAddress = VERIFIER_FACTORY.getVerifier(CIRCUIT_TYPE);
        if (verifierAddress == address(0)) {
            revert CircuitTypeNotSupported();
        }
        
        emit VerifierUpdated(address(0), verifierAddress);
    }
    
    /**
     * @notice Get the current verifier address from factory
     * @dev Get the current verifier address from factory
     * @return Address of the current verifier for this circuit type
     */
    function getVerifierAddress() public view override returns (address) {
        return VERIFIER_FACTORY.getVerifier(CIRCUIT_TYPE);
    }
    
    /**
     * @notice Verify a ZK proof using the current verifier
     * @dev Verify a ZK proof using the current verifier
     * @param a First component of the proof
     * @param b Second component of the proof  
     * @param c Third component of the proof
     * @param input Public inputs to the circuit
     * @return success True if the proof is valid
     * @custom:throws VerifierNotAvailable When verifier is not deployed
     * @custom:throws VerificationFailed When proof verification fails
     */
    function verifyProof(
        uint256[2] calldata a,
        uint256[2][2] calldata b,
        uint256[2] calldata c,
        uint256[] calldata input
    ) external view override returns (bool success) {
        address verifierAddress = VERIFIER_FACTORY.getVerifier(CIRCUIT_TYPE);
        if (verifierAddress == address(0)) {
            revert VerifierNotAvailable();
        }
        
        // Call the verifier contract with enhanced error handling
        (bool callSuccess, bytes memory result) = verifierAddress.staticcall(
            abi.encodeWithSelector(VERIFY_PROOF_SELECTOR, a, b, c, input)
        );
        
        if (!callSuccess) {
            revert ProofVerificationFailed();
        }
        
        return abi.decode(result, (bool));
    }
    
    /**
     * @notice Check if verifier is available
     * @dev Check if verifier is available
     * @return available True if verifier is deployed and available
     */
    function isVerifierAvailable() external view override returns (bool available) {
        return VERIFIER_FACTORY.getVerifier(CIRCUIT_TYPE) != address(0);
    }
    
    /**
     * @notice Get comprehensive verifier information
     * @dev Get comprehensive verifier information
     * @return circuitType The type of circuit this verifier handles
     * @return verifierAddress Current verifier contract address
     * @return isAvailable Whether the verifier is currently available
     */
    function getVerifierInfo() external view override returns (
        string memory circuitType,
        address verifierAddress,
        bool isAvailable
    ) {
        address addr = VERIFIER_FACTORY.getVerifier(CIRCUIT_TYPE);
        return (CIRCUIT_TYPE, addr, addr != address(0));
    }
    
    /**
     * @notice Get the circuit type handled by this wrapper
     * @dev Get the circuit type handled by this wrapper
     * @return circuitType The circuit type string
     */
    function getCircuitType() external pure override returns (string memory circuitType) {
        return CIRCUIT_TYPE;
    }
    
    /**
     * @notice Get the factory address used by this wrapper
     * @dev Get the factory address used by this wrapper
     * @return factoryAddress The VerifierFactory contract address
     */
    function getFactoryAddress() external view override returns (address factoryAddress) {
        return address(VERIFIER_FACTORY);
    }
}
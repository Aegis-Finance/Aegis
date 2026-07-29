// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IVerifierFactory} from "../interfaces/IVerifierFactory.sol";
import {ICommonErrors} from "../interfaces/ICommonErrors.sol";
import {Groth16Verifier} from "../Groth16Verifier.sol";
import {CeremonyVerifier} from "../CeremonyVerifier.sol";

contract MinimalVerifierFactory is IVerifierFactory, ICommonErrors {
    // CRITICAL: Mappings in Solidity auto-initialize to empty/false by default
    // Slither warnings are false positives - these are test mocks and mappings auto-initialize
    // slither-disable-next-line uninitialized-state
    mapping(string => address) public verifiers;
    // slither-disable-next-line uninitialized-state
    string[] public supportedVerifierTypes;
    // slither-disable-next-line uninitialized-state
    address[] public allVerifiers;
    mapping(address => bool) public isVerifier;
    // slither-disable-next-line uninitialized-state
    mapping(string => bytes32) public circuitCeremonyIds;
    // slither-disable-next-line uninitialized-state
    mapping(address => bool) public isProductionVerifier;
    
    function deployVerifier(
        string calldata /* circuitType */,
        Groth16Verifier.VerifyingKey calldata /* verifyingKey */,
        Groth16Verifier.CeremonyMetadata calldata /* ceremonyMetadata */
    ) external pure override returns (address) {
        // Minimal implementation - just return zero address
        return address(0);
    }
    
    function updateVerifier(
        string calldata /* circuitType */,
        Groth16Verifier.VerifyingKey calldata /* verifyingKey */,
        Groth16Verifier.CeremonyMetadata calldata /* ceremonyMetadata */
    ) external pure override {
        // Minimal implementation
    }
    
    function removeVerifier(string calldata circuitType) external override {
        // Minimal implementation
    }
    
    function getVerifier(string calldata circuitType) external view override returns (address verifier) {
        return verifiers[circuitType];
    }
    
    function verifyProof(
        string calldata /* circuitType */,
        uint256[8] calldata /* proof */,
        uint256[] calldata /* publicInputs */
    ) external pure override returns (bool) {
        return true;
    }
    
    function getAllVerifiers() external view override returns (address[] memory) {
        return allVerifiers;
    }
    
    function getVerifierCount() external view override returns (uint256) {
        return allVerifiers.length;
    }
    
    function hasVerifier(string calldata circuitType) external view override returns (bool) {
        return verifiers[circuitType] != address(0);
    }
    
    function getVerificationKeyHash(string calldata /* circuitType */) external pure override returns (bytes32) {
        return bytes32(0);
    }
    
    function getSupportedVerifierTypes() external view override returns (string[] memory) {
        return supportedVerifierTypes;
    }
    
    function transferOptimizedVerifier() external view override returns (address) {
        return verifiers["transfer-optimized"];
    }
    
    function mintOptimizedVerifier() external view override returns (address) {
        return verifiers["mint-optimized"];
    }
    
    function privacyVerifier() external view override returns (address) {
        return verifiers["privacy"];
    }
    
    function governanceVerifier() external view override returns (address) {
        return verifiers["governance"];
    }
    
    function bridgeVerifier() external view override returns (address) {
        return verifiers["bridge"];
    }
    
    function derivativeVerifier() external view override returns (address) {
        return verifiers["derivative"];
    }
    
    function getCeremonyId(string calldata circuitType) external view override returns (bytes32 ceremonyId) {
        return circuitCeremonyIds[circuitType];
    }
    
    function isProduction(address verifier) external view override returns (bool) {
        return isProductionVerifier[verifier];
    }
    
    function governanceContract() external pure override returns (address) {
        return address(0);
    }
    
    function CEREMONY_VERIFIER() external pure override returns (CeremonyVerifier) {
        return CeremonyVerifier(address(0));
    }
    
    function setGovernanceContract(address _governance) external override {
        // Minimal implementation
    }
}
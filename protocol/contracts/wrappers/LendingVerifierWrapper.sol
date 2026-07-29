// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IFactoryVerifierWrapper} from "./IFactoryVerifierWrapper.sol";
import {VerifierFactory} from "../VerifierFactory.sol";

/**
 * @title LendingVerifierWrapper
 * @dev Factory-based wrapper for **borrow** (`lending-tenor`) Groth16 verification only.
 * @notice Other lending operations use distinct circuit types (`lending-liquidity`, `lending-repay`, etc.); call `VerifierFactory` directly for those.
 */
contract LendingVerifierWrapper is IFactoryVerifierWrapper {
    VerifierFactory public immutable VERIFIER_FACTORY;
    string public constant CIRCUIT_TYPE = "lending-tenor";
    bytes4 private constant VERIFY_PROOF_SELECTOR = 0x0d37660f;
    
    constructor(address _verifierFactory) {
        if (_verifierFactory == address(0)) revert InvalidFactoryAddress();
        VERIFIER_FACTORY = VerifierFactory(_verifierFactory);
        address verifierAddress = VERIFIER_FACTORY.getVerifier(CIRCUIT_TYPE);
        if (verifierAddress == address(0)) revert CircuitTypeNotSupported();
        emit VerifierUpdated(address(0), verifierAddress);
    }
    
    function getVerifierAddress() public view override returns (address) {
        return VERIFIER_FACTORY.getVerifier(CIRCUIT_TYPE);
    }
    
    function verifyProof(
        uint256[2] calldata a,
        uint256[2][2] calldata b,
        uint256[2] calldata c,
        uint256[] calldata input
    ) external view override returns (bool success) {
        address verifierAddress = VERIFIER_FACTORY.getVerifier(CIRCUIT_TYPE);
        if (verifierAddress == address(0)) revert VerifierNotAvailable();
        (bool callSuccess, bytes memory result) = verifierAddress.staticcall(
            abi.encodeWithSelector(VERIFY_PROOF_SELECTOR, a, b, c, input)
        );
        if (!callSuccess) revert ProofVerificationFailed();
        return abi.decode(result, (bool));
    }
    
    function isVerifierAvailable() external view override returns (bool available) {
        return VERIFIER_FACTORY.getVerifier(CIRCUIT_TYPE) != address(0);
    }
    
    function getVerifierInfo() external view override returns (
        string memory circuitType,
        address verifierAddress,
        bool isAvailable
    ) {
        address addr = VERIFIER_FACTORY.getVerifier(CIRCUIT_TYPE);
        return (CIRCUIT_TYPE, addr, addr != address(0));
    }
    
    function getCircuitType() external pure override returns (string memory circuitType) {
        return CIRCUIT_TYPE;
    }
    
    function getFactoryAddress() external view override returns (address factoryAddress) {
        return address(VERIFIER_FACTORY);
    }
}


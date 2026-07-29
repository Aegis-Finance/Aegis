// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IVerifier} from "../interfaces/IVerifier.sol";

contract MockSybilVerifier is IVerifier {
    bool public shouldVerify = true;

    function setShouldVerify(bool _shouldVerify) external {
        shouldVerify = _shouldVerify;
    }

    function setVerificationResult(bool _result) external {
        shouldVerify = _result;
    }

    function verifyProof(
        uint256[2] calldata,
        uint256[2][2] calldata,
        uint256[2] calldata,
        uint256[] calldata
    ) external view override returns (bool) {
        return shouldVerify;
    }

    function verifyProof(
        uint256[8] calldata,
        uint256[] calldata
    ) external view override returns (bool) {
        return shouldVerify;
    }

    function getVerificationKeyHash() external pure override returns (bytes32) {
        return keccak256("mock_sybil_verification_key");
    }

    function isProductionKey() external pure override returns (bool) {
        return false;
    }

    function getCeremonyId() external pure override returns (bytes32) {
        return keccak256("mock_sybil_ceremony");
    }

    function validateProductionSafety() external pure override {}
}



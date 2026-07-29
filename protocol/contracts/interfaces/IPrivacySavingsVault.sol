// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

interface IPrivacySavingsVault {
    function openSavings(bytes32 commitment, uint256 lockDuration) external returns (uint256 depositId);
}

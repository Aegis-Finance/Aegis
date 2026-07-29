// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/**
 * @title IPrivateCreditProfile
 * @notice Anonymous credit attestation for optional lending rate / eligibility gates.
 */
interface IPrivateCreditProfile {
    function verifyCreditForLending(
        uint256 minScoreRequired,
        uint256[8] calldata proof,
        uint256[] calldata publicInputs
    ) external returns (bool passed);
}

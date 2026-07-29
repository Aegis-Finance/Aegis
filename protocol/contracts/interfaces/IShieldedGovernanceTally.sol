// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

interface IShieldedGovernanceTally {
    function registerProposal(uint256 proposalId, uint256 votingEnds) external;
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "../interfaces/IPrivateGovernance.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @title MockPrivateGovernance
 * @dev Mock implementation of IPrivateGovernance for testing
 * Also implements AccessControl to grant admin roles to other addresses
 */
contract MockPrivateGovernance is IPrivateGovernance, AccessControl {
    address public caller;
    
    constructor() {
        // Grant DEFAULT_ADMIN_ROLE to this contract so it can grant roles to others
        _grantRole(DEFAULT_ADMIN_ROLE, address(this));
    }
    
    function setCaller(address _caller) external {
        caller = _caller;
    }
    
    /**
     * @dev Grant admin role to another address in a target contract (used for testing)
     * This allows the mock governance to grant admin role to governance signer
     * in contracts that use this as the governance interface
     * The target contract must have a grantAdminRole function that accepts GOVERNANCE as caller
     */
    function grantAdminRoleToContract(address targetContract, address adminAddress) external {
        // Call the target contract's grantAdminRole function
        // This will work if the target contract allows GOVERNANCE to grant roles
        (bool success, ) = targetContract.call(
            abi.encodeWithSignature("grantAdminRole(address)", adminAddress)
        );
        require(success, "Grant admin role failed");
    }
    
    function submitProposal(ProposalParams calldata) external pure override returns (uint256) {
        return 1;
    }

    function createProposal(ProposalParams calldata) external pure override returns (uint256) {
        return 1;
    }
    
    function queueProposal(uint256) external pure override {}
    
    function executeProposal(uint256) external pure override {}
    
    function getProposalState(uint256) external pure override returns (ProposalState) {
        return ProposalState.ACTIVE;
    }
    
    function getProposal(uint256) external pure override returns (
        string memory,
        string memory,
        address[] memory,
        uint256[] memory,
        bytes[] memory,
        uint256,
        uint256,
        uint256,
        ProposalState
    ) {
        address[] memory targets = new address[](0);
        uint256[] memory values = new uint256[](0);
        bytes[] memory calldatas = new bytes[](0);
        return ("", "", targets, values, calldatas, 0, 0, 0, ProposalState.ACTIVE);
    }
    
    function hasVotingPower(address) external pure override returns (bool) {
        return true;
    }
    
    function getGovernanceConfig() external pure override returns (
        uint256,
        uint256,
        uint256,
        uint256,
        uint256
    ) {
        return (2 days, 12 hours, 100_000e18, 1_000_000e18, 500_000e18);
    }
}


// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ICommonErrors} from "../interfaces/ICommonErrors.sol";
import {PrivateTokenContract} from "../PrivateTokenContract.sol";
import {VerifierFactory} from "../VerifierFactory.sol";
import {GovernanceProofValidator} from "./GovernanceProofValidator.sol";

/**
 * @title GovernanceDelegation
 * @author Aegis Protocol Team
 * @dev Voting power delegation functionality
 * @notice Extracted from PrivateGovernance to reduce contract size
 */
contract GovernanceDelegation is ReentrancyGuard, ICommonErrors {
    using GovernanceProofValidator for VerifierFactory;
    
    PrivateTokenContract public immutable GOVERNANCE_TOKEN;
    VerifierFactory public VERIFIER_FACTORY;
    
    // Delegation storage
    mapping(bytes32 => DelegationInfo) public delegations;
    mapping(bytes32 => bytes32) public commitmentToDelegate;
    mapping(bytes32 => uint256) public commitmentVotingPower;
    mapping(bytes32 => uint256) public commitmentDelegatedAway;
    mapping(bytes32 => bool) public nullifierUsed;
    
    address public owner;
    
    struct DelegationInfo {
        bytes32 delegatorCommitment;
        bytes32 delegateCommitment;
        uint256 delegatedPower;
        uint256 timestamp;
        bool isActive;
        bytes32 nullifier;
    }
    
    struct DelegationParams {
        bytes32 delegatorCommitment;
        bytes32 delegateCommitment;
        uint256 delegatedPower;
        bytes32 nullifier;
        bytes zkProof;
    }
    
    event VotingPowerDelegated(
        bytes32 indexed delegatorCommitment,
        bytes32 indexed delegateCommitment,
        uint256 indexed delegatedPower
    );
    
    event DelegationRevoked(
        bytes32 indexed delegatorCommitment,
        bytes32 indexed delegateCommitment,
        uint256 indexed revokedPower
    );
    
    modifier onlyValidProof(bytes memory proof, bytes32 commitment) {
        GovernanceProofValidator.validateProof(VERIFIER_FACTORY, proof, commitment, 0);
        _;
    }
    
    constructor(
        address _governanceToken,
        address _verifierFactory
    ) {
        GOVERNANCE_TOKEN = PrivateTokenContract(_governanceToken);
        if (_verifierFactory == address(0)) revert InvalidAddress();
        VERIFIER_FACTORY = VerifierFactory(_verifierFactory);
        owner = msg.sender;
    }
    
    function setVerifierFactory(address _verifierFactory) external {
        if (msg.sender != owner) revert NotOwner();
        if (address(VERIFIER_FACTORY) != address(0)) revert AlreadySet();
        if (_verifierFactory == address(0)) revert InvalidAddress();
        VERIFIER_FACTORY = VerifierFactory(_verifierFactory);
    }
    
    /**
     * @notice Delegate voting power to another commitment
     */
    function delegateVotingPower(
        DelegationParams calldata params
    ) external onlyValidProof(params.zkProof, params.delegatorCommitment) {
        if (nullifierUsed[params.nullifier]) revert NullifierAlreadyUsed();
        if (params.delegatedPower == 0) revert NoPowerToDelegate();
        if (params.delegatorCommitment == params.delegateCommitment) revert CannotDelegateToSelf();
        
        uint256 availablePower = _getVotingPower(params.delegatorCommitment);
        if (params.delegatedPower > availablePower) revert InsufficientVotingPower();
        
        nullifierUsed[params.nullifier] = true;
        
        uint256 currentTime = block.timestamp;
        
        if (delegations[params.delegatorCommitment].isActive) {
            _revokeDelegation(params.delegatorCommitment);
        }
        
        delegations[params.delegatorCommitment] = DelegationInfo({
            delegatorCommitment: params.delegatorCommitment,
            delegateCommitment: params.delegateCommitment,
            delegatedPower: params.delegatedPower,
            timestamp: currentTime,
            isActive: true,
            nullifier: params.nullifier
        });
        
        commitmentDelegatedAway[params.delegatorCommitment] += params.delegatedPower;
        commitmentVotingPower[params.delegateCommitment] += params.delegatedPower;
        commitmentToDelegate[params.delegatorCommitment] = params.delegateCommitment;
        
        emit VotingPowerDelegated(
            params.delegatorCommitment,
            params.delegateCommitment,
            params.delegatedPower
        );
    }
    
    /**
     * @notice Revoke a delegation
     */
    function revokeDelegation(
        bytes32 delegatorCommitment,
        bytes32 nullifier,
        bytes calldata zkProof
    ) external onlyValidProof(zkProof, delegatorCommitment) {
        if (nullifierUsed[nullifier]) revert NullifierAlreadyUsed();
        if (!delegations[delegatorCommitment].isActive) revert NoActiveDelegation();
        
        nullifierUsed[nullifier] = true;
        _revokeDelegation(delegatorCommitment);
    }
    
    /**
     * @notice Get delegation information
     */
    function getDelegation(bytes32 delegatorCommitment) external view returns (DelegationInfo memory) {
        return delegations[delegatorCommitment];
    }
    
    /**
     * @notice Get delegation as individual values (for facade compatibility)
     */
    function getDelegationUnpacked(bytes32 delegatorCommitment) external view returns (
        bytes32 delegatorCommitmentOut,
        bytes32 delegateCommitment,
        uint256 delegatedPower,
        uint256 timestamp,
        bool isActive,
        bytes32 nullifier
    ) {
        DelegationInfo memory delegation = delegations[delegatorCommitment];
        return (
            delegation.delegatorCommitment,
            delegation.delegateCommitment,
            delegation.delegatedPower,
            delegation.timestamp,
            delegation.isActive,
            delegation.nullifier
        );
    }
    
    /**
     * @notice Delegate voting power with individual parameters (for facade compatibility)
     */
    function delegateVotingPowerUnpacked(
        bytes32 delegatorCommitment,
        bytes32 delegateCommitment,
        uint256 delegatedPower,
        bytes32 nullifier,
        bytes calldata zkProof
    ) external onlyValidProof(zkProof, delegatorCommitment) {
        // Inline the delegateVotingPower logic
        if (nullifierUsed[nullifier]) revert NullifierAlreadyUsed();
        if (delegatedPower == 0) revert NoPowerToDelegate();
        if (delegatorCommitment == delegateCommitment) revert CannotDelegateToSelf();
        
        uint256 availablePower = _getVotingPower(delegatorCommitment);
        if (delegatedPower > availablePower) revert InsufficientVotingPower();
        
        nullifierUsed[nullifier] = true;
        
        uint256 currentTime = block.timestamp;
        
        if (delegations[delegatorCommitment].isActive) {
            _revokeDelegation(delegatorCommitment);
        }
        
        delegations[delegatorCommitment] = DelegationInfo({
            delegatorCommitment: delegatorCommitment,
            delegateCommitment: delegateCommitment,
            delegatedPower: delegatedPower,
            timestamp: currentTime,
            isActive: true,
            nullifier: nullifier
        });
        
        commitmentDelegatedAway[delegatorCommitment] += delegatedPower;
        commitmentVotingPower[delegateCommitment] += delegatedPower;
        commitmentToDelegate[delegatorCommitment] = delegateCommitment;
        
        emit VotingPowerDelegated(delegatorCommitment, delegateCommitment, delegatedPower);
    }
    
    /**
     * @notice Get total voting power for a commitment (including delegated)
     */
    function getVotingPower(bytes32 commitment) external view returns (uint256) {
        return _getVotingPower(commitment);
    }
    
    /**
     * @notice Check if a commitment has an active delegation
     */
    function hasActiveDelegation(bytes32 commitment) external view returns (bool) {
        return delegations[commitment].isActive;
    }
    
    // Internal functions
    function _getVotingPower(bytes32 commitment) internal view returns (uint256) {
        uint256 basePower = GOVERNANCE_TOKEN.getBalance(commitment);
        uint256 delegatedReceived = commitmentVotingPower[commitment];
        uint256 delegatedAway = commitmentDelegatedAway[commitment];
        
        uint256 totalAvailable = basePower + delegatedReceived;
        if (delegatedAway > totalAvailable) {
            return 0;
        }
        
        return totalAvailable - delegatedAway;
    }
    
    function _revokeDelegation(bytes32 delegatorCommitment) internal {
        DelegationInfo storage delegation = delegations[delegatorCommitment];
        if (!delegation.isActive) revert NoActiveDelegation();
        
        uint256 delegatedPower = delegation.delegatedPower;
        if (commitmentDelegatedAway[delegatorCommitment] < delegatedPower) {
            revert InsufficientVotingPower();
        }
        if (commitmentVotingPower[delegation.delegateCommitment] < delegatedPower) {
            revert InsufficientVotingPower();
        }
        
        unchecked {
            commitmentDelegatedAway[delegatorCommitment] -= delegatedPower;
            commitmentVotingPower[delegation.delegateCommitment] -= delegatedPower;
        }
        
        delegation.isActive = false;
        delete commitmentToDelegate[delegatorCommitment];
        
        emit DelegationRevoked(
            delegatorCommitment,
            delegation.delegateCommitment,
            delegation.delegatedPower
        );
    }
    
    error AlreadySet();
    // Other errors (NoPowerToDelegate, CannotDelegateToSelf, NoActiveDelegation) are inherited from ICommonErrors
}


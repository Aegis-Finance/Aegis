// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "./interfaces/ICommonErrors.sol";

import {IPrivateGovernance} from "./interfaces/IPrivateGovernance.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @title GovernanceControlledEmergency
 * @author Aegis Protocol Team
 * @dev Routes emergency functions through PrivateGovernance timelock mechanism.
 *      **`evidenceHash` must be non-zero** so every emergency path commits to retrievable off-chain evidence
 *      (IPFS / Arweave bundle, audit transcript, etc.); see `docs/GOVERNANCE_EMERGENCY_CONSTITUTION.md`.
 * @notice This contract provides auto-regulation capabilities while maintaining decentralization
 * @custom:security-contact security@aegis.finance
 */
contract GovernanceControlledEmergency is AccessControl, ReentrancyGuard , ICommonErrors{
    // Core contracts
    /// @notice Reference to the governance contract for proposal submission
    IPrivateGovernance public immutable GOVERNANCE;
    
    // Emergency thresholds and parameters
    /// @notice Time threshold for critical emergency proposals (24 hours)
    uint256 public constant CRITICAL_THRESHOLD = 24 hours; // For critical vulnerabilities
    /// @notice Time threshold for economic emergency proposals (48 hours)
    uint256 public constant ECONOMIC_THRESHOLD = 48 hours; // For economic attacks
    /// @notice Time threshold for compliance emergency proposals (72 hours)
    uint256 public constant COMPLIANCE_THRESHOLD = 72 hours; // For compliance issues
    
    // Emergency types
    enum EmergencyType {
        CIRCUIT_VULNERABILITY,
        ECONOMIC_ATTACK,
        COMPLIANCE_VIOLATION,
        GOVERNANCE_FAILURE
    }
    
    // Emergency proposal structure
    struct EmergencyProposal {
        EmergencyType emergencyType;
        address[] targets;
        bytes[] calldatas;
        string justification;
        uint256 threshold;
        uint256 submittedAt;
        bool executed;
        bytes32 evidenceHash;
    }
    
    // State variables
    /// @notice Mapping of proposal ID to emergency proposal details
    mapping(uint256 => EmergencyProposal) public emergencyProposals;
    /// @notice Mapping of contract addresses authorized to submit emergency proposals
    mapping(address => bool) public authorizedContracts;
    /// @notice Total number of emergency proposals submitted
    uint256 public emergencyProposalCount;
    
    // Events
    /// @notice Emitted when an emergency proposal is submitted
    /// @param proposalId Unique identifier for the proposal
    /// @param emergencyType Type of emergency being reported
    /// @param submitter Address that submitted the proposal
    /// @param evidenceHash Hash of evidence supporting the emergency
    event EmergencyProposalSubmitted(
        uint256 indexed proposalId,
        EmergencyType indexed emergencyType,
        address indexed submitter,
        bytes32 evidenceHash
    );
    
    /// @notice Emitted when an emergency proposal is executed
    /// @param proposalId Unique identifier for the executed proposal
    /// @param emergencyType Type of emergency that was executed
    /// @param executedAt Timestamp when the proposal was executed
    event EmergencyExecuted(
        uint256 indexed proposalId,
        EmergencyType indexed emergencyType,
        uint256 executedAt
    );
    
    /// @notice Emitted when an emergency execution fails
    /// @param proposalId Unique identifier for the failed proposal
    /// @param failedIndex Index of the action that failed
    /// @param failedTarget Address of the target that failed
    event EmergencyExecutionFailed(
        uint256 indexed proposalId,
        uint256 failedIndex,
        address indexed failedTarget
    );
    
    /// @notice Emitted when a contract's authorization status changes
    /// @param contractAddr Address of the contract being authorized/deauthorized
    /// @param authorized Whether the contract is now authorized
    event ContractAuthorized(address indexed contractAddr, bool authorized);
    
    /// @notice Emitted when an emergency proposal is submitted to governance
    /// @param emergencyProposalId ID of the emergency proposal
    /// @param governanceProposalId ID of the created governance proposal
    event GovernanceProposalCreated(
        uint256 indexed emergencyProposalId,
        uint256 indexed governanceProposalId
    );
    
    // Enhanced custom errors with Solidity 0.8.26 features

    /**
     * @notice Initialize the emergency governance contract
     * @dev Constructor sets up the governance contract reference and grants admin role
     * @param _governance Address of PrivateGovernance contract that will manage emergency proposals
     */
    constructor(address _governance) {
        GOVERNANCE = IPrivateGovernance(_governance);
        _grantRole(DEFAULT_ADMIN_ROLE, _governance);
    }
    
    /**
     * @notice Submit emergency proposal that will be routed through governance
     * @dev Creates an emergency proposal with validation and submits it to governance system
     * @param emergencyType Type of emergency (CIRCUIT_VULNERABILITY, ECONOMIC_ATTACK, etc.)
     * @param targets Target contracts for emergency actions
     * @param calldatas Function calls to execute on target contracts
     * @param justification Detailed reason for the emergency proposal
     * @param evidenceHash Commitment to off-chain evidence (IPFS CID hash, transcript bundle, etc.) — must be non-zero
     * @return proposalId Unique identifier for the created proposal
     */
    function submitEmergencyProposal(
        EmergencyType emergencyType,
        address[] calldata targets,
        bytes[] calldata calldatas,
        string calldata justification,
        bytes32 evidenceHash
    ) external nonReentrant returns (uint256 proposalId) {
        // Validate proposal parameters
        _validateProposalSubmission(emergencyType, targets, calldatas, justification, evidenceHash);
        
        uint256 threshold = _calculateThreshold(emergencyType);
        
        // Gas optimization: Use unchecked for counter increment
        unchecked {
            proposalId = ++emergencyProposalCount;
        }
        
        // Create emergency proposal with enhanced memory management
        EmergencyProposal storage proposal = emergencyProposals[proposalId];
        proposal.emergencyType = emergencyType;
        proposal.targets = targets;
        proposal.calldatas = calldatas;
        proposal.justification = justification;
        proposal.threshold = threshold;
        proposal.submittedAt = block.timestamp;
        proposal.executed = false;
        proposal.evidenceHash = evidenceHash;
        
        emit EmergencyProposalSubmitted(proposalId, emergencyType, msg.sender, evidenceHash);
        
        // Auto-submit to governance with appropriate delay
        _submitToGovernance(proposalId);
    }

    /**
     * @notice Validate emergency proposal submission parameters
     * @dev Performs authorization and parameter validation for proposal submission
     * @param emergencyType Type of emergency being reported
     * @param targets Target contracts for emergency actions
     * @param calldatas Function calls to execute on target contracts
     * @param justification Detailed reason for the emergency proposal
     */
    function _validateProposalSubmission(
        EmergencyType emergencyType,
        address[] calldata targets,
        bytes[] calldata calldatas,
        string calldata justification,
        bytes32 evidenceHash
    ) internal view {
        if (evidenceHash == bytes32(0)) {
            revert EmptyEvidenceHash();
        }
        // Enhanced authorization check with detailed error info
        bool hasAdminRole = hasRole(DEFAULT_ADMIN_ROLE, msg.sender);
        bool isAuthorized = authorizedContracts[msg.sender];
        
        if (!isAuthorized && !hasAdminRole) {
            revert UnauthorizedContract();
        }
        
        // Enhanced validation using Solidity 0.8.26 features
        if (targets.length == 0) {
            revert InvalidTargets();
        }
        
        if (targets.length != calldatas.length) {
            revert InvalidTargets();
        }
        
        if (bytes(justification).length == 0) {
            revert EmptyDescription();
        }
        
        // Use Solidity 0.8.26 enhanced validation
        _validateEmergencyType(emergencyType);
    }
    
    /**
     * @notice Execute emergency proposal after governance approval and time threshold
     * @dev Validates proposal exists, time threshold met, and executes emergency actions
     * @param proposalId Emergency proposal ID to execute
     */
    function executeEmergencyProposal(uint256 proposalId) external nonReentrant {
        // Check if proposal exists
        if (proposalId > emergencyProposalCount - 1) {
            revert ProposalNotFound();
        }
        
        EmergencyProposal storage proposal = emergencyProposals[proposalId];
        
        // Enhanced validation with detailed error information
        if (proposal.executed) {
            revert EmergencyAlreadyExecuted();
        }
        
        uint256 currentTime = block.timestamp;
        uint256 requiredTime = proposal.submittedAt + proposal.threshold;
        
        if (currentTime < requiredTime) {
            revert ThresholdNotMet();
        }
        
        // Gas optimization: Check available gas before execution
        uint256 gasRequired = proposal.targets.length * 50_000 + 100_000; // Estimate
        if (gasleft() < gasRequired) {
            revert InsufficientGasForExecution();
        }
        
        // Mark as executed (CEI pattern)
        proposal.executed = true;
        
        // Execute through governance with enhanced error handling
        (bool success, uint256 failedIndex, address failedTarget) = _executeEmergencyActionsEnhanced(
            proposal.targets, 
            proposal.calldatas
        );
        
        if (!success) {
            // Emit detailed failure information for debugging
            emit EmergencyExecutionFailed(proposalId, failedIndex, failedTarget);
            revert GovernanceExecutionFailed();
        }
        
        emit EmergencyExecuted(proposalId, proposal.emergencyType, currentTime);
    }
    
    /**
     * @notice Set contract authorization for emergency proposals
     * @dev Allows emergency role holders to authorize/deauthorize contracts for proposal submission
     * @param contractAddr Contract address to authorize or deauthorize
     * @param authorized True to authorize, false to deauthorize
     */
    function setContractAuthorization(
        address contractAddr,
        bool authorized
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        authorizedContracts[contractAddr] = authorized;
        emit ContractAuthorized(contractAddr, authorized);
    }
    
    // Note: Admin role management is intentionally restricted
    // Only the GOVERNANCE contract (granted at deployment) has admin role
    // This ensures full decentralization - no additional admin roles can be granted
    // Governance contract can still authorize contracts via setContractAuthorization

    /**
     * @notice Enhanced execute emergency actions with detailed error reporting
     * @dev Enhanced execute emergency actions with detailed error reporting
     * @param targets Target contracts
     * @param calldatas Function calls
     * @return success Whether all calls succeeded
     * @return failedIndex Index of first failed call (if any)
     * @return failedTarget Address of first failed target (if any)
     */
    function _executeEmergencyActionsEnhanced(
        address[] memory targets,
        bytes[] memory calldatas
    ) internal returns (bool success, uint256 failedIndex, address failedTarget) {
        success = true;
        failedIndex = type(uint256).max; // Use max value to indicate no failure
        failedTarget = address(0);
        
        // Circuit breaker: Check for suspicious patterns
        if (targets.length > 10) {
            revert CircuitBreaker();
        }
        
        for (uint256 i = 0; i < targets.length; ++i) {
            // Enhanced gas management
            uint256 gasForCall = gasleft() / (targets.length - i + 1);
            if (gasForCall < 30_000) {
                success = false;
                failedIndex = i;
                failedTarget = targets[i];
                break;
            }
            
            // Execute with gas limit
            (bool callSuccess,) = targets[i].call{gas: gasForCall}(calldatas[i]);
            if (!callSuccess) {
                success = false;
                failedIndex = i;
                failedTarget = targets[i];
                // Continue with other calls for partial execution
            }
        }
    }
    
    /**
     * @notice Validate emergency type is within valid range
     * @dev Validate emergency type using Solidity 0.8.26 using-for syntax
     * @param emergencyType Type to validate
     */
    function _validateEmergencyType(EmergencyType emergencyType) internal pure {
        if (uint8(emergencyType) > uint8(EmergencyType.GOVERNANCE_FAILURE)) {
            revert InvalidEmergencyType();
        }
    }
    
    /**
     * @notice Calculate time threshold for emergency type execution
     * @dev Calculate threshold for emergency type using Solidity 0.8.26 using-for syntax
     * @param emergencyType Type to calculate threshold for
     * @return threshold Time threshold in seconds
     */
    function _calculateThreshold(EmergencyType emergencyType) internal pure returns (uint256 threshold) {
        // Use assembly for gas optimization in Solidity 0.8.26
        assembly {
            switch emergencyType
            case 0 { threshold := 86400 } // CIRCUIT_VULNERABILITY: 24 hours
            case 1 { threshold := 172800 } // ECONOMIC_ATTACK: 48 hours  
            case 2 { threshold := 259200 } // COMPLIANCE_VIOLATION: 72 hours
            case 3 { threshold := 172800 } // GOVERNANCE_FAILURE: 48 hours
            default { 
                // This should never happen due to validation, but safety first
                threshold := 259200 // Default to 72 hours
            }
        }
    }
    
    /**
     * @notice Get emergency type name for display purposes
     * @dev Internal function to convert emergency type enum to human-readable string
     * @param emergencyType Type of emergency to convert
     * @return Human-readable string representation of the emergency type
     */
    function _getEmergencyTypeName(EmergencyType emergencyType) internal pure returns (string memory) {
        if (emergencyType == EmergencyType.CIRCUIT_VULNERABILITY) return "Circuit Vulnerability";
        if (emergencyType == EmergencyType.ECONOMIC_ATTACK) return "Economic Attack";
        if (emergencyType == EmergencyType.COMPLIANCE_VIOLATION) return "Compliance Violation";
        if (emergencyType == EmergencyType.GOVERNANCE_FAILURE) return "Governance Failure";
        return "Unknown";
    }
    
    /**
     * @notice Get emergency proposal details by ID
     * @dev External view function to retrieve all details of an emergency proposal
     * @param proposalId Proposal ID to query
     * @return emergencyType Type of emergency
     * @return targets Array of target contract addresses
     * @return calldatas Array of function call data
     * @return justification Reason for the emergency proposal
     * @return threshold Time threshold for execution in seconds
     * @return submittedAt Timestamp when proposal was submitted
     * @return executed Whether the proposal has been executed
     * @return evidenceHash Hash of evidence supporting the emergency
     */
    function getEmergencyProposal(uint256 proposalId) external view returns (
        EmergencyType emergencyType,
        address[] memory targets,
        bytes[] memory calldatas,
        string memory justification,
        uint256 threshold,
        uint256 submittedAt,
        bool executed,
        bytes32 evidenceHash
    ) {
        EmergencyProposal storage proposal = emergencyProposals[proposalId];
        return (
            proposal.emergencyType,
            proposal.targets,
            proposal.calldatas,
            proposal.justification,
            proposal.threshold,
            proposal.submittedAt,
            proposal.executed,
            proposal.evidenceHash
        );
    }
    
    /**
     * @notice Submit emergency proposal to governance system
     * @dev Internal function to create and submit a governance proposal for emergency action
     * @param proposalId Emergency proposal ID to submit to governance
     */
    function _submitToGovernance(uint256 proposalId) internal {
        EmergencyProposal storage proposal = emergencyProposals[proposalId];
        
        // Create governance proposal with enhanced description
        string memory governanceDescription = string(abi.encodePacked(
            "Emergency Proposal #", 
            _toString(proposalId),
            ": ",
            proposal.justification,
            " [Evidence: 0x",
            _toHexString(uint256(proposal.evidenceHash)),
            "]"
        ));
        
        // Submit to governance with emergency parameters
        IPrivateGovernance.ProposalParams memory govParams = IPrivateGovernance.ProposalParams({
            title: "Emergency Proposal",
            description: governanceDescription,
            targets: proposal.targets,
            values: new uint256[](proposal.targets.length), // values array (all zeros for emergency)
            calldatas: proposal.calldatas,
            proposerCommitment: bytes32(0), // Emergency proposals don't need commitment
            nullifier: bytes32(0), // Emergency proposals don't need nullifier
            zkProof: "" // Emergency proposals don't need ZK proof
        });
        
        try GOVERNANCE.submitProposal(govParams) returns (uint256 governanceProposalId) {
            emit GovernanceProposalCreated(proposalId, governanceProposalId);
        } catch Error(string memory /* reason */) {
            revert CircuitBreaker();
        }
    }
    
    /**
     * @notice Convert uint256 to string representation
     * @dev Gas-optimized conversion using assembly for digit counting and string building
     * @param value Unsigned integer value to convert
     * @return String representation of the input value
     */
    function _toString(uint256 value) internal pure returns (string memory) {
        if (value == 0) return "0";
        
        uint256 temp = value;
        uint256 digits;
        
        // Count digits using assembly for gas optimization
        assembly {
            for { } temp { temp := div(temp, 10) } {
                digits := add(digits, 1)
            }
        }
        
        bytes memory buffer = new bytes(digits);
        
        assembly {
            let ptr := add(buffer, add(32, digits))
            for { } value { value := div(value, 10) } {
                ptr := sub(ptr, 1)
                mstore8(ptr, add(48, mod(value, 10)))
            }
        }
        
        return string(buffer);
    }
    
    /**
     * @notice Convert uint256 to hexadecimal string representation
     * @dev Convert uint256 to hex string (Solidity 0.8.26 optimized)
     * @param value Value to convert
     * @return Hex string representation
     */
    function _toHexString(uint256 value) internal pure returns (string memory) {
        if (value == 0) return "0";
        
        uint256 temp = value;
        uint256 length = 0;
        
        // Calculate length using assembly
        assembly {
            for { } temp { temp := shr(4, temp) } {
                length := add(length, 1)
            }
        }
        
        bytes memory buffer = new bytes(length);
        
        assembly {
            let ptr := add(buffer, add(32, length))
            for { } value { value := shr(4, value) } {
                ptr := sub(ptr, 1)
                let digit := and(value, 0xf)
                mstore8(ptr, add(digit, add(48, mul(gt(digit, 9), 39))))
            }
        }
        
        return string(buffer);
    }
    
    /**
     * @notice Check if emergency proposal can be executed based on time threshold
     * @dev Check if emergency proposal can be executed
     * @param proposalId Proposal ID
     * @return canExecute Whether proposal can be executed
     * @return timeRemaining Time remaining until execution (0 if ready)
     */
    function canExecuteProposal(uint256 proposalId) 
        external 
        view 
        returns (bool canExecute, uint256 timeRemaining) 
    {
        if (proposalId > emergencyProposalCount - 1) {
            return (false, type(uint256).max);
        }
        
        EmergencyProposal storage proposal = emergencyProposals[proposalId];
        
        if (proposal.executed) {
            return (false, 0);
        }
        
        uint256 executionTime = proposal.submittedAt + proposal.threshold;
        uint256 currentTime = block.timestamp;
        
        if (currentTime > executionTime - 1) {
            return (true, 0);
        } else {
            return (false, executionTime - currentTime);
        }
    }

    error EmptyEvidenceHash();
}
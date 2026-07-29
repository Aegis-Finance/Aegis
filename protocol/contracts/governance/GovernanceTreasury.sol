// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ICommonErrors} from "../interfaces/ICommonErrors.sol";
import {IPrivateGovernance} from "../interfaces/IPrivateGovernance.sol";

/**
 * @title GovernanceTreasury
 * @author Aegis Protocol Team
 * @notice Manages DAO treasury funds and treasury-specific proposals
 * @dev Handles treasury state, treasury proposals, and execution of treasury transfers
 * 
 * Treasury Funding Sources:
 * 1. FEEM (Fee Monetization): Transaction income from blockchain fees
 *    - AGSFeeMonetization distributes 15% of collected fees to treasuryWallet
 *    - Fees come from network transactions, DeFi operations, ZK proofs
 * 2. Ecosystem Rewards: Portion allocated from ecosystem rewards pool
 *    - Governance can allocate a portion of ecosystem rewards (30% of initial supply)
 *    - Transferred via governance proposals from ecosystemRewardsContract
 * 
 * NOTE: This treasury is funded from protocol revenue.
 * 
 * Treasury Proposal Types:
 * - LIQUIDITY_PROVISION: Fund liquidity pools
 * - DEVELOPMENT: Fund development initiatives
 * - REWARDS: Distribute rewards to contributors
 * - EMERGENCY: Emergency fund usage
 * - OTHER: Other approved uses
 */
contract GovernanceTreasury is ReentrancyGuard, ICommonErrors {
    using SafeERC20 for IERC20;

    /// @notice Accept native Sonic (S) transfers sent directly
    receive() external payable {}

    /// @notice Fallback payable to accept unexpected native transfers
    fallback() external payable {}

    /// @notice Simple owner pattern for administrative actions
    modifier onlyOwner() {
        if (msg.sender != owner) revert UnauthorizedAccess();
        _;
    }

    /// @notice Treasury proposal types
    enum TreasuryProposalType {
        LIQUIDITY_PROVISION,
        DEVELOPMENT,
        REWARDS,
        EMERGENCY,
        OTHER
    }

    /// @notice Treasury state
    struct TreasuryState {
        address treasuryToken;      // Token address for treasury
        address treasuryWallet;     // Wallet address holding treasury funds (must be this contract)
        uint256 totalAllocated;     // Total amount allocated through proposals
        uint256 totalExecuted;      // Total amount executed
    }

    /// @notice Treasury proposal information
    struct TreasuryProposal {
        uint256 proposalId;         // Linked governance proposal ID
        TreasuryProposalType proposalType;
        address recipient;
        uint256 amount;
        bool executed;
    }

    /// @notice Reference to GovernanceCore for proposal validation
    IPrivateGovernance public immutable GOVERNANCE_CORE;

    /// @notice Treasury state
    TreasuryState public treasuryState;

    /// @notice Mapping from proposal ID to treasury proposal
    mapping(uint256 => TreasuryProposal) public treasuryProposals;
    
    /// @notice Mapping from proposal hash (type, recipient, amount) to proposal ID
    mapping(bytes32 => uint256) public proposalHashToId;

    /// @notice Owner for initial setup
    address public owner;

    /// @notice Events
    event TreasuryConfigured(address indexed treasuryToken, address indexed treasuryWallet);
    event TreasuryProposalCreated(
        uint256 indexed proposalId,
        TreasuryProposalType proposalType,
        address indexed recipient,
        uint256 amount
    );
    event TreasuryProposalExecuted(
        uint256 indexed proposalId,
        address indexed recipient,
        uint256 amount
    );

    /// @notice Errors (using ICommonErrors where possible)
    error InvalidTreasuryConfiguration();
    error InsufficientTreasuryBalance();
    error InvalidTreasuryVault();

    /**
     * @notice Constructor
     * @param _governanceCore Address of GovernanceCore contract
     */
    constructor(address _governanceCore) {
        if (_governanceCore == address(0)) revert InvalidAddress();
        GOVERNANCE_CORE = IPrivateGovernance(_governanceCore);
        owner = msg.sender;
    }

    /**
     * @notice Configure treasury (owner only, one-time setup)
     * @param _treasuryToken Address of treasury token
     * @param _treasuryWallet Address of treasury wallet (must be this contract)
     */
    function configureTreasury(
        address _treasuryToken,
        address _treasuryWallet
    ) external {
        if (msg.sender != owner) revert UnauthorizedAccess();
        if (_treasuryToken == address(0) || _treasuryWallet == address(0)) {
            revert InvalidTreasuryConfiguration();
        }
        if (treasuryState.treasuryToken != address(0)) {
            revert InvalidTreasuryConfiguration(); // Already configured
        }

        if (_treasuryWallet != address(this)) {
            revert InvalidTreasuryVault();
        }

        treasuryState = TreasuryState({
            treasuryToken: _treasuryToken,
            treasuryWallet: address(this),
            totalAllocated: 0,
            totalExecuted: 0
        });

        emit TreasuryConfigured(_treasuryToken, _treasuryWallet);
    }

    /**
     * @notice Create a treasury proposal
     * @dev Creates a governance proposal that, when executed, will transfer treasury funds
     * @param title Proposal title
     * @param description Proposal description
     * @param proposalType Type of treasury proposal
     * @param recipient Address to receive treasury funds
     * @param amount Amount to transfer
     * @param proposerCommitment Proposer's commitment (for ZK proof)
     * @param nullifier Nullifier for ZK proof
     * @param zkProof ZK proof for proposal creation
     * @return proposalId The governance proposal ID
     */
    function createTreasuryProposal(
        string memory title,
        string memory description,
        TreasuryProposalType proposalType,
        address recipient,
        uint256 amount,
        bytes32 proposerCommitment,
        bytes32 nullifier,
        bytes calldata zkProof
    ) external nonReentrant returns (uint256 proposalId) {
        return _createTreasuryProposal(
            title,
            description,
            proposalType,
            recipient,
            amount,
            proposerCommitment,
            nullifier,
            zkProof
        );
    }

    function __certoraCreateTreasuryProposal(
        string memory title,
        string memory description,
        uint8 proposalType,
        address recipient,
        uint256 amount,
        bytes32 proposerCommitment,
        bytes32 nullifier
    ) external nonReentrant returns (uint256 proposalId) {
        if (block.chainid != 0) revert UnauthorizedAccess();
        return _createTreasuryProposal(
            title,
            description,
            TreasuryProposalType(proposalType),
            recipient,
            amount,
            proposerCommitment,
            nullifier,
            ""
        );
    }

    function _createTreasuryProposal(
        string memory title,
        string memory description,
        TreasuryProposalType proposalType,
        address recipient,
        uint256 amount,
        bytes32 proposerCommitment,
        bytes32 nullifier,
        bytes memory zkProof
    ) internal returns (uint256 proposalId) {
        if (treasuryState.treasuryToken == address(0)) revert InvalidTreasuryConfiguration();
        if (recipient == address(0)) revert InvalidAddress();
        if (amount == 0) revert InvalidAmount();

        address[] memory targets = new address[](1);
        targets[0] = address(this);

        uint256[] memory values = new uint256[](1);
        values[0] = 0;

        bytes[] memory calldatas = new bytes[](1);
        calldatas[0] = abi.encodeWithSignature(
            "executeTreasuryTransfer(uint8,address,uint256)",
            uint8(proposalType),
            recipient,
            amount
        );

        IPrivateGovernance.ProposalParams memory params = IPrivateGovernance.ProposalParams({
            title: title,
            description: description,
            targets: targets,
            values: values,
            calldatas: calldatas,
            proposerCommitment: proposerCommitment,
            nullifier: nullifier,
            zkProof: zkProof
        });

        // Update state before external call to prevent reentrancy
        bytes32 proposalHash = computeProposalHash(uint8(proposalType), recipient, amount);
        treasuryState.totalAllocated += amount;

        proposalId = GOVERNANCE_CORE.createProposal(params);

        treasuryProposals[proposalId] = TreasuryProposal({
            proposalId: proposalId,
            proposalType: proposalType,
            recipient: recipient,
            amount: amount,
            executed: false
        });

        proposalHashToId[proposalHash] = proposalId + 1;

        emit TreasuryProposalCreated(proposalId, proposalType, recipient, amount);
    }

    /**
     * @notice Execute treasury transfer (called by governance proposal execution)
     * @dev This function is called when a treasury proposal is executed through governance
     * @param proposalType Type of treasury proposal
     * @param recipient Address to receive funds
     * @param amount Amount to transfer
     */
    function executeTreasuryTransfer(
        uint8 proposalType,
        address recipient,
        uint256 amount
    ) external nonReentrant {
        if (msg.sender != address(GOVERNANCE_CORE)) revert UnauthorizedGovernanceAccess();
        
        // Look up proposalId using hash of params
        bytes32 proposalHash = computeProposalHash(proposalType, recipient, amount);
        uint256 storedProposalId = proposalHashToId[proposalHash];
        
        if (storedProposalId == 0) revert ProposalNotFound();
        uint256 proposalId = storedProposalId - 1;
        
        // Verify proposal exists and is being executed
        IPrivateGovernance.ProposalState state = GOVERNANCE_CORE.getProposalState(proposalId);
        // Note: The proposal might be QUEUED when this is called, then becomes EXECUTED
        // So we check if it's QUEUED or EXECUTED
        if (state != IPrivateGovernance.ProposalState.QUEUED && 
            state != IPrivateGovernance.ProposalState.EXECUTED) {
            revert ProposalNotQueued();
        }

        TreasuryProposal storage proposal = treasuryProposals[proposalId];
        if (proposal.recipient == address(0)) revert ProposalNotFound();
        if (proposal.executed) revert ProposalAlreadyExecuted();
        
        // Verify params match
        if (proposal.proposalType != TreasuryProposalType(proposalType) ||
            proposal.recipient != recipient ||
            proposal.amount != amount) {
            revert InvalidProposalType();
        }

        // Mark as executed
        proposal.executed = true;
        treasuryState.totalExecuted += proposal.amount;

        // Transfer tokens from treasury wallet to recipient
        IERC20 token = IERC20(treasuryState.treasuryToken);
        uint256 balance = token.balanceOf(address(this));
        if (balance < proposal.amount) revert InsufficientTreasuryBalance();

        token.safeTransfer(proposal.recipient, proposal.amount);

        emit TreasuryProposalExecuted(proposalId, proposal.recipient, proposal.amount);
    }

    /**
     * @notice Get treasury state
     * @return state Treasury state struct
     */
    function getTreasuryState() external view returns (TreasuryState memory state) {
        return treasuryState;
    }

    /**
     * @notice Get treasury proposal
     * @param proposalId Governance proposal ID
     * @return proposal Treasury proposal struct
     */
    function getTreasuryProposal(uint256 proposalId) external view returns (TreasuryProposal memory proposal) {
        return treasuryProposals[proposalId];
    }

    function computeProposalHash(uint8 proposalType, address recipient, uint256 amount) public pure returns (bytes32) {
        return keccak256(abi.encode(proposalType, recipient, amount));
    }

    /**
     * @notice Sweep accidentally sent native S to a recipient (owner only)
     * @param recipient Address to receive native funds
     * @param amount Amount of native S to send
     */
    function withdrawNative(address payable recipient, uint256 amount) external onlyOwner {
        if (recipient == address(0)) revert InvalidAddress();
        if (amount == 0) revert InvalidAmount();
        if (address(this).balance < amount) revert InsufficientTreasuryBalance();
        (bool success, ) = recipient.call{value: amount}("");
        if (!success) revert TransferFailed();
    }
}


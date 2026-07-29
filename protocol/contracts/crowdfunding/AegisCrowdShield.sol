// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IVerifierFactory} from "../interfaces/IVerifierFactory.sol";
import {IPrivateGovernance} from "../interfaces/IPrivateGovernance.sol";
import {ICommonErrors} from "../interfaces/ICommonErrors.sol";
import {GovernanceAccessLib} from "../libraries/GovernanceAccessLib.sol";

/**
 * @title AegisCrowdShield
 * @author Aegis Protocol Team
 * @notice Core crowdfunding contract implementing Austrian Economics principles with zero-knowledge privacy features
 * @dev Core crowdfunding contract implementing Austrian Economics principles:
 *      - Individual Sovereignty: No platform authority over campaigns
 *      - Spontaneous Order: Market-driven campaign discovery and funding
 *      - Sound Money: Multi-asset support with transparent economics
 *      - Voluntary Association: Opt-in participation at all levels
 *      - Methodological Individualism: Each actor maintains full autonomy
 *      - DAO-aligned settlement: when a campaign succeeds, creator withdrawals are locked until
 *        `max(block.timestamp at success, campaign deadline) + DISPUTE_RESOLUTION_PERIOD`, so
 *        backers can open a market dispute before funds leave the contract; withdrawals are
 *        blocked entirely while status is `Disputed` or `Refunding`.
 */
contract AegisCrowdShield is ReentrancyGuard, Pausable, ICommonErrors {
    using SafeERC20 for IERC20;
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    // Austrian Economics Core Principles
    struct IndividualSovereigntyConfig {
        bool enablePrivateContributions;    // ZK-based private funding
        bool enableMarketDrivenDisputes;    // Peer-to-peer dispute resolution
        bool enableVoluntaryCompliance;     // Optional regulatory compliance
        bool enableSpontaneousOrder;        // Emergent campaign organization
        uint256 minimumStakeForSovereignty; // Economic skin in the game
        /// @notice Bound for `crowdfunding.circom` public inputs (per-campaign limits)
        uint256 minimumContribution;
        uint256 maximumContribution;
    }

    struct CampaignSovereignty {
        address creator;                    // Campaign sovereign authority
        bytes32 commitmentHash;            // ZK commitment to campaign details
        uint256 targetAmount;              // Funding goal in wei
        uint256 deadline;                  // Campaign deadline
        address paymentToken;              // ERC20 token or ETH (address(0))
        bool isPrivate;                    // ZK-based private campaign
        IndividualSovereigntyConfig config; // Sovereignty configuration
        uint256 totalRaised;              // Current funding amount
        uint256 contributorCount;          // Number of individual contributors
        CampaignStatus status;             // Current campaign state
        bytes32 merkleRoot;                // Merkle root for contributor verification
        /// @notice Earliest timestamp at which the creator may call `withdrawFunds` (set on first success)
        uint256 withdrawUnlocksAt;        // 0 = not yet scheduled (legacy rows use deadline + dispute period)
    }

    enum CampaignStatus {
        Active,          // Accepting contributions
        Successful,      // Target reached, funds available
        Failed,          // Deadline passed without reaching target
        Withdrawn,       // Creator withdrew funds
        Disputed,        // Under peer-to-peer dispute resolution
        Refunding        // Refunds in progress
    }

    struct ContributorSovereignty {
        uint256 amount;                    // Contribution amount
        uint256 timestamp;                 // Contribution time
        bytes32 nullifierHash;            // ZK nullifier for privacy
        bool isPrivate;                   // ZK-based private contribution
        bool hasVotingRights;             // Governance participation rights
        bytes32 commitmentHash;           // ZK commitment to contribution details
    }

    struct MarketDrivenDispute {
        uint256 campaignId;               // Disputed campaign (slot 1)
        uint256 stake;                   // Economic stake in dispute (slot 2)
        uint256 deadline;                // Resolution deadline (slot 3)
        uint256 votesFor;                // Votes supporting dispute (slot 4)
        uint256 votesAgainst;            // Votes against dispute (slot 5)
        bytes32 evidenceHash;            // IPFS hash of evidence (slot 6)
        address initiator;                // Dispute initiator (20 bytes)
        bool resolved;                   // Resolution status (1 byte)
        bool upheld;                     // Final decision (1 byte) - packed with initiator in slot 7
        mapping(address => bool) arbiters; // Voluntary arbiters
        mapping(address => bool) votes;   // Arbiter votes
    }

    // State Variables
    /// @notice Mapping of campaign ID to campaign sovereignty data
    mapping(uint256 => CampaignSovereignty) public campaigns;
    /// @notice Mapping of campaign ID and contributor address to contribution data
    mapping(uint256 => mapping(address => ContributorSovereignty)) public contributions;
    /// @notice Mapping of dispute ID to market-driven dispute data
    mapping(uint256 => MarketDrivenDispute) public disputes;
    /// @notice Mapping of creator address to array of their campaign IDs
    mapping(address => uint256[]) public creatorCampaigns;
    /// @notice Mapping of contributor address to array of campaign IDs they contributed to
    mapping(address => uint256[]) public contributorCampaigns;
    /// @notice Mapping to track used nullifiers to prevent double-spending in ZK proofs
    mapping(bytes32 => bool) public usedNullifiers; // Prevent double-spending in ZK
    
    // Arbiter reward tracking for gas-efficient distribution
    /// @notice Mapping of dispute ID and arbiter address to reward amount
    mapping(uint256 => mapping(address => uint256)) public arbiterRewards; // disputeId => arbiter => reward
    /// @notice Mapping of dispute ID to array of arbiter addresses
    mapping(uint256 => address[]) public disputeArbiters; // disputeId => list of arbiters
    
    /// @notice Counter for the next campaign ID to be assigned
    uint256 public nextCampaignId = 1;
    /// @notice Counter for the next dispute ID to be assigned
    uint256 public nextDisputeId = 1;
    
    // Governance integration for decentralized emergency functions
    /// @notice Reference to the governance contract for decentralized emergency functions
    IPrivateGovernance public governanceContract;

    /// @notice Optional `AegisTimelockController` for delayed governance execution.
    address public timelockController;

    event TimelockControllerUpdated(address indexed previousTimelock, address indexed newTimelock);
    
    // Austrian Economics Parameters
    /// @notice Minimum duration a campaign must run (7 days)
    uint256 public constant MINIMUM_CAMPAIGN_DURATION = 7 days;
    /// @notice Maximum duration a campaign can run (365 days)
    uint256 public constant MAXIMUM_CAMPAIGN_DURATION = 365 days;
    /// @notice Time period for dispute resolution (14 days), also the minimum post-success lock before creator withdrawal
    uint256 public constant DISPUTE_RESOLUTION_PERIOD = 14 days;
    /// @notice Minimum stake required to initiate a dispute (0.1 ETH)
    uint256 public constant MINIMUM_DISPUTE_STAKE = 0.1 ether;
    /// @notice Percentage of dispute stake awarded to arbiters (5%)
    uint256 public constant ARBITER_REWARD_PERCENTAGE = 5; // 5% of dispute stake
    
    // ZK Verification
    /// @notice Factory contract for creating ZK verifiers
    IVerifierFactory public immutable VERIFIER_FACTORY;
    /// @notice Circuit type identifier for crowdfunding proofs
    string public constant CROWDFUNDING_CIRCUIT_TYPE = "crowdfunding";
    /// @notice Circuit type identifier for milestone proofs
    string public constant MILESTONE_CIRCUIT_TYPE = "milestone";
    /// @notice Circuit type identifier for refund proofs
    string public constant REFUND_CIRCUIT_TYPE = "refund";

    /// @notice Groth16 public signal count for `circuits/crowdfunding.circom` (outputs `valid`,`newTotal` + eight `main` public inputs). Must match deployed verifier VK.
    uint256 private constant CROWDFUNDING_ZK_NUM_PUBLIC_SIGNALS = 10;

    // Events - Austrian Economics Focused
    /// @notice Emitted when a new campaign is created
    /// @param campaignId The unique identifier for the campaign
    /// @param creator The address of the campaign creator
    /// @param targetAmount The funding goal for the campaign
    /// @param deadline The deadline timestamp for the campaign
    /// @param paymentToken The ERC20 token address (or address(0) for ETH)
    /// @param isPrivate Whether the campaign uses zero-knowledge privacy features
    event CampaignCreated(
        uint256 indexed campaignId,
        address indexed creator,
        uint256 indexed targetAmount,
        uint256 deadline,
        address paymentToken,
        bool isPrivate
    );
    
    /// @notice Emitted when a contribution is made to a campaign
    /// @param campaignId The campaign receiving the contribution
    /// @param contributor The address making the contribution
    /// @param amount The amount contributed
    /// @param isPrivate Whether this is a private (ZK) contribution
    /// @param nullifierHash The ZK nullifier hash for privacy (bytes32(0) for public)
    event ContributionMade(
        uint256 indexed campaignId,
        address indexed contributor,
        uint256 amount,
        bool indexed isPrivate,
        bytes32 nullifierHash
    );
    
    /// @notice Emitted when a campaign successfully reaches its funding goal
    /// @param campaignId The campaign that succeeded
    /// @param totalRaised The total amount raised by the campaign
    event CampaignSuccessful(uint256 indexed campaignId, uint256 indexed totalRaised);
    
    /// @notice Emitted when a campaign fails to reach its funding goal
    /// @param campaignId The campaign that failed
    /// @param totalRaised The total amount raised by the campaign
    event CampaignFailed(uint256 indexed campaignId, uint256 indexed totalRaised);
    
    /// @notice Emitted when campaign funds are withdrawn by the creator
    /// @param campaignId The campaign from which funds are withdrawn
    /// @param creator The creator withdrawing the funds
    /// @param amount The amount withdrawn
    event FundsWithdrawn(uint256 indexed campaignId, address indexed creator, uint256 indexed amount);
    
    /// @notice Emitted when a refund is issued to a contributor
    /// @param campaignId The campaign for which the refund is issued
    /// @param contributor The contributor receiving the refund
    /// @param amount The refund amount
    event RefundIssued(uint256 indexed campaignId, address indexed contributor, uint256 indexed amount);
    
    /// @notice Emitted when a dispute is initiated against a campaign
    /// @param disputeId The unique identifier for the dispute
    /// @param campaignId The campaign being disputed
    /// @param initiator The address initiating the dispute
    /// @param stake The amount staked by the dispute initiator
    event DisputeInitiated(
        uint256 indexed disputeId,
        uint256 indexed campaignId,
        address indexed initiator,
        uint256 stake
    );
    
    /// @notice Emitted when a dispute is resolved
    /// @param disputeId The dispute that was resolved
    /// @param campaignId The campaign that was disputed
    /// @param upheld Whether the dispute was upheld (true) or rejected (false)
    /// @param arbitersCount The number of arbiters who participated in the resolution
    event DisputeResolved(
        uint256 indexed disputeId,
        uint256 indexed campaignId,
        bool indexed upheld,
        uint256 arbitersCount
    );
    
    /// @notice Emitted when an arbiter claims their reward for dispute resolution
    /// @param disputeId The dispute for which the reward is claimed
    /// @param arbiter The arbiter claiming the reward
    /// @param reward The reward amount claimed
    event ArbiterRewardClaimed(
        uint256 indexed disputeId,
        address indexed arbiter,
        uint256 indexed reward
    );
    
    /// @notice Emitted when the governance contract is updated
    /// @param oldGovernance The previous governance contract address
    /// @param newGovernance The new governance contract address
    event GovernanceContractUpdated(
        address indexed oldGovernance,
        address indexed newGovernance
    );
    
    /// @notice Emitted when a campaign's sovereignty configuration is updated
    /// @param campaignId The campaign whose configuration is updated
    /// @param config The new sovereignty configuration
    event SovereigntyConfigUpdated(
        uint256 indexed campaignId,
        IndividualSovereigntyConfig config
    );

    /// @notice Emitted when a campaign first reaches its target; `withdrawUnlocksAt` is when the creator may withdraw
    /// @param campaignId Campaign that reached its funding target
    /// @param withdrawUnlocksAt Earliest timestamp the creator may call `withdrawFunds`
    event CreatorFundsUnlockScheduled(uint256 indexed campaignId, uint256 withdrawUnlocksAt);

    /// @notice Creator updated the contributor allowlist root used by private contribution proofs
    event CampaignContributorMerkleRootUpdated(uint256 indexed campaignId, bytes32 merkleRoot);

    // Custom Errors
    error CampaignDoesNotExist();
    error CampaignNotActive();
    error CampaignDeadlinePassed();
    error InvalidVerifierFactory();
    error TargetAmountMustBePositive();
    error InvalidDeadline();
    error InvalidCommitmentHash();
    error ContributionMustBePositive();
    error PrivateContributionsDisabled();
    
    error CrowdfundingVerifierNotDeployed();
    error UnexpectedZkProofData();
    error ProofAmountMismatch();
    error ProofCrowdfundingBinding();
    error InvalidContributionBounds();
    error IncorrectETHAmount();
    error ETHNotAcceptedForTokenCampaigns();
    error NoFundsToWithdraw();
    error ETHTransferFailed();
    error NoContributionToRefund();
    error ETHRefundFailed();
    error InsufficientDisputeStake();
    error EvidenceHashRequired();
    error DisputesDisabledForCampaign();
    error MustBeContributorToDispute();
    error DisputeAlreadyResolved();
    error DisputeVotingPeriodEnded();
    
    error DisputeVotingPeriodNotEnded();
    error NoVotesCast();
    error VerifierNotDeployed();
    error CannotWithdrawFunds();
    error RefundNotAvailable();
    error DisputesDisabled();
    error MustHaveEconomicStakeToArbitrate();
    error NoRewardToClaim();
    error CampaignDisputed();
    error CampaignRefunding();
    error WithdrawTooEarly();
    error CannotDisputeInCurrentState();
    error DisputeAlreadyOpen();

    // Modifiers
    modifier onlyCampaignCreator(uint256 campaignId) {
        if (campaigns[campaignId].creator != msg.sender) {
            revert ICommonErrors.NotCampaignCreator();
        }
        _;
    }
    
    modifier campaignExists(uint256 campaignId) {
        if (campaigns[campaignId].creator == address(0)) {
            revert CampaignDoesNotExist();
        }
        _;
    }
    
    modifier campaignActive(uint256 campaignId) {
        if (campaigns[campaignId].status != CampaignStatus.Active) {
            revert CampaignNotActive();
        }
        if (block.timestamp > campaigns[campaignId].deadline) {
            revert CampaignDeadlinePassed();
        }
        _;
    }
    
    modifier onlyGovernance() {
        if (address(governanceContract) == address(0)) {
            revert UnauthorizedAccess();
        }
        if (!GovernanceAccessLib.isGovernanceTimelockOrCore(address(governanceContract), timelockController, msg.sender)) {
            revert UnauthorizedAccess();
        }
        _;
    }

    /**
     * @notice Register the protocol timelock for delayed crowdfunding admin.
     */
    function setTimelockController(address newTimelock) external onlyGovernance {
        emit TimelockControllerUpdated(timelockController, newTimelock);
        timelockController = newTimelock;
    }

    /**
     * @notice Initializes the AegisCrowdShield contract with verifier factory and governance
     * @param _verifierFactory Address of the verifier factory for ZK proof verification
     * @param _governanceContract Address of the governance contract for decentralized control
     */
    constructor(address _verifierFactory, address _governanceContract) {
        if (_verifierFactory == address(0)) {
            revert InvalidVerifierFactory();
        }
        if (_governanceContract == address(0)) {
            revert InvalidAddress();
        }
        VERIFIER_FACTORY = IVerifierFactory(_verifierFactory);
        governanceContract = IPrivateGovernance(_governanceContract);
    }

    /**
     * @notice Create a new crowdfunding campaign with Austrian Economics principles
     * @param targetAmount Funding goal in wei
     * @param duration Campaign duration in seconds
     * @param paymentToken ERC20 token address (address(0) for ETH)
     * @param commitmentHash ZK commitment to campaign details
     * @param isPrivate Whether to use ZK privacy features
     * @param sovereigntyConfig Individual sovereignty configuration
     * @return campaignId The unique identifier of the created campaign
     */
    function createCampaign(
        uint256 targetAmount,
        uint256 duration,
        address paymentToken,
        bytes32 commitmentHash,
        bool isPrivate,
        IndividualSovereigntyConfig calldata sovereigntyConfig
    ) external nonReentrant whenNotPaused returns (uint256 campaignId) {
        if (targetAmount == 0) {
            revert TargetAmountMustBePositive();
        }
        if (duration < MINIMUM_CAMPAIGN_DURATION || duration > MAXIMUM_CAMPAIGN_DURATION) {
            revert InvalidDeadline();
        }
        if (commitmentHash == bytes32(0)) {
            revert InvalidCommitmentHash();
        }
        if (sovereigntyConfig.minimumContribution == 0) {
            revert ContributionMustBePositive();
        }
        if (sovereigntyConfig.maximumContribution < sovereigntyConfig.minimumContribution) {
            revert InvalidContributionBounds();
        }
        if (sovereigntyConfig.maximumContribution > targetAmount) {
            revert InvalidContributionBounds();
        }
        
        // Economic sovereignty requirement - creator must have skin in the game
        if (sovereigntyConfig.minimumStakeForSovereignty != 0) {
            if (msg.sender.balance < sovereigntyConfig.minimumStakeForSovereignty) {
                revert InsufficientDisputeStake(); // Reusing existing error for stake requirement
            }
        }

        campaignId = ++nextCampaignId;
        uint256 deadline = block.timestamp + duration;

        campaigns[campaignId] = CampaignSovereignty({
            creator: msg.sender,
            commitmentHash: commitmentHash,
            targetAmount: targetAmount,
            deadline: deadline,
            paymentToken: paymentToken,
            isPrivate: isPrivate,
            config: sovereigntyConfig,
            totalRaised: 0,
            contributorCount: 0,
            status: CampaignStatus.Active,
            merkleRoot: bytes32(0),
            withdrawUnlocksAt: 0
        });

        creatorCampaigns[msg.sender].push(campaignId);

        emit CampaignCreated(
            campaignId,
            msg.sender,
            targetAmount,
            deadline,
            paymentToken,
            isPrivate
        );
        
        emit SovereigntyConfigUpdated(campaignId, sovereigntyConfig);
    }

    /**
     * @notice Set the Merkle root of allowed contributors for private campaigns (creator-only).
     * @dev Required for `contribute` with ZK proofs when the circuit binds `merkleRoot`.
     */
    function setCampaignContributorMerkleRoot(uint256 campaignId, bytes32 merkleRoot) external {
        CampaignSovereignty storage campaign = campaigns[campaignId];
        if (campaign.creator == address(0)) {
            revert CampaignDoesNotExist();
        }
        if (msg.sender != campaign.creator) {
            revert UnauthorizedAccess();
        }
        if (!campaign.isPrivate) {
            revert PrivateContributionsDisabled();
        }
        campaign.merkleRoot = merkleRoot;
        emit CampaignContributorMerkleRootUpdated(campaignId, merkleRoot);
    }

    /**
     * @notice Contribute to a campaign with optional ZK privacy
     * @param campaignId Campaign to contribute to
     * @param amount Contribution amount
     * @param nullifierHash ZK nullifier for privacy (bytes32(0) for public)
     * @param zkProof Groth16 proof `[A.x, A.y, B.x0, B.x1, B.y0, B.y1, C.x, C.y]`; use zeros for public contributions
     * @param zkPublicInputs Public signals for `crowdfunding` circuit (length 10); empty for public contributions
     */
    function contribute(
        uint256 campaignId,
        uint256 amount,
        bytes32 nullifierHash,
        uint256[8] calldata zkProof,
        uint256[] calldata zkPublicInputs
    ) external payable nonReentrant campaignExists(campaignId) campaignActive(campaignId) {
        CampaignSovereignty storage campaign = campaigns[campaignId];
        if (amount == 0) {
            revert ContributionMustBePositive();
        }
        
        bool isPrivateContribution = nullifierHash != bytes32(0);
        
        // Verify ZK proof for private contributions (nullifier marked used only after successful payment)
        _verifyPrivateContribution(campaign, campaignId, amount, nullifierHash, isPrivateContribution, zkProof, zkPublicInputs);
        
        // Handle payment
        _processPayment(campaign, amount);
        
        // Update contribution records and campaign state
        _updateContributionRecords(campaignId, amount, nullifierHash, isPrivateContribution);
        
        emit ContributionMade(campaignId, msg.sender, amount, isPrivateContribution, nullifierHash);

        // Check if campaign reached its funding target
        if (campaign.totalRaised >= campaign.targetAmount) {
            if (campaign.status != CampaignStatus.Successful) {
                uint256 scheduleRef = block.timestamp > campaign.deadline
                    ? block.timestamp
                    : campaign.deadline;
                campaign.withdrawUnlocksAt = scheduleRef + DISPUTE_RESOLUTION_PERIOD;
                emit CreatorFundsUnlockScheduled(campaignId, campaign.withdrawUnlocksAt);
            }
            campaign.status = CampaignStatus.Successful;
            emit CampaignSuccessful(campaignId, campaign.totalRaised);
        }
    }

    /**
     * @notice Verify private contribution ZK proof and preconditions (does not consume nullifier).
     * @dev Public signal order must match `circuits/crowdfunding.circom` + snarkjs (outputs first): `valid`, `newTotal`, then `campaignId`, `contributionCommitment`, `nullifierHash`, `merkleRoot`, `minimumContribution`, `maximumContribution`, `campaignTarget`, `currentTotal`.
     */
    function _verifyPrivateContribution(
        CampaignSovereignty storage campaign,
        uint256 campaignId,
        uint256 amount,
        bytes32 nullifierHash,
        bool isPrivateContribution,
        uint256[8] calldata zkProof,
        uint256[] calldata zkPublicInputs
    ) internal view {
        if (isPrivateContribution) {
            if (!campaign.config.enablePrivateContributions) {
                revert PrivateContributionsDisabled();
            }
            if (usedNullifiers[nullifierHash]) {
                revert NullifierAlreadyUsed();
            }
            if (zkPublicInputs.length != CROWDFUNDING_ZK_NUM_PUBLIC_SIGNALS) {
                revert ProofCrowdfundingBinding();
            }
            if (zkPublicInputs[0] != 1) {
                revert ProofCrowdfundingBinding();
            }
            if (zkPublicInputs[2] != campaignId) {
                revert ProofCrowdfundingBinding();
            }
            if (uint256(nullifierHash) != zkPublicInputs[4]) {
                revert ProofCrowdfundingBinding();
            }
            if (zkPublicInputs[5] != uint256(campaign.merkleRoot)) {
                revert ProofCrowdfundingBinding();
            }
            if (zkPublicInputs[6] != campaign.config.minimumContribution) {
                revert ProofCrowdfundingBinding();
            }
            if (zkPublicInputs[7] != campaign.config.maximumContribution) {
                revert ProofCrowdfundingBinding();
            }
            if (zkPublicInputs[8] != campaign.targetAmount) {
                revert ProofCrowdfundingBinding();
            }
            if (zkPublicInputs[9] != campaign.totalRaised) {
                revert ProofCrowdfundingBinding();
            }
            if (zkPublicInputs[1] - zkPublicInputs[9] != amount) {
                revert ProofAmountMismatch();
            }
            if (!VERIFIER_FACTORY.verifyProof(CROWDFUNDING_CIRCUIT_TYPE, zkProof, zkPublicInputs)) {
                revert InvalidProof();
            }
        } else {
            if (zkPublicInputs.length != 0) {
                revert UnexpectedZkProofData();
            }
            for (uint256 i; i < 8; ) {
                if (zkProof[i] != 0) {
                    revert UnexpectedZkProofData();
                }
                unchecked {
                    ++i;
                }
            }
        }
    }

    /**
     * @notice Process payment for contribution
     * @param campaign Campaign storage reference
     * @param amount Contribution amount
     */
    function _processPayment(CampaignSovereignty storage campaign, uint256 amount) internal {
        if (campaign.paymentToken == address(0)) {
            // ETH payment
            if (msg.value != amount) {
                revert IncorrectETHAmount();
            }
        } else {
            // ERC20 payment
            if (msg.value != 0) {
                revert ETHNotAcceptedForTokenCampaigns();
            }
            IERC20(campaign.paymentToken).safeTransferFrom(msg.sender, address(this), amount);
        }
    }

    /**
     * @notice Update contribution records and campaign state
     * @param campaignId Campaign identifier
     * @param amount Contribution amount
     * @param nullifierHash ZK nullifier hash
     * @param isPrivateContribution Whether this is a private contribution
     */
    function _updateContributionRecords(
        uint256 campaignId,
        uint256 amount,
        bytes32 nullifierHash,
        bool isPrivateContribution
    ) internal {
        CampaignSovereignty storage campaign = campaigns[campaignId];
        
        // Update contribution records
        contributions[campaignId][msg.sender] = ContributorSovereignty({
            amount: contributions[campaignId][msg.sender].amount + amount,
            timestamp: block.timestamp,
            nullifierHash: nullifierHash,
            isPrivate: isPrivateContribution,
            hasVotingRights: true, // Austrian Economics: Contributors have governance rights
            commitmentHash: keccak256(abi.encodePacked(msg.sender, amount, block.timestamp))
        });

        // Update campaign state
        if (contributions[campaignId][msg.sender].amount == amount) {
            // First contribution from this address
            ++campaign.contributorCount;
            contributorCampaigns[msg.sender].push(campaignId);
        }
        
        campaign.totalRaised += amount;

        if (isPrivateContribution) {
            usedNullifiers[nullifierHash] = true;
        }
    }

    /**
     * @notice Withdraw funds from a successful campaign (creator only)
     * @param campaignId Campaign to withdraw from
     */
    function withdrawFunds(uint256 campaignId) 
        external 
        nonReentrant 
        whenNotPaused
        onlyCampaignCreator(campaignId) 
        campaignExists(campaignId) 
    {
        CampaignSovereignty storage campaign = campaigns[campaignId];
        if (campaign.status == CampaignStatus.Disputed) {
            revert CampaignDisputed();
        }
        if (campaign.status == CampaignStatus.Refunding) {
            revert CampaignRefunding();
        }

        bool economicallySuccessful = (campaign.status == CampaignStatus.Successful ||
            (block.timestamp > campaign.deadline && campaign.totalRaised >= campaign.targetAmount));
        if (!economicallySuccessful) {
            revert CannotWithdrawFunds();
        }

        uint256 unlockAt = campaign.withdrawUnlocksAt;
        if (unlockAt == 0) {
            // Legacy campaigns (pre-scheduling field): never allow withdrawal before deadline + dispute window
            unlockAt = campaign.deadline + DISPUTE_RESOLUTION_PERIOD;
        }
        if (block.timestamp < unlockAt) {
            revert WithdrawTooEarly();
        }

        if (campaign.totalRaised == 0) {
            revert NoFundsToWithdraw();
        }

        uint256 amount = campaign.totalRaised;
        campaign.totalRaised = 0;
        campaign.status = CampaignStatus.Withdrawn;

        // Transfer funds to creator
        if (campaign.paymentToken == address(0)) {
            // ETH transfer
            (bool success, ) = payable(msg.sender).call{value: amount}("");
            if (!success) {
                revert ETHTransferFailed();
            }
        } else {
            // ERC20 transfer
            IERC20(campaign.paymentToken).safeTransfer(msg.sender, amount);
        }

        emit FundsWithdrawn(campaignId, msg.sender, amount);
    }

    /**
     * @notice Request refund from a failed campaign
     * @param campaignId Campaign to refund from
     */
    function requestRefund(uint256 campaignId) 
        external 
        nonReentrant 
        campaignExists(campaignId) 
    {
        CampaignSovereignty storage campaign = campaigns[campaignId];
        if (!(campaign.status == CampaignStatus.Failed || 
            (block.timestamp > campaign.deadline && campaign.totalRaised < campaign.targetAmount))) {
            revert RefundNotAvailable();
        }

        ContributorSovereignty storage contribution = contributions[campaignId][msg.sender];
        if (contribution.amount == 0) {
            revert NoContributionToRefund();
        }

        uint256 refundAmount = contribution.amount;
        contribution.amount = 0;

        // Update campaign state
        if (campaign.status != CampaignStatus.Failed && campaign.status != CampaignStatus.Refunding) {
            campaign.status = CampaignStatus.Failed;
            emit CampaignFailed(campaignId, campaign.totalRaised);
        }

        // Transfer refund
        if (campaign.paymentToken == address(0)) {
            // ETH refund
            (bool success, ) = payable(msg.sender).call{value: refundAmount}("");
            if (!success) {
                revert ETHRefundFailed();
            }
        } else {
            // ERC20 refund
            IERC20(campaign.paymentToken).safeTransfer(msg.sender, refundAmount);
        }

        emit RefundIssued(campaignId, msg.sender, refundAmount);
    }

    /**
     * @notice Initiate a market-driven dispute (Austrian Economics principle)
     * @param campaignId Campaign to dispute
     * @param evidenceHash IPFS hash of dispute evidence
     */
    function initiateDispute(uint256 campaignId, bytes32 evidenceHash) 
        external 
        payable 
        nonReentrant 
        whenNotPaused
        campaignExists(campaignId) 
    {
        if (msg.value < MINIMUM_DISPUTE_STAKE) {
            revert InsufficientDisputeStake();
        }
        if (evidenceHash == bytes32(0)) {
            revert EvidenceHashRequired();
        }
        
        CampaignSovereignty storage campaign = campaigns[campaignId];
        if (campaign.status == CampaignStatus.Disputed) {
            revert DisputeAlreadyOpen();
        }
        if (
            campaign.status == CampaignStatus.Withdrawn ||
            campaign.status == CampaignStatus.Failed ||
            campaign.status == CampaignStatus.Refunding
        ) {
            revert CannotDisputeInCurrentState();
        }
        bool funded = campaign.totalRaised >= campaign.targetAmount;
        if (
            campaign.status != CampaignStatus.Successful &&
            !(block.timestamp > campaign.deadline && funded)
        ) {
            revert CannotDisputeInCurrentState();
        }
        if (!campaign.config.enableMarketDrivenDisputes) {
            revert DisputesDisabled();
        }
        if (contributions[campaignId][msg.sender].amount == 0) {
            revert MustBeContributorToDispute();
        }

        uint256 disputeId = ++nextDisputeId;
        
        disputes[disputeId].campaignId = campaignId;
        disputes[disputeId].initiator = msg.sender;
        disputes[disputeId].evidenceHash = evidenceHash;
        disputes[disputeId].stake = msg.value;
        disputes[disputeId].deadline = block.timestamp + DISPUTE_RESOLUTION_PERIOD;
        disputes[disputeId].resolved = false;

        campaign.status = CampaignStatus.Disputed;

        emit DisputeInitiated(disputeId, campaignId, msg.sender, msg.value);
    }

    /**
     * @notice Vote on a dispute as a voluntary arbiter
     * @param disputeId Dispute to vote on
     * @param support Whether to support the dispute
     */
    function voteOnDispute(uint256 disputeId, bool support) external nonReentrant whenNotPaused {
        MarketDrivenDispute storage dispute = disputes[disputeId];
        if (dispute.resolved) {
            revert DisputeAlreadyResolved();
        }
        if (block.timestamp > dispute.deadline) {
            revert DisputeVotingPeriodEnded();
        }
        if (dispute.arbiters[msg.sender]) {
            revert AlreadyVoted();
        }
        
        // Voluntary arbiter requirement - must have economic stake in the ecosystem
        if (contributions[dispute.campaignId][msg.sender].amount == 0 &&
            creatorCampaigns[msg.sender].length == 0) {
            revert MustHaveEconomicStakeToArbitrate();
        }

        dispute.arbiters[msg.sender] = true;
        dispute.votes[msg.sender] = support;
        
        // Track arbiter for reward distribution
        disputeArbiters[disputeId].push(msg.sender);
        
        if (support) {
            ++dispute.votesFor;
        } else {
            ++dispute.votesAgainst;
        }
    }

    /**
     * @notice Resolve a dispute based on arbiter votes
     * @param disputeId Dispute to resolve
     */
    function resolveDispute(uint256 disputeId) external nonReentrant whenNotPaused {
        MarketDrivenDispute storage dispute = disputes[disputeId];
        if (dispute.resolved) {
            revert DisputeAlreadyResolved();
        }
        if (block.timestamp <= dispute.deadline) {
            revert DisputeVotingPeriodNotEnded();
        }
        
        uint256 totalVotes = dispute.votesFor + dispute.votesAgainst;
        if (totalVotes == 0) {
            revert NoVotesCast();
        }
        
        bool upheld = dispute.votesFor > dispute.votesAgainst;
        dispute.resolved = true;
        dispute.upheld = upheld;
        
        // Update campaign status based on dispute outcome
        _updateCampaignStatusAfterDispute(dispute.campaignId, upheld);
        
        // Distribute arbiter rewards
        _distributeArbiterRewards(disputeId, dispute.stake, totalVotes, upheld);
        
        emit DisputeResolved(disputeId, dispute.campaignId, upheld, totalVotes);
    }

    /**
     * @notice Update campaign status after dispute resolution
     * @param campaignId Campaign identifier
     * @param upheld Whether the dispute was upheld
     */
    function _updateCampaignStatusAfterDispute(uint256 campaignId, bool upheld) internal {
        CampaignSovereignty storage campaign = campaigns[campaignId];
        
        if (upheld) {
            // Dispute upheld - campaign marked as failed, refunds enabled
            campaign.status = CampaignStatus.Failed;
        } else {
            // Dispute rejected - restore previous status
            if (campaign.totalRaised >= campaign.targetAmount) {
                campaign.status = CampaignStatus.Successful;
            } else {
                campaign.status = CampaignStatus.Active;
            }
        }
    }

    /**
     * @notice Distribute rewards to arbiters based on their vote alignment
     * @param disputeId Dispute identifier
     * @param stake Total dispute stake
     * @param totalVotes Total number of votes cast
     * @param upheld Whether the dispute was upheld (majority decision)
     */
    function _distributeArbiterRewards(
        uint256 disputeId,
        uint256 stake,
        uint256 totalVotes,
        bool upheld
    ) internal {
        MarketDrivenDispute storage dispute = disputes[disputeId];
        
        // Distribute arbiter rewards (Austrian Economics: Market-driven incentives)
        uint256 totalRewardPool = (stake * ARBITER_REWARD_PERCENTAGE) / 100;
        uint256 rewardPerArbiter = totalRewardPool / totalVotes;
        
        // Calculate rewards for each arbiter based on their vote alignment with majority
        address[] memory arbiters = disputeArbiters[disputeId];
        for (uint256 i = 0; i < arbiters.length; i++) {
            address arbiter = arbiters[i];
            bool arbiterVote = dispute.votes[arbiter];
            
            // Reward arbiters who voted with the majority (Austrian Economics: Market rewards accuracy)
            if (arbiterVote == upheld) {
                arbiterRewards[disputeId][arbiter] = rewardPerArbiter;
                
                // Transfer reward immediately (could be optimized with a claim mechanism)
                (bool success, ) = payable(arbiter).call{value: rewardPerArbiter}("");
                if (!success) {
                    // If transfer fails, keep reward claimable
                    // Arbiter can claim later via claimArbiterReward function
                }
            }
        }
    }

    /**
     * @notice Claim arbiter reward for a resolved dispute
     * @param disputeId Dispute ID to claim reward from
     */
    function claimArbiterReward(uint256 disputeId) external nonReentrant {
        uint256 reward = arbiterRewards[disputeId][msg.sender];
        if (reward == 0) {
            revert NoRewardToClaim();
        }
        
        arbiterRewards[disputeId][msg.sender] = 0;
        
        (bool success, ) = payable(msg.sender).call{value: reward}("");
        if (!success) {
            revert TransferFailed();
        }
        
        emit ArbiterRewardClaimed(disputeId, msg.sender, reward);
    }

    // View Functions
    /**
     * @notice Get campaign details by ID
     * @param campaignId The campaign identifier
     * @return Campaign details including status, amounts, and configuration
     */
    function getCampaign(uint256 campaignId) external view returns (CampaignSovereignty memory) {
        return campaigns[campaignId];
    }

    /**
     * @notice Earliest time the creator may withdraw after success (for UI / wallets).
     * @param campaignId The campaign identifier
     * @return unlocksAt Timestamp from which withdrawal is allowed, or 0 if not yet in a post-success state
     * @dev Returns 0 if the campaign is not yet in a post-success economic state from the UI's perspective.
     */
    function getCreatorWithdrawUnlock(uint256 campaignId) external view campaignExists(campaignId) returns (uint256 unlocksAt) {
        CampaignSovereignty storage c = campaigns[campaignId];
        if (c.withdrawUnlocksAt != 0) {
            return c.withdrawUnlocksAt;
        }
        if (
            c.status == CampaignStatus.Successful ||
            (block.timestamp > c.deadline && c.totalRaised >= c.targetAmount)
        ) {
            return c.deadline + DISPUTE_RESOLUTION_PERIOD;
        }
        return 0;
    }
    
    /**
     * @notice Get contribution details for a specific contributor and campaign
     * @param campaignId The campaign identifier
     * @param contributor The contributor's address
     * @return Contribution details including amount and privacy settings
     */
    function getContribution(uint256 campaignId, address contributor) 
        external 
        view 
        returns (ContributorSovereignty memory) 
    {
        return contributions[campaignId][contributor];
    }
    
    /**
     * @notice Get all campaigns created by a specific address
     * @param creator The creator's address
     * @return Array of campaign IDs created by the address
     */
    function getCreatorCampaigns(address creator) external view returns (uint256[] memory) {
        return creatorCampaigns[creator];
    }
    
    /**
     * @notice Get all campaigns a specific address has contributed to
     * @param contributor The contributor's address
     * @return Array of campaign IDs the address has contributed to
     */
    function getContributorCampaigns(address contributor) external view returns (uint256[] memory) {
        return contributorCampaigns[contributor];
    }

    // Emergency Functions (Austrian Economics: Minimal intervention through decentralized governance)
    /**
     * @notice Pause the contract through decentralized governance consensus
     * @dev Austrian Economics: Community-driven intervention only when absolutely necessary
     */
    function pause() external onlyGovernance {
        // Decentralized emergency pause through governance consensus
        // Austrian Economics: Community-driven intervention only when absolutely necessary
        _pause();
    }
    
    /**
     * @notice Unpause the contract through decentralized governance consensus
     * @dev Austrian Economics: Restoration of market function through community decision
     */
    function unpause() external onlyGovernance {
        // Decentralized emergency unpause through governance consensus
        // Austrian Economics: Restoration of market function through community decision
        _unpause();
    }
    
    /**
     * @notice Update governance contract (Austrian Economics: Evolutionary governance)
     * @param _newGovernance New governance contract address
     */
    function updateGovernanceContract(address _newGovernance) external onlyGovernance {
        if (_newGovernance == address(0)) {
            revert InvalidAddress();
        }
        
        address oldGovernance = address(governanceContract);
        governanceContract = IPrivateGovernance(_newGovernance);
        
        emit GovernanceContractUpdated(oldGovernance, _newGovernance);
    }
}
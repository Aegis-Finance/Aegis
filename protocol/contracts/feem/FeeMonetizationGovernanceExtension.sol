// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "./../interfaces/ICommonErrors.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IPrivateGovernance} from "../interfaces/IPrivateGovernance.sol";
import {AGSFeeMonetization} from "./AGSFeeMonetization.sol";

/**
 * @title FeeMonetizationGovernanceExtension
 * @author Aegis Protocol Team
 * @dev Extends governance capabilities to manage FeeM revenue and incentivize participation
 * @notice This contract enables governance proposals for FeeM configuration and rewards
 *         active governance participants with S token incentives
 * @custom:security-contact security@aegisprotocol.com
 */
contract FeeMonetizationGovernanceExtension is AccessControl, ReentrancyGuard , ICommonErrors{
    using SafeERC20 for IERC20;

    // ============ CONSTANTS ============
    
    /// @notice Role for governance operations
    bytes32 public constant GOVERNANCE_ROLE = keccak256("GOVERNANCE_ROLE");
    
    /// @notice Role for proposal management
    bytes32 public constant PROPOSAL_MANAGER_ROLE = keccak256("PROPOSAL_MANAGER_ROLE");
    
    /// @notice Maximum basis points (100%)
    uint256 public constant MAX_BASIS_POINTS = 10000;
    
    /// @notice Minimum voting power required for FeeM proposals
    uint256 public constant MIN_FEEM_PROPOSAL_POWER = 100000 * 10**18; // 100k AGS tokens
    
    /// @notice Governance participation reward period (7 days)
    uint256 public constant REWARD_PERIOD = 7 days;

    // ============ STATE VARIABLES ============
    
    /// @notice AGS governance token contract
    IERC20 public immutable AGS_TOKEN;
    
    /// @notice Sonic S token contract
    IERC20 public immutable S_TOKEN;
    
    /// @notice Main governance contract
    IPrivateGovernance public governanceContract;
    
    /// @notice FeeM integration contract
    AGSFeeMonetization public feeMonetizationContract;
    
    /// @notice Treasury wallet for protocol development
    address public treasuryWallet;

    // ============ GOVERNANCE PARTICIPATION TRACKING ============
    
    /// @notice Governance participation rewards configuration
    struct ParticipationRewards {
        uint256 proposalSubmissionReward;  // S tokens for submitting proposals
        uint256 votingReward;              // S tokens per vote cast
        uint256 proposalPassReward;        // S tokens for successful proposals
        uint256 delegationReward;          // S tokens for delegation activities
        uint256 minimumVotingPower;        // Minimum power to earn rewards
    }
    
    /// @notice Current participation rewards configuration
    ParticipationRewards public participationRewards;
    
    /// @notice Governance participation tracking per address
    struct ParticipationData {
        uint256 proposalsSubmitted;
        uint256 votescast;
        uint256 successfulProposals;
        uint256 lastRewardClaim;
        uint256 totalRewardsEarned;
    }
    
    /// @notice Tracking governance participation per address
    mapping(address => ParticipationData) public participationData;
    
    /// @notice Tracking participation per period
    /// @notice Number of proposals submitted per period per address
    mapping(uint256 => mapping(address => uint256)) public periodProposals;
    /// @notice Number of votes cast per period per address
    mapping(uint256 => mapping(address => uint256)) public periodVotes;
    /// @notice Number of delegations per period per address
    mapping(uint256 => mapping(address => uint256)) public periodDelegations;
    
    /// @notice Reward period tracking
    struct RewardPeriodData {
        uint256 currentRewardPeriod;
        uint256 rewardPeriodStartTime;
        uint256 totalRewardsDistributed;
    }
    
    /// @notice Current reward period data
    RewardPeriodData public rewardPeriodData;

    // ============ FEEM PROPOSAL TYPES ============
    
    /// @notice Types of FeeM-related proposals
    enum FeeMProposalType {
        DISTRIBUTION_CONFIG,    // Change reward distribution percentages
        CONTRACT_ADDRESSES,     // Update contract addresses
        PARAMETERS,            // Update distribution parameters
        TREASURY_ALLOCATION,   // Allocate treasury funds
        FEEM_REGISTRATION      // Register/manage Sonic FeeM integration
    }
    
    /// @notice FeeM proposal tracking
    // solhint-disable-next-line gas-struct-packing
    struct FeeMProposal {
        bytes proposalData;            // Dynamic array (separate storage)
        uint256 governanceProposalId;  // Slot 1: 32 bytes
        uint256 submissionTime;        // Slot 2: 32 bytes  
        uint256 executionTime;         // Slot 3: 32 bytes
        address proposer;              // Slot 4: 20 bytes
        FeeMProposalType proposalType; // Slot 4: 1 byte (enum)
        bool executed;                 // Slot 4: 1 byte
    }
    
    /// @notice Mapping of FeeM proposals
    mapping(uint256 => FeeMProposal) public feeMProposals;
    /// @notice Next available FeeM proposal ID
    uint256 public nextFeeMProposalId;

    // ============ EVENTS ============
    
    /// @notice Emitted when a FeeM proposal is submitted
    /// @param feeMProposalId The unique identifier for the FeeM proposal
    /// @param governanceProposalId The corresponding governance proposal ID
    /// @param proposalType The type of FeeM proposal being submitted
    /// @param proposer The address of the account submitting the proposal
    event FeeMProposalSubmitted(
        uint256 indexed feeMProposalId,
        uint256 indexed governanceProposalId,
        FeeMProposalType indexed proposalType,
        address proposer
    );
    
    /// @notice Emitted when a FeeM proposal is executed
    /// @param feeMProposalId The unique identifier for the FeeM proposal
    /// @param governanceProposalId The corresponding governance proposal ID
    /// @param success Whether the proposal execution was successful
    event FeeMProposalExecuted(
        uint256 indexed feeMProposalId,
        uint256 indexed governanceProposalId,
        bool indexed success
    );
    
    /// @notice Emitted when participation rewards are claimed
    /// @param participant The address of the participant claiming rewards
    /// @param amount The amount of rewards claimed
    /// @param period The reward period for which rewards are claimed
    /// @param rewardType The type of reward being claimed
    event ParticipationRewardClaimed(
        address indexed participant,
        uint256 indexed amount,
        uint256 indexed period,
        string rewardType
    );
    
    /// @notice Emitted when participation rewards configuration is updated
    /// @param oldRewards The previous participation rewards configuration
    /// @param newRewards The new participation rewards configuration
    event ParticipationRewardsUpdated(
        ParticipationRewards oldRewards,
        ParticipationRewards newRewards
    );
    
    /// @notice Emitted when governance activity is recorded
    /// @param participant The address of the participant whose activity is recorded
    /// @param activityType The type of governance activity performed
    /// @param amount The amount or value associated with the activity
    /// @param period The reward period in which the activity occurred
    event GovernanceActivityRecorded(
        address indexed participant,
        string indexed activityType,
        uint256 indexed amount,
        uint256 period
    );
    
    /// @notice Emitted when the reward period is advanced
    /// @param oldPeriod The previous reward period number
    /// @param newPeriod The new reward period number
    /// @param timestamp The timestamp when the period was advanced
    event RewardPeriodAdvanced(
        uint256 indexed oldPeriod,
        uint256 indexed newPeriod,
        uint256 indexed timestamp
    );

    // ============ ERRORS ============

    // ============ CONSTRUCTOR ============
    
    /**
     * @notice Initialize the FeeM governance extension
     * @param _agsToken Address of AGS governance token
     * @param _sToken Address of Sonic S token
     * @param _governanceContract Address of governance contract
     * @param _treasuryWallet Address of treasury wallet
     */
    constructor(
        address _agsToken,
        address _sToken,
        address _governanceContract,
        address _treasuryWallet
    ) {
        if (_agsToken == address(0)) revert InvalidAddress();
        if (_sToken == address(0)) revert InvalidAddress();
        if (_governanceContract == address(0)) revert InvalidAddress();
        if (_treasuryWallet == address(0)) revert InvalidAddress();
        
        AGS_TOKEN = IERC20(_agsToken);
        S_TOKEN = IERC20(_sToken);
        governanceContract = IPrivateGovernance(_governanceContract);
        treasuryWallet = _treasuryWallet;
        
        // Grant roles only to governance contract
        _grantRole(DEFAULT_ADMIN_ROLE, _governanceContract);
        _grantRole(GOVERNANCE_ROLE, _governanceContract);
        _grantRole(PROPOSAL_MANAGER_ROLE, _governanceContract);
        
        // Initialize participation rewards
        participationRewards = ParticipationRewards({
            proposalSubmissionReward: 100 * 10**18,  // 100 S tokens
            votingReward: 10 * 10**18,               // 10 S tokens per vote
            proposalPassReward: 500 * 10**18,        // 500 S tokens for successful proposal
            delegationReward: 5 * 10**18,            // 5 S tokens for delegation
            minimumVotingPower: 1000 * 10**18        // 1000 AGS minimum
        });
        
        // Initialize reward period
        rewardPeriodData.currentRewardPeriod = 1;
        rewardPeriodData.rewardPeriodStartTime = block.timestamp;
    }

    // ============ GOVERNANCE INTEGRATION ============
    
    /**
     * @notice Set governance and FeeM contracts (governance only, one-time setup)
     * @param _governanceContract Address of the governance contract
     * @param _feeMonetizationContract Address of the fee monetization contract
     */
    function setContracts(
        address _governanceContract,
        address _feeMonetizationContract
    ) external onlyRole(GOVERNANCE_ROLE) {
        if (_governanceContract == address(0)) revert InvalidAddress();
        if (_feeMonetizationContract == address(0)) revert InvalidAddress();
        
        governanceContract = IPrivateGovernance(_governanceContract);
        feeMonetizationContract = AGSFeeMonetization(_feeMonetizationContract);
    }

    // ============ FEEM PROPOSAL MANAGEMENT ============
    
    /**
     * @notice Submit a FeeM-related governance proposal
     * @param proposalType Type of FeeM proposal
     * @param proposalData Encoded proposal data
     * @param title Proposal title
     * @param description Proposal description
     * @param targets Target contracts for execution
     * @param values ETH values for calls
     * @param calldatas Function call data
     * @param proposerCommitment ZK commitment of proposer
     * @param nullifier Nullifier for proposal
     * @param zkProof ZK proof for proposal submission
     * @return feeMProposalId The ID of the created FeeM proposal
     * @return governanceProposalId The ID of the created governance proposal
     */
    function submitFeeMProposal(
        FeeMProposalType proposalType,
        bytes memory proposalData,
        string memory title,
        string calldata description,
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        bytes32 proposerCommitment,
        bytes32 nullifier,
        bytes calldata zkProof
    ) public nonReentrant returns (uint256 feeMProposalId, uint256 governanceProposalId) {
        _validateFeeMProposal(proposalType);
        _updateRewardPeriodIfNeeded();
        
        // Submit to main governance
        governanceProposalId = governanceContract.submitProposal(
            IPrivateGovernance.ProposalParams({
                title: title,
                description: description,
                targets: targets,
                values: values,
                calldatas: calldatas,
                proposerCommitment: proposerCommitment,
                nullifier: nullifier,
                zkProof: zkProof
            })
        );
        
        // Create FeeM proposal record and track activity
        feeMProposalId = _createFeeMProposalRecord(governanceProposalId, proposalType, proposalData);
        _recordProposalActivity(feeMProposalId, governanceProposalId, proposalType);
        
        return (feeMProposalId, governanceProposalId);
    }
    
    /**
     * @notice Validate FeeM proposal requirements
     * @param proposalType Type of FeeM proposal to validate
     */
    function _validateFeeMProposal(FeeMProposalType proposalType) internal view {
        if (uint256(proposalType) > uint256(FeeMProposalType.FEEM_REGISTRATION)) {
            revert InvalidProposalType();
        }
        if (!governanceContract.hasVotingPower(msg.sender)) {
            revert InsufficientVotingPower();
        }
    }
    
    /**
     * @notice Create FeeM proposal record
     * @param governanceProposalId The governance proposal ID
     * @param proposalType Type of FeeM proposal
     * @param proposalData Encoded proposal data
     * @return feeMProposalId The created FeeM proposal ID
     */
    function _createFeeMProposalRecord(
        uint256 governanceProposalId,
        FeeMProposalType proposalType,
        bytes memory proposalData
    ) internal returns (uint256 feeMProposalId) {
        feeMProposalId = ++nextFeeMProposalId;
        feeMProposals[feeMProposalId] = FeeMProposal({
            governanceProposalId: governanceProposalId,
            proposalType: proposalType,
            proposalData: proposalData,
            proposer: msg.sender,
            submissionTime: block.timestamp,
            executed: false,
            executionTime: 0
        });
    }
    
    /**
     * @notice Record proposal activity and emit events
     * @param feeMProposalId The FeeM proposal ID
     * @param governanceProposalId The governance proposal ID
     * @param proposalType Type of FeeM proposal
     */
    function _recordProposalActivity(
        uint256 feeMProposalId,
        uint256 governanceProposalId,
        FeeMProposalType proposalType
    ) internal {
        ++participationData[msg.sender].proposalsSubmitted;
        ++periodProposals[rewardPeriodData.currentRewardPeriod][msg.sender];
        
        emit FeeMProposalSubmitted(feeMProposalId, governanceProposalId, proposalType, msg.sender);
        emit GovernanceActivityRecorded(msg.sender, "proposal", 1, rewardPeriodData.currentRewardPeriod);
    }
    
    /**
     * @notice Submit a FeeM registration proposal
     * @param shouldRegister Whether the contract should register with FeeM
     * @param description Description of the proposal
     * @param proposerCommitment Commitment hash for the proposer's identity
     * @param nullifier Nullifier to prevent double-spending of voting power
     * @param zkProof Zero-knowledge proof for proposal submission
     * @return feeMProposalId The ID of the created FeeM proposal
     * @return governanceProposalId The ID of the created governance proposal
     */
    function submitFeeMRegistrationProposal(
        bool shouldRegister,
        string calldata description,
        bytes32 proposerCommitment,
        bytes32 nullifier,
        bytes calldata zkProof
    ) external returns (uint256 feeMProposalId, uint256 governanceProposalId) {
        bytes memory proposalData = abi.encode(shouldRegister);
        
        // For registration proposals, provide a dummy action to satisfy governance requirements
        address[] memory targets = new address[](1);
        uint256[] memory values = new uint256[](1);
        bytes[] memory calldatas = new bytes[](1);
        
        // Use a harmless call to this contract's supportsInterface function as dummy action
        targets[0] = address(this);
        values[0] = 0;
        calldatas[0] = abi.encodeWithSelector(this.supportsInterface.selector, bytes4(0));
        
        return submitFeeMProposal(
            FeeMProposalType.FEEM_REGISTRATION,
            proposalData,
            "FeeM Registration Proposal",
            description,
            targets,
            values,
            calldatas,
            proposerCommitment,
            nullifier,
            zkProof
        );
    }
    
    /**
     * @notice Execute a successful FeeM proposal
     * @param feeMProposalId ID of the FeeM proposal to execute
     */
    function executeFeeMProposal(uint256 feeMProposalId) external nonReentrant {
        FeeMProposal storage proposal = feeMProposals[feeMProposalId];
        if (proposal.submissionTime == 0) revert ProposalNotFound();
        if (proposal.executed) revert ProposalAlreadyExecuted();
        
        // Check if governance proposal succeeded
        IPrivateGovernance.ProposalState state = governanceContract.getProposalState(proposal.governanceProposalId);
        if (state != IPrivateGovernance.ProposalState.SUCCEEDED && 
            state != IPrivateGovernance.ProposalState.EXECUTED) {
            revert ProposalNotFound();
        }
        
        // CHECKS-EFFECTS-INTERACTIONS pattern: Update state FIRST
        // Mark as executed BEFORE external calls to prevent reentrancy
        proposal.executed = true;
        proposal.executionTime = block.timestamp;
        
        // INTERACTIONS: Execute the proposal AFTER state update
        bool success = _executeFeeMProposal(proposal);
        
        // Reward successful proposal submitter (after execution)
        if (success) {
            ++participationData[proposal.proposer].successfulProposals;
            _distributeParticipationReward(
                proposal.proposer,
                participationRewards.proposalPassReward,
                "successful_proposal"
            );
        }
        
        emit FeeMProposalExecuted(feeMProposalId, proposal.governanceProposalId, success);
    }

    // ============ GOVERNANCE PARTICIPATION REWARDS ============
    
    /**
     * @notice Record voting activity for rewards
     * @param voter Address of the voter
     */
    function recordVotingActivity(address voter) external onlyRole(GOVERNANCE_ROLE) {
        _updateRewardPeriodIfNeeded();
        
        ++participationData[voter].votescast;
        ++periodVotes[rewardPeriodData.currentRewardPeriod][voter];
        
        // Distribute voting reward
        _distributeParticipationReward(voter, participationRewards.votingReward, "voting");
        
        emit GovernanceActivityRecorded(voter, "vote", 1, rewardPeriodData.currentRewardPeriod);
    }
    
    /**
     * @notice Record delegation activity for rewards
     * @param delegator Address of the delegator
     * @param delegatedPower Amount of power delegated
     */
    function recordDelegationActivity(address delegator, uint256 delegatedPower) external onlyRole(GOVERNANCE_ROLE) {
        _updateRewardPeriodIfNeeded();
        
        periodDelegations[rewardPeriodData.currentRewardPeriod][delegator] += delegatedPower;
        
        // Calculate delegation reward based on power
        uint256 reward = (delegatedPower * participationRewards.delegationReward) / (1000 * 10**18);
        _distributeParticipationReward(delegator, reward, "delegation");
        
        emit GovernanceActivityRecorded(delegator, "delegation", delegatedPower, rewardPeriodData.currentRewardPeriod);
    }
    
    /**
     * @notice Claim accumulated participation rewards
     */
    function claimParticipationRewards() external nonReentrant {
        address participant = msg.sender;
        uint256 currentTime = block.timestamp;
        
        // Check if participant has minimum voting power
        if (AGS_TOKEN.balanceOf(participant) < participationRewards.minimumVotingPower) {
            revert InsufficientVotingPower();
        }
        
        // Calculate claimable rewards
        uint256 claimableAmount = _calculateClaimableRewards(participant);
        if (claimableAmount == 0) revert NoRewardsToClaim();
        
        // Update claim timestamp
        participationData[participant].lastRewardClaim = currentTime;
        participationData[participant].totalRewardsEarned += claimableAmount;
        rewardPeriodData.totalRewardsDistributed += claimableAmount;
        
        // Transfer S tokens
        S_TOKEN.safeTransfer(participant, claimableAmount);
        
        emit ParticipationRewardClaimed(
            participant, 
            claimableAmount, 
            rewardPeriodData.currentRewardPeriod, 
            "participation"
        );
    }

    // ============ INTERNAL FUNCTIONS ============
    
    /**
     * @notice Execute a FeeM proposal based on its type
     * @param proposal The FeeM proposal to execute
     * @return success Whether the proposal execution was successful
     */
    function _executeFeeMProposal(FeeMProposal memory proposal) internal returns (bool) {
        if (proposal.proposalType == FeeMProposalType.DISTRIBUTION_CONFIG) {
            return _executeDistributionConfigProposal(proposal.proposalData);
        } else if (proposal.proposalType == FeeMProposalType.CONTRACT_ADDRESSES) {
            return _executeContractAddressProposal(proposal.proposalData);
        } else if (proposal.proposalType == FeeMProposalType.PARAMETERS) {
            return _executeParametersProposal(proposal.proposalData);
        } else if (proposal.proposalType == FeeMProposalType.TREASURY_ALLOCATION) {
            return _executeTreasuryAllocationProposal(proposal.proposalData);
        } else if (proposal.proposalType == FeeMProposalType.FEEM_REGISTRATION) {
            return _executeFeeMRegistrationProposal(proposal.proposalData);
        }
        return false;
    }
    
    /**
     * @notice Execute distribution config proposal
     * @param proposalData Encoded proposal data containing distribution config
     * @return success Whether the execution was successful
     */
    function _executeDistributionConfigProposal(bytes memory proposalData) internal returns (bool) {
        try this.decodeDistributionConfig(proposalData) returns (
            AGSFeeMonetization.DistributionConfig memory newConfig
        ) {
            feeMonetizationContract.updateDistributionConfig(
                newConfig.stakingRewards,
                newConfig.yieldFarmingRewards,
                newConfig.privacyRewards,
                newConfig.governanceIncentives,
                newConfig.treasuryFunds
            );
            return true;
        } catch {
            return false;
        }
    }
    
    /**
     * @notice Execute contract address proposal
     * @param proposalData Encoded proposal data containing contract addresses
     * @return success Whether the execution was successful
     */
    function _executeContractAddressProposal(bytes memory proposalData) internal returns (bool) {
        try this.decodeContractAddresses(proposalData) returns (
            address staking,
            address yieldFarming,
            address privacyRewards,
            address treasury
        ) {
            // CRITICAL: Pass governance contract address (stored in this contract) as the 4th parameter
            // The updateRewardContracts function signature is:
            // updateRewardContracts(_stakingContract, _yieldFarmingContract, _privacyRewardsContract, 
            // _governanceContract, _treasuryWallet)
            feeMonetizationContract.updateRewardContracts(
                staking, 
                yieldFarming, 
                privacyRewards, 
                address(governanceContract), 
                treasury
            );
            return true;
        } catch {
            return false;
        }
    }
    
    /**
     * @notice Execute parameters proposal
     * @param proposalData Encoded proposal data containing parameters
     * @return success Whether the execution was successful
     */
    function _executeParametersProposal(bytes memory proposalData) internal returns (bool) {
        try this.decodeParameters(proposalData) returns (
            uint256 interval,
            uint256 minimumAmount
        ) {
            feeMonetizationContract.updateDistributionParameters(interval, minimumAmount);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * @notice Execute treasury allocation proposal
     * @param proposalData Encoded proposal data containing allocation details
     * @return success Whether the treasury allocation was successful
     * @dev CRITICAL: Validates treasury wallet is configured and has sufficient approval
     *      Prevents arbitrary transferFrom by ensuring `from` is always the configured treasury wallet
     */
    function _executeTreasuryAllocationProposal(bytes memory proposalData) internal returns (bool) {
        try this.decodeTreasuryAllocation(proposalData) returns (
            address token,
            address to,
            uint256 amount
        ) {
            // CRITICAL SECURITY: Validate treasury wallet is configured (not arbitrary)
            if (treasuryWallet == address(0)) {
                return false;
            }
            
            // CRITICAL: Explicit treasury wallet variable to prevent arbitrary `from`
            address treasuryFrom = treasuryWallet; // Always the configured treasury wallet
            
            // Validate treasury has sufficient balance and approval
            IERC20 tokenContract = IERC20(token);
            uint256 treasuryBalance = tokenContract.balanceOf(treasuryFrom);
            if (treasuryBalance < amount) {
                return false;
            }
            
            uint256 allowance = tokenContract.allowance(treasuryFrom, address(this));
            if (allowance < amount) {
                return false;
            }
            
            // CRITICAL: Use SafeERC20 with explicit treasury wallet (never arbitrary `from`)
            // The `from` parameter is ALWAYS the configured treasury wallet, validated above
            // Slither warning is a false positive - treasuryFrom is validated and constrained to treasury wallet
            // slither-disable-next-line arbitrary-send-erc20
            tokenContract.safeTransferFrom(treasuryFrom, to, amount);
            return true;
        } catch {
            return false;
        }
    }
    
    /**
     * @notice Execute FeeM registration proposal
     * @param proposalData Encoded proposal data containing registration details
     * @return success Whether the FeeM registration was successful
     */
    function _executeFeeMRegistrationProposal(bytes memory proposalData) internal returns (bool) {
        try this.decodeFeeMRegistration(proposalData) returns (bool shouldRegister) {
            if (shouldRegister) {
                feeMonetizationContract.registerWithFeeM();
            }
            return true;
        } catch {
            return false;
        }
    }
    
    /**
     * @notice Distribute participation reward to user
     * @param participant The address of the participant receiving the reward
     * @param amount The amount of reward tokens to distribute
     * @param rewardType The type of reward being distributed
     */
    function _distributeParticipationReward(address participant, uint256 amount, string memory rewardType) internal {
        if (amount == 0) return;
        if (S_TOKEN.balanceOf(address(this)) < amount) return;
        
        S_TOKEN.safeTransfer(participant, amount);
        participationData[participant].totalRewardsEarned += amount;
        rewardPeriodData.totalRewardsDistributed += amount;
        
        emit ParticipationRewardClaimed(participant, amount, rewardPeriodData.currentRewardPeriod, rewardType);
    }
    
    /**
     * @notice Calculate claimable rewards for participant
     * @param participant Address of the participant
     * @return claimableAmount Total claimable reward amount
     */
    function _calculateClaimableRewards(address participant) internal view returns (uint256) {
        uint256 proposalRewards = periodProposals[rewardPeriodData.currentRewardPeriod][participant] * 
            participationRewards.proposalSubmissionReward;
        uint256 votingRewards = periodVotes[rewardPeriodData.currentRewardPeriod][participant] * 
            participationRewards.votingReward;
        uint256 delegationRewards = (periodDelegations[rewardPeriodData.currentRewardPeriod][participant] * 
            participationRewards.delegationReward) / (1000 * 10**18);
        
        return proposalRewards + votingRewards + delegationRewards;
    }
    
    /**
     * @notice Update reward period if needed
     */
    function _updateRewardPeriodIfNeeded() internal {
        if (block.timestamp > rewardPeriodData.rewardPeriodStartTime + REWARD_PERIOD) {
            uint256 oldPeriod = rewardPeriodData.currentRewardPeriod;
            ++rewardPeriodData.currentRewardPeriod;
            rewardPeriodData.rewardPeriodStartTime = block.timestamp;
            
            emit RewardPeriodAdvanced(oldPeriod, rewardPeriodData.currentRewardPeriod, block.timestamp);
        }
    }

    // ============ EXTERNAL DECODER FUNCTIONS ============
    
    /**
     * @notice Decode distribution config from proposal data
     * @param data Encoded proposal data
     * @return config Decoded distribution configuration
     */
    function decodeDistributionConfig(bytes calldata data) 
        external 
        pure 
        returns (AGSFeeMonetization.DistributionConfig memory) 
    {
        return abi.decode(data, (AGSFeeMonetization.DistributionConfig));
    }
    
    /**
     * @notice Decode contract addresses from proposal data
     * @param data Encoded proposal data
     * @return staking Address of staking contract
     * @return yieldFarming Address of yield farming contract
     * @return privacyRewards Address of privacy rewards contract
     * @return treasury Address of treasury contract
     */
    function decodeContractAddresses(bytes calldata data) external pure returns (address, address, address, address) {
        return abi.decode(data, (address, address, address, address));
    }
    
    /**
     * @notice Decode parameters from proposal data
     * @param data Encoded proposal data
     * @return interval Distribution interval parameter
     * @return minimumAmount Minimum amount parameter
     */
    function decodeParameters(bytes calldata data) external pure returns (uint256, uint256) {
        return abi.decode(data, (uint256, uint256));
    }
    
    /**
     * @notice Decode treasury allocation from proposal data
     * @param data Encoded proposal data
     * @return token Token address for allocation
     * @return recipient Recipient address for allocation
     * @return amount Amount to allocate
     */
    function decodeTreasuryAllocation(bytes calldata data) external pure returns (address, address, uint256) {
        return abi.decode(data, (address, address, uint256));
    }
    
    /**
     * @notice Decode FeeM registration proposal data
     * @param data Encoded proposal data
     * @return shouldRegister Whether to register with FeeM
     */
    function decodeFeeMRegistration(bytes calldata data) external pure returns (bool) {
        return abi.decode(data, (bool));
    }

    // ============ ADMIN FUNCTIONS ============
    
    /**
     * @notice Update participation rewards configuration (governance only)
     * @param newRewards New participation rewards configuration
     */
    function updateParticipationRewards(
        ParticipationRewards calldata newRewards
    ) external onlyRole(GOVERNANCE_ROLE) {
        if (newRewards.minimumVotingPower == 0) revert InvalidRewardConfiguration();
        
        ParticipationRewards memory oldRewards = participationRewards;
        participationRewards = newRewards;
        
        emit ParticipationRewardsUpdated(oldRewards, newRewards);
    }
    
    /**
     * @notice Fund participation rewards pool (governance only)
     * @param amount Amount of tokens to fund the rewards pool
     */
    function fundParticipationRewards(uint256 amount) external onlyRole(GOVERNANCE_ROLE) {
        S_TOKEN.safeTransferFrom(msg.sender, address(this), amount);
    }

    // ============ VIEW FUNCTIONS ============
    
    /**
     * @notice Get FeeM proposal details
     * @param feeMProposalId ID of the FeeM proposal
     * @return proposal The FeeM proposal details
     */
    function getFeeMProposal(uint256 feeMProposalId) external view returns (FeeMProposal memory) {
        return feeMProposals[feeMProposalId];
    }
    
    /**
     * @notice Get participation statistics for address
     * @param participant Address to get statistics for
     * @return proposals Number of proposals submitted
     * @return votes Number of votes cast
     * @return successful Number of successful proposals
     * @return totalRewards Total rewards earned
     * @return claimableRewards Currently claimable rewards
     */
    function getParticipationStats(address participant) external view returns (
        uint256 proposals,
        uint256 votes,
        uint256 successful,
        uint256 totalRewards,
        uint256 claimableRewards
    ) {
        return (
            participationData[participant].proposalsSubmitted,
            participationData[participant].votescast,
            participationData[participant].successfulProposals,
            participationData[participant].totalRewardsEarned,
            _calculateClaimableRewards(participant)
        );
    }
    
    /**
     * @notice Get current reward period info
     * @return period Current reward period number
     * @return startTime Start time of current period
     * @return endTime End time of current period
     */
    function getCurrentRewardPeriod() external view returns (uint256 period, uint256 startTime, uint256 endTime) {
        return (
            rewardPeriodData.currentRewardPeriod, 
            rewardPeriodData.rewardPeriodStartTime, 
            rewardPeriodData.rewardPeriodStartTime + REWARD_PERIOD
        );
    }
}
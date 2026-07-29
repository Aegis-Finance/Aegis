// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IPrivateGovernance} from "../interfaces/IPrivateGovernance.sol";
import {ICommonErrors} from "../interfaces/ICommonErrors.sol";

/**
 * @title AGSFeeMonetization
 * @author Aegis Protocol Team
 * @dev Integrates Sonic's Fee Monetization (FeeM) with AGS DAO reward system
 * @notice This contract collects 90% of network fees from AGS ecosystem apps
 *         and redistributes them to stakers, yield farmers, and governance participants.
 *         Governance-incentive S tokens accrue in-contract (`governanceIncentivesReserved`) and can be
 *         withdrawn by governance via `withdrawGovernanceIncentives`.
 *         Deployment order and Sonic FeeM integration are documented in `contracts/feem/README.md`.
 * @custom:security-contact security@aegisprotocol.com
 */
contract AGSFeeMonetization is AccessControl, ReentrancyGuard, ICommonErrors {
    using SafeERC20 for IERC20;

    // ============ CONSTANTS ============
    
    /// @notice Role for fee collection operations (only governance)
    bytes32 public constant FEE_COLLECTOR_ROLE = keccak256("FEE_COLLECTOR_ROLE");
    
    /// @notice Role for distribution management (only governance)
    bytes32 public constant DISTRIBUTION_MANAGER_ROLE = keccak256("DISTRIBUTION_MANAGER_ROLE");
    
    /// @notice Role for governance operations (only governance)
    bytes32 public constant GOVERNANCE_ROLE = keccak256("GOVERNANCE_ROLE");
    
    /// @notice Maximum basis points (100%)
    uint256 public constant MAX_BASIS_POINTS = 10000;
    
    /// @notice Basis points for percentage calculations (same as MAX_BASIS_POINTS)
    uint256 public constant BASIS_POINTS = 10000;
    
    /// @notice Minimum distribution interval (1 hour)
    uint256 public constant MIN_DISTRIBUTION_INTERVAL = 1 hours;
    
    /// @notice Maximum distribution interval (7 days)
    uint256 public constant MAX_DISTRIBUTION_INTERVAL = 7 days;

    /// @notice Sonic FeeM registrar for `selfRegister` (per-chain; constructor or `setFeeMRegistrationTarget`).
    ///         On Sonic mainnet: Projects’ Contracts Registrar — `selfRegister(uint256 feeMProjectId)`.
    address public feemRegistry;

    /// @notice FeeM project id (`uint256`) from Sonic dashboard / ProjectsRegistrar (argument to `selfRegister`).
    ///         Sonic docs call this the FeeM Project ID (storage name `feemCategory` kept for compatibility).
    uint256 public feemCategory;

    // ============ STATE VARIABLES ============
    
    /// @notice Sonic S token contract (received from FeeM)
    IERC20 public immutable S_TOKEN;
    
    /// @notice AGS governance token contract
    IERC20 public immutable AGS_TOKEN;
    
    /// @notice Governance contract for proposal-based changes
    IPrivateGovernance public governanceContract;
    
    /// @notice Treasury wallet for protocol development
    address public treasuryWallet;
    
    /// @notice Staking contract for reward distribution
    address public stakingContract;
    
    /// @notice Yield farming contract for reward distribution
    address public yieldFarmingContract;
    
    /// @notice Privacy rewards contract for reward distribution
    address public privacyRewardsContract;
    
    /// @notice Whether this contract is registered with Sonic FeeM
    bool public isFeeMRegistered;

    // ============ DISTRIBUTION CONFIGURATION ============
    
    /// @notice Distribution percentages in basis points
    struct DistributionConfig {
        uint256 stakingRewards;      // % to staking contract
        uint256 yieldFarmingRewards; // % to yield farming contract
        uint256 privacyRewards;      // % to privacy mining contract
        uint256 treasuryFunds;       // % to treasury for development
        uint256 governanceIncentives; // % for governance participation
    }
    
    /// @notice Current distribution configuration
    DistributionConfig public distributionConfig;
    
    /// @notice Interval between automatic distributions
    uint256 public distributionInterval;
    
    /// @notice Timestamp of last distribution
    uint256 public lastDistributionTime;
    
    /// @notice Minimum S token amount to trigger distribution
    uint256 public minimumDistributionAmount;

    // ============ FEE TRACKING ============
    
    /// @notice Total S tokens collected from FeeM
    uint256 public totalFeesCollected;
    
    /// @notice Cumulative S tokens sent out of this contract via `_distributeFees` (staking, yield, privacy, treasury only).
    ///         The governance-incentive slice stays in this contract and is not added to this counter.
    uint256 public totalFeesDistributed;

    /// @notice S token balance notionally earmarked for governance incentives (incremented each distribution; reduced on withdrawal).
    uint256 public governanceIncentivesReserved;
    
    /// @notice Fees collected per epoch
    mapping(uint256 => uint256) public epochFees;
    
    /// @notice Current epoch number
    uint256 public currentEpoch;
    
    /// @notice Epoch duration (24 hours)
    uint256 public constant EPOCH_DURATION = 24 hours;
    
    /// @notice Epoch start time
    uint256 public epochStartTime;

    // ============ EVENTS ============
    
    /**
     * @notice Emitted when fees are collected from the network
     * @param epoch The current epoch when fees were collected
     * @param amount The amount of fees collected
     * @param collector The address that collected the fees
     * @param timestamp The timestamp when fees were collected
     */
    event FeesCollected(
        uint256 indexed epoch,
        uint256 indexed amount,
        address indexed collector,
        uint256 timestamp
    );
    
    /**
     * @notice Emitted when collected fees are distributed to various reward contracts
     * @param epoch The current epoch when fees were distributed
     * @param totalAmount The total amount of fees distributed
     * @param stakingAmount The amount allocated to staking rewards
     * @param yieldFarmingAmount The amount allocated to yield farming rewards
     * @param privacyAmount The amount allocated to privacy/governance rewards
     * @param treasuryAmount The amount allocated to treasury
     * @param governanceAmount The amount allocated to governance rewards
     */
    event FeesDistributed(
        uint256 indexed epoch,
        uint256 indexed totalAmount,
        uint256 indexed stakingAmount,
        uint256 yieldFarmingAmount,
        uint256 privacyAmount,
        uint256 treasuryAmount,
        uint256 governanceAmount
    );
    
    /**
     * @notice Emitted when the fee distribution configuration is updated
     * @param oldConfig The previous distribution configuration
     * @param newConfig The new distribution configuration
     */
    event DistributionConfigUpdated(
        DistributionConfig oldConfig,
        DistributionConfig newConfig
    );
    
    /**
     * @notice Emitted when a contract address is updated
     * @param contractType The type of contract being updated
     * @param oldAddress The previous contract address
     * @param newAddress The new contract address
     */
    event ContractAddressUpdated(
        string indexed contractType,
        address indexed oldAddress,
        address indexed newAddress
    );
    
    /**
     * @notice Emitted when the epoch is advanced
     * @param oldEpoch The previous epoch number
     * @param newEpoch The new epoch number
     * @param timestamp The timestamp when the epoch was advanced
     */
    event EpochAdvanced(
        uint256 indexed oldEpoch,
        uint256 indexed newEpoch,
        uint256 indexed timestamp
    );
    
    /**
     * @notice Emitted when the Fee Monetization registration status is updated
     * @param isRegistered Whether the contract is registered for fee monetization
     * @param registryContract The address of the registry contract
     * @param category The FeeM **project id** used in `selfRegister(uint256)` (Sonic naming: FeeM Project ID)
     */
    event FeeMRegistrationUpdated(
        bool indexed isRegistered,
        address indexed registryContract,
        uint256 indexed category
    );

    /**
     * @notice Emitted when governance sets the FeeM registrar + **project id** (one-time if deployed with placeholders)
     * @param registry Projects’ Contracts Registrar used for `selfRegister`
     * @param category Sonic FeeM **project id** for `selfRegister(uint256)`
     */
    event FeeMRegistrationTargetSet(address indexed registry, uint256 category);

    /**
     * @notice Emitted when reward contract addresses are updated
     * @param stakingContract The new staking contract address
     * @param yieldFarmingContract The new yield farming contract address
     * @param governanceContract The new governance contract address
     * @param treasuryWallet The new treasury wallet address
     */
    event RewardContractsUpdated(
        address indexed stakingContract,
        address indexed yieldFarmingContract,
        address indexed privacyRewardsContract,
        address governanceContract,
        address treasuryWallet
    );

    /**
     * @notice Emitted when governance withdraws S tokens from the governance-incentive reserve
     * @param to Recipient of S tokens
     * @param amount Amount of S tokens transferred
     */
    event GovernanceIncentivesWithdrawn(address indexed to, uint256 amount);

    // ============ ERRORS ============

    /// @notice Withdrawal amount exceeds tracked governance-incentive reserve
    error GovernanceWithdrawalExceedsReserved();

    /// @notice FeeM registry/category not configured yet (`feemRegistry` is zero)
    error FeeMRegistrationTargetNotSet();

    /// @notice FeeM registry already configured (use one `setFeeMRegistrationTarget` before first `registerWithFeeM`)
    error FeeMRegistrationTargetAlreadySet();

    // ============ CONSTRUCTOR ============
    
    /**
     * @notice Initialize the FeeM integration contract
     * @param _agsToken Address of AGS governance token
     * @param _sToken Address of Sonic S token
     * @param _governanceContract Address of the governance contract
     * @param _feemRegistry Projects’ Contracts Registrar for FeeM `selfRegister`, or `address(0)` to defer.
     *        Sonic apply doc: https://docs.soniclabs.com/funding/fee-monetization/apply
     * @param _feemCategory FeeM project id for `selfRegister(uint256)`; ignored if `_feemRegistry` is zero.
     */
    constructor(
        address _agsToken,
        address _sToken,
        address _governanceContract,
        address _feemRegistry,
        uint256 _feemCategory
    ) {
        if (_agsToken == address(0)) revert InvalidAddress();
        if (_sToken == address(0)) revert InvalidAddress();
        if (_governanceContract == address(0)) revert InvalidAddress();

        if (_feemRegistry != address(0)) {
            feemRegistry = _feemRegistry;
            feemCategory = _feemCategory;
            emit FeeMRegistrationTargetSet(_feemRegistry, _feemCategory);
        }
        AGS_TOKEN = IERC20(_agsToken);
        S_TOKEN = IERC20(_sToken);
        governanceContract = IPrivateGovernance(_governanceContract);

        // Grant roles only to governance contract
        _grantRole(DEFAULT_ADMIN_ROLE, _governanceContract);
        _grantRole(FEE_COLLECTOR_ROLE, _governanceContract);
        _grantRole(DISTRIBUTION_MANAGER_ROLE, _governanceContract);
        _grantRole(GOVERNANCE_ROLE, _governanceContract);
        
        // Initialize distribution config (can be updated by governance)
        distributionConfig = DistributionConfig({
            stakingRewards: 3000,      // 30%
            yieldFarmingRewards: 2500, // 25%
            privacyRewards: 2000,      // 20%
            treasuryFunds: 1500,       // 15%
            governanceIncentives: 1000 // 10%
        });
        
        // Initialize timing
        distributionInterval = 24 hours; // Daily distributions
        minimumDistributionAmount = 1000 * 10**18; // 1000 S tokens
        epochStartTime = block.timestamp;
        currentEpoch = 1;
        lastDistributionTime = block.timestamp;
        
        // CRITICAL: Initialize all state variables to prevent uninitialized variable warnings
        // These can be set later via governance functions
        privacyRewardsContract = address(0); // Explicit initialization
        stakingContract = address(0);
        yieldFarmingContract = address(0);
        treasuryWallet = address(0);
    }

    // ============ SONIC FEEM REGISTRATION ============

    /**
     * @notice One-time configuration of FeeM registrar + **project id** (deploy before Sonic assigns values)
     * @param _registry Projects’ Contracts Registrar (`selfRegister` target). Canonical addresses: `docs/SONIC_CANONICAL_DATA.md`.
     * @param _category Sonic FeeM **project id** passed to `selfRegister(uint256)`
     */
    function setFeeMRegistrationTarget(address _registry, uint256 _category) external onlyRole(GOVERNANCE_ROLE) {
        if (feemRegistry != address(0)) revert FeeMRegistrationTargetAlreadySet();
        if (_registry == address(0)) revert InvalidAddress();
        feemRegistry = _registry;
        feemCategory = _category;
        emit FeeMRegistrationTargetSet(_registry, _category);
    }

    /**
     * @notice Register this contract with Sonic FeeM (`selfRegister` on `feemRegistry`)
     * @dev After Sonic onboarding per https://docs.soniclabs.com/funding/fee-monetization — configure
     *      registry via constructor or `setFeeMRegistrationTarget` first.
     */
    function registerWithFeeM() external onlyRole(GOVERNANCE_ROLE) {
        if (feemRegistry == address(0)) revert FeeMRegistrationTargetNotSet();
        if (isFeeMRegistered) revert FeeMRegistrationFailed();
        
        // CHECKS-EFFECTS-INTERACTIONS pattern: Update state BEFORE external call
        // Mark as registered BEFORE external call to prevent reentrancy
        isFeeMRegistered = true;
        
        // INTERACTIONS: External call AFTER state update (CEI pattern)
        // Call Sonic FeeM registry to register this contract
        // Low-level call is necessary as we don't have the interface for the registry
        // This is safe as we're only calling a known registry with a specific function
        (bool success, ) = feemRegistry.call(abi.encodeWithSignature("selfRegister(uint256)", feemCategory));
        
        // If registration fails, revert (which will undo isFeeMRegistered = true)
        if (!success) {
            revert FeeMRegistrationFailed();
        }
        
        emit FeeMRegistrationUpdated(true, feemRegistry, feemCategory);
    }
    
    /**
     * @notice True if `registerWithFeeM` completed successfully
     * @return bool Registration status
     */
    function getFeeMRegistrationStatus() external view returns (bool) {
        return isFeeMRegistered;
    }

    // ============ FEE COLLECTION ============
    
    /**
     * @notice Pull S tokens into this contract and account them as collected protocol fees
     * @dev Does **not** perform Sonic’s FeeM claim/oracle step. The usual pattern is: FeeM releases S to
     *      a collector or recipient (per Sonic docs), then an address with `FEE_COLLECTOR_ROLE` calls
     *      `collectFees` to `transferFrom` that balance into this contract for `_distributeFees`.
     *      See `contracts/feem/README.md` for the full deployment and wiring checklist.
     * @param amount Amount of S tokens collected as fees
     */
    function collectFees(uint256 amount) 
        external 
        onlyRole(FEE_COLLECTOR_ROLE) 
        nonReentrant 
    {
        if (amount == 0) revert InvalidAmount();
        
        // Update epoch if needed
        _updateEpochIfNeeded();
        
        // Record fee collection
        epochFees[currentEpoch] += amount;
        totalFeesCollected += amount;
        
        // Transfer S tokens to this contract
        S_TOKEN.safeTransferFrom(msg.sender, address(this), amount);
        
        emit FeesCollected(currentEpoch, amount, msg.sender, block.timestamp);
        
        // Auto-distribute if conditions are met
        if (_shouldAutoDistribute()) {
            _distributeFees();
        }
    }
    
    /**
     * @notice Manual fee distribution trigger
     * @dev Can be called by distribution manager or governance
     */
    function distributeFees() external onlyRole(DISTRIBUTION_MANAGER_ROLE) nonReentrant {
        _distributeFees();
    }

    // ============ INTERNAL DISTRIBUTION LOGIC ============
    
    /**
     * @notice Internal function to distribute collected fees
     */
    function _distributeFees() internal {
        uint256 availableBalance = S_TOKEN.balanceOf(address(this));
        if (availableBalance < minimumDistributionAmount) revert InsufficientBalance();
        
        // Calculate distribution amounts
        uint256 stakingAmount = (availableBalance * distributionConfig.stakingRewards) / MAX_BASIS_POINTS;
        uint256 yieldFarmingAmount = (availableBalance * distributionConfig.yieldFarmingRewards) / MAX_BASIS_POINTS;
        uint256 privacyAmount = (availableBalance * distributionConfig.privacyRewards) / MAX_BASIS_POINTS;
        uint256 treasuryAmount = (availableBalance * distributionConfig.treasuryFunds) / MAX_BASIS_POINTS;
        uint256 governanceAmount = (availableBalance * distributionConfig.governanceIncentives) / MAX_BASIS_POINTS;
        
        // Distribute to staking contract
        if (stakingAmount > 0 && stakingContract != address(0)) {
            S_TOKEN.safeTransfer(stakingContract, stakingAmount);
        }
        
        // Distribute to yield farming contract
        if (yieldFarmingAmount > 0 && yieldFarmingContract != address(0)) {
            S_TOKEN.safeTransfer(yieldFarmingContract, yieldFarmingAmount);
        }
        
        // Distribute to privacy rewards contract
        if (privacyAmount > 0 && privacyRewardsContract != address(0)) {
            S_TOKEN.safeTransfer(privacyRewardsContract, privacyAmount);
        }
        
        // Distribute to treasury
        if (treasuryAmount > 0) {
            S_TOKEN.safeTransfer(treasuryWallet, treasuryAmount);
        }
        
        // Keep governance incentives in this contract for governance participants
        // (Can be claimed through governance proposals)
        governanceIncentivesReserved += governanceAmount;

        // Update tracking: only count S tokens that actually left this contract.
        // The governance slice remains here; counting it as "distributed" would misstate outflows.
        unchecked {
            totalFeesDistributed += stakingAmount + yieldFarmingAmount + privacyAmount + treasuryAmount;
        }
        lastDistributionTime = block.timestamp;
        
        emit FeesDistributed(
            currentEpoch,
            availableBalance,
            stakingAmount,
            yieldFarmingAmount,
            privacyAmount,
            treasuryAmount,
            governanceAmount
        );
    }
    
    /**
     * @notice Withdraw S tokens that were allocated to the governance-incentive bucket by past distributions
     * @dev Decrements `governanceIncentivesReserved`; cannot withdraw more than tracked reserve
     * @param to Recipient (typically governance treasury or distributor)
     * @param amount Amount of S tokens to transfer
     */
    function withdrawGovernanceIncentives(address to, uint256 amount)
        external
        onlyRole(GOVERNANCE_ROLE)
        nonReentrant
    {
        if (to == address(0)) revert InvalidAddress();
        if (amount == 0) revert ZeroAmount();
        if (amount > governanceIncentivesReserved) revert GovernanceWithdrawalExceedsReserved();
        governanceIncentivesReserved -= amount;
        S_TOKEN.safeTransfer(to, amount);
        emit GovernanceIncentivesWithdrawn(to, amount);
    }

    /**
     * @notice Check if automatic distribution conditions are met
     * @return True if enough time has passed and minimum balance is available
     */
    function _shouldAutoDistribute() internal view returns (bool) {
        return (
            block.timestamp >= lastDistributionTime + distributionInterval &&
            S_TOKEN.balanceOf(address(this)) >= minimumDistributionAmount
        );
    }
    
    /**
     * @notice Update epoch if 24 hours have passed
     */
    function _updateEpochIfNeeded() internal {
        if (block.timestamp >= epochStartTime + EPOCH_DURATION) {
            uint256 oldEpoch = currentEpoch;
            ++currentEpoch;
            epochStartTime = block.timestamp;
            
            emit EpochAdvanced(oldEpoch, currentEpoch, block.timestamp);
        }
    }

    // ============ GOVERNANCE FUNCTIONS ============
    
    /**
     * @notice Update distribution configuration
     * @param _stakingAllocation New staking allocation (basis points)
     * @param _yieldFarmingAllocation New yield farming allocation (basis points)
     * @param _privacyAllocation New privacy rewards allocation (basis points)
     * @param _governanceAllocation New governance allocation (basis points)
     * @param _treasuryAllocation New treasury allocation (basis points)
     */
    function updateDistributionConfig(
        uint256 _stakingAllocation,
        uint256 _yieldFarmingAllocation,
        uint256 _privacyAllocation,
        uint256 _governanceAllocation,
        uint256 _treasuryAllocation
    ) external onlyRole(GOVERNANCE_ROLE) {
        if (
            _stakingAllocation + _yieldFarmingAllocation + _privacyAllocation + 
            _governanceAllocation + _treasuryAllocation != BASIS_POINTS
        ) {
            revert InvalidAllocation();
        }
        
        DistributionConfig memory oldConfig = distributionConfig;
        
        distributionConfig.stakingRewards = _stakingAllocation;
        distributionConfig.yieldFarmingRewards = _yieldFarmingAllocation;
        distributionConfig.privacyRewards = _privacyAllocation;
        distributionConfig.governanceIncentives = _governanceAllocation;
        distributionConfig.treasuryFunds = _treasuryAllocation;
        
        emit DistributionConfigUpdated(oldConfig, distributionConfig);
    }
    
    /**
     * @notice Update reward contract addresses
     * @param _stakingContract New staking contract address
     * @param _yieldFarmingContract New yield farming contract address
     * @param _privacyRewardsContract New privacy rewards contract address (can be address(0) if not set)
     * @param _governanceContract New governance contract address
     * @param _treasuryWallet New treasury wallet address
     */
    function updateRewardContracts(
        address _stakingContract,
        address _yieldFarmingContract,
        address _privacyRewardsContract,
        address _governanceContract,
        address _treasuryWallet
    ) external onlyRole(GOVERNANCE_ROLE) {
        if (_stakingContract == address(0)) revert InvalidAddress();
        if (_yieldFarmingContract == address(0)) revert InvalidAddress();
        // privacyRewardsContract can be address(0) - it's optional
        if (_governanceContract == address(0)) revert InvalidAddress();
        if (_treasuryWallet == address(0)) revert InvalidAddress();
        
        stakingContract = _stakingContract;
        yieldFarmingContract = _yieldFarmingContract;
        privacyRewardsContract = _privacyRewardsContract; // Can be address(0)
        governanceContract = IPrivateGovernance(_governanceContract);
        treasuryWallet = _treasuryWallet;
        
        emit RewardContractsUpdated(_stakingContract, _yieldFarmingContract, _privacyRewardsContract, _governanceContract, _treasuryWallet);
    }
    
    /**
     * @notice Update distribution parameters (governance only)
     * @param _distributionInterval The new distribution interval in seconds
     * @param _minimumDistributionAmount The new minimum amount required for distribution
     */
    function updateDistributionParameters(
        uint256 _distributionInterval,
        uint256 _minimumDistributionAmount
    ) external onlyRole(GOVERNANCE_ROLE) {
        if (_distributionInterval < MIN_DISTRIBUTION_INTERVAL || 
            _distributionInterval > MAX_DISTRIBUTION_INTERVAL) {
            revert InvalidInterval();
        }
        
        distributionInterval = _distributionInterval;
        minimumDistributionAmount = _minimumDistributionAmount;
    }
    
    /**
     * @notice Set governance contract (governance only, one-time setup)
     * @param _governanceContract The address of the new governance contract
     */
    function setGovernanceContract(address _governanceContract) external onlyRole(GOVERNANCE_ROLE) {
        if (_governanceContract == address(0)) revert InvalidAddress();
        governanceContract = IPrivateGovernance(_governanceContract);
        emit ContractAddressUpdated("governance", address(governanceContract), _governanceContract);
    }

    // ============ VIEW FUNCTIONS ============
    
    /**
     * @notice Get current fee collection statistics
     * @return totalCollected The total amount of fees collected
     * @return totalDistributed The total amount of fees distributed
     * @return currentBalance The current S token balance in the contract
     * @return currentEpochFees The fees collected in the current epoch
     * @return epoch The current epoch number
     */
    function getFeeStatistics() external view returns (
        uint256 totalCollected,
        uint256 totalDistributed,
        uint256 currentBalance,
        uint256 currentEpochFees,
        uint256 epoch
    ) {
        return (
            totalFeesCollected,
            totalFeesDistributed,
            S_TOKEN.balanceOf(address(this)),
            epochFees[currentEpoch],
            currentEpoch
        );
    }
    
    /**
     * @notice Get distribution configuration
     * @return The current distribution configuration struct
     */
    function getDistributionConfig() external view returns (DistributionConfig memory) {
        return distributionConfig;
    }
    
    /**
     * @notice Check if distribution is ready
     * @return True if distribution conditions are met, false otherwise
     */
    function isDistributionReady() external view returns (bool) {
        return _shouldAutoDistribute();
    }
    
    /**
     * @notice Get time until next distribution
     * @return The number of seconds until the next distribution, or 0 if ready now
     */
    function timeUntilNextDistribution() external view returns (uint256) {
        uint256 nextDistributionTime = lastDistributionTime + distributionInterval;
        if (block.timestamp >= nextDistributionTime) {
            return 0;
        }
        return nextDistributionTime - block.timestamp;
    }

    // ============ EMERGENCY FUNCTIONS ============

    /**
     * @notice Emergency token recovery (governance only)
     * @dev Can only recover tokens other than S_TOKEN and AGS_TOKEN
     * @param token The address of the token to recover
     * @param to The address to send the recovered tokens to
     * @param amount The amount of tokens to recover
     */
    function emergencyTokenRecovery(
        address token,
        address to,
        uint256 amount
    ) external onlyRole(GOVERNANCE_ROLE) {
        if (token == address(S_TOKEN) || token == address(AGS_TOKEN)) {
            revert UnauthorizedCaller();
        }
        if (to == address(0)) revert InvalidAddress();
        if (amount == 0) revert ZeroAmount();

        IERC20(token).safeTransfer(to, amount);
    }
}
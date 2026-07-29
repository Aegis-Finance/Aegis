// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "../interfaces/ICommonErrors.sol";
import "./AegisCrowdShield.sol";
import "./VoluntaryCampaignManager.sol";

/**
 * @title SoundMoneyEscrow
 * @dev Secure escrow system implementing Austrian Economics sound money principles:
 *      - Sound Money: Transparent, auditable fund management
 *      - Individual Sovereignty: Creator and contributor control over funds
 *      - Voluntary Exchange: Consensual fund release mechanisms
 *      - Market-Driven Pricing: Dynamic fee structures based on market conditions
 *      - Time Preference: Interest and time-based fund management
 */
contract SoundMoneyEscrow is ReentrancyGuard, ICommonErrors {
    using SafeERC20 for IERC20;
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    struct EscrowAccount {
        uint256 campaignId;             // Associated campaign
        address creator;                // Campaign creator
        address paymentToken;           // Token address (address(0) for ETH)
        uint256 totalDeposited;         // Total funds deposited
        uint256 totalWithdrawn;         // Total funds withdrawn
        uint256 totalRefunded;          // Total funds refunded
        uint256 lockedAmount;           // Amount locked for milestones
        uint256 availableAmount;        // Amount available for withdrawal
        uint256 lastInterestUpdate;     // Last interest calculation time
        uint256 accruedInterest;        // Accrued interest amount
        bool isActive;                  // Whether escrow is active
        EscrowConfig config;            // Escrow configuration
    }

    struct EscrowConfig {
        bool enableInterestAccrual;     // Whether to accrue interest
        bool enableTimeBasedRelease;    // Time-based automatic release
        bool enableMilestoneEscrow;     // Milestone-based fund release
        bool enableEmergencyWithdraw;   // Emergency withdrawal capability
        uint256 interestRate;           // Annual interest rate (basis points)
        uint256 releaseDelay;           // Delay before funds can be released
        uint256 emergencyDelay;         // Delay for emergency withdrawals
        uint256 maxLockPeriod;          // Maximum lock period for funds
    }

    struct FundLock {
        uint256 amount;                 // Locked amount
        uint256 unlockTime;             // When funds can be unlocked
        uint256 milestoneId;            // Associated milestone (0 if not milestone-based)
        address beneficiary;            // Who can unlock the funds
        LockReason reason;              // Reason for lock
        bool isUnlocked;                // Whether funds have been unlocked
    }

    struct InterestCalculation {
        uint256 principal;              // Principal amount
        uint256 rate;                   // Interest rate (basis points)
        uint256 startTime;              // Interest calculation start time
        uint256 endTime;                // Interest calculation end time
        uint256 compoundingPeriod;      // Compounding period in seconds
    }

    enum LockReason {
        Milestone,          // Locked for milestone completion
        Dispute,            // Locked due to dispute
        TimeDelay,          // Locked for time-based release
        Emergency,          // Emergency lock
        Governance          // Governance-imposed lock
    }

    // Custom Errors

    error OnlyCrowdShieldCanDeposit();
    error AmountMustBePositive();
    error MilestoneEscrowDisabled();
    error InsufficientAvailableFunds();
    error InvalidUnlockTime();
    error InvalidLockIndex();
    error FundsAlreadyUnlocked();
    error NotMilestoneLock();
    error LockPeriodNotExpired();
    
    error ReleaseDelayNotMet();
    error ETHTransferFailed();
    error ETHRefundFailed();
    error NoFundsToRefund();
    error RefundNotAvailable();
    error EmergencyWithdrawalDisabled();
    error EscrowFeeTooHigh();
    error InterestFeeTooHigh();
    error EmergencyFeeTooHigh();

    // State Variables
    AegisCrowdShield public immutable crowdShield;
    VoluntaryCampaignManager public immutable campaignManager;
    
    mapping(uint256 => EscrowAccount) public escrowAccounts;
    mapping(uint256 => FundLock[]) public campaignLocks;
    mapping(uint256 => mapping(address => uint256)) public contributorBalances;
    mapping(address => uint256[]) public creatorEscrows;
    mapping(address => uint256[]) public contributorEscrows;
    
    // Austrian Economics Parameters
    uint256 public constant BASIS_POINTS = 10000;
    uint256 public constant MINIMUM_INTEREST_RATE = 0;        // 0% minimum
    uint256 public constant MAXIMUM_INTEREST_RATE = 2000;     // 20% maximum
    uint256 public constant MINIMUM_RELEASE_DELAY = 1 days;
    uint256 public constant MAXIMUM_RELEASE_DELAY = 90 days;
    uint256 public constant EMERGENCY_DELAY = 7 days;
    uint256 public constant COMPOUNDING_PERIOD = 1 days;      // Daily compounding
    
    // Market-driven fee structure
    uint256 public escrowFeeRate = 50;                        // 0.5% escrow fee
    uint256 public interestFeeRate = 1000;                    // 10% of interest earned
    uint256 public emergencyFeeRate = 200;                    // 2% emergency withdrawal fee

    // Events
    event EscrowCreated(
        uint256 indexed campaignId,
        address indexed creator,
        address paymentToken,
        EscrowConfig config
    );
    
    event FundsDeposited(
        uint256 indexed campaignId,
        address indexed depositor,
        uint256 amount,
        uint256 totalDeposited
    );
    
    event FundsLocked(
        uint256 indexed campaignId,
        uint256 amount,
        uint256 unlockTime,
        uint256 milestoneId,
        LockReason reason
    );
    
    event FundsUnlocked(
        uint256 indexed campaignId,
        uint256 amount,
        uint256 milestoneId,
        address beneficiary
    );
    
    event FundsWithdrawn(
        uint256 indexed campaignId,
        address indexed recipient,
        uint256 amount,
        uint256 fee
    );
    
    event FundsRefunded(
        uint256 indexed campaignId,
        address indexed contributor,
        uint256 amount
    );
    
    event InterestAccrued(
        uint256 indexed campaignId,
        uint256 interestAmount,
        uint256 newTotal
    );
    
    event EmergencyWithdrawal(
        uint256 indexed campaignId,
        address indexed initiator,
        uint256 amount,
        uint256 fee
    );
    
    event EscrowConfigUpdated(uint256 indexed campaignId, EscrowConfig config);

    // Modifiers
    modifier onlyCampaignCreator(uint256 campaignId) {
        if (escrowAccounts[campaignId].creator != msg.sender) {
            revert ICommonErrors.NotCampaignCreator();
        }
        _;
    }
    
    modifier escrowExists(uint256 campaignId) {
        if (!escrowAccounts[campaignId].isActive) {
            revert EscrowDoesNotExist();
        }
        _;
    }

    constructor(address _crowdShield, address _campaignManager) {
        if (_crowdShield == address(0)) {
            revert InvalidCrowdShieldAddress();
        }
        if (_campaignManager == address(0)) {
            revert InvalidCampaignManagerAddress();
        }
        
        crowdShield = AegisCrowdShield(_crowdShield);
        campaignManager = VoluntaryCampaignManager(_campaignManager);
    }

    /**
     * @dev Create escrow account for a campaign
     * @param campaignId Campaign to create escrow for
     * @param paymentToken Token address (address(0) for ETH)
     * @param config Escrow configuration
     */
    function createEscrow(
        uint256 campaignId,
        address paymentToken,
        EscrowConfig memory config
    ) external nonReentrant {
        // Verify campaign exists and caller is creator
        AegisCrowdShield.CampaignSovereignty memory campaign = crowdShield.getCampaign(campaignId);
        if (campaign.creator != msg.sender) {
            revert ICommonErrors.NotCampaignCreator();
        }
        if (escrowAccounts[campaignId].isActive) {
            revert EscrowAlreadyExists();
        }
        
        // Validate configuration
        if (config.interestRate > MAXIMUM_INTEREST_RATE) {
            revert InterestRateTooHigh();
        }
        if (config.releaseDelay < MINIMUM_RELEASE_DELAY || 
            config.releaseDelay > MAXIMUM_RELEASE_DELAY) {
            revert InvalidReleaseDelay();
        }

        escrowAccounts[campaignId] = EscrowAccount({
            campaignId: campaignId,
            creator: msg.sender,
            paymentToken: paymentToken,
            totalDeposited: 0,
            totalWithdrawn: 0,
            totalRefunded: 0,
            lockedAmount: 0,
            availableAmount: 0,
            lastInterestUpdate: block.timestamp,
            accruedInterest: 0,
            isActive: true,
            config: config
        });

        creatorEscrows[msg.sender].push(campaignId);

        emit EscrowCreated(campaignId, msg.sender, paymentToken, config);
    }

    /**
     * @dev Deposit funds into escrow (called by CrowdShield contract)
     * @param campaignId Campaign to deposit to
     * @param depositor Address making the deposit
     * @param amount Amount to deposit
     */
    function depositFunds(
        uint256 campaignId,
        address depositor,
        uint256 amount
    ) external nonReentrant escrowExists(campaignId) {
        if (msg.sender != address(crowdShield)) {
            revert OnlyCrowdShieldCanDeposit();
        }
        if (amount == 0) {
            revert AmountMustBePositive();
        }

        EscrowAccount storage escrow = escrowAccounts[campaignId];
        
        // Update interest before modifying balances
        if (escrow.config.enableInterestAccrual) {
            _updateInterest(campaignId);
        }

        // Calculate escrow fee
        uint256 fee = (amount * escrowFeeRate) / BASIS_POINTS;
        uint256 netAmount = amount - fee;

        escrow.totalDeposited += netAmount;
        escrow.availableAmount += netAmount;
        contributorBalances[campaignId][depositor] += netAmount;

        // Add to contributor escrows if first deposit
        if (contributorBalances[campaignId][depositor] == netAmount) {
            contributorEscrows[depositor].push(campaignId);
        }

        emit FundsDeposited(campaignId, depositor, netAmount, escrow.totalDeposited);
    }

    /**
     * @dev Lock funds for milestone completion
     * @param campaignId Campaign to lock funds for
     * @param amount Amount to lock
     * @param milestoneId Associated milestone ID
     * @param unlockTime When funds can be unlocked
     */
    function lockFundsForMilestone(
        uint256 campaignId,
        uint256 amount,
        uint256 milestoneId,
        uint256 unlockTime
    ) external nonReentrant onlyCampaignCreator(campaignId) escrowExists(campaignId) {
        EscrowAccount storage escrow = escrowAccounts[campaignId];
        if (!escrow.config.enableMilestoneEscrow) {
            revert MilestoneEscrowDisabled();
        }
        if (amount > escrow.availableAmount) {
            revert InsufficientAvailableFunds();
        }
        if (unlockTime <= block.timestamp) {
            revert InvalidUnlockTime();
        }

        // Update interest before locking funds
        if (escrow.config.enableInterestAccrual) {
            _updateInterest(campaignId);
        }

        escrow.availableAmount -= amount;
        escrow.lockedAmount += amount;

        campaignLocks[campaignId].push(FundLock({
            amount: amount,
            unlockTime: unlockTime,
            milestoneId: milestoneId,
            beneficiary: msg.sender,
            reason: LockReason.Milestone,
            isUnlocked: false
        }));

        emit FundsLocked(campaignId, amount, unlockTime, milestoneId, LockReason.Milestone);
    }

    /**
     * @dev Unlock funds after milestone completion
     * @param campaignId Campaign to unlock funds for
     * @param lockIndex Index of the lock to unlock
     */
    function unlockMilestoneFunds(
        uint256 campaignId,
        uint256 lockIndex
    ) external nonReentrant onlyCampaignCreator(campaignId) escrowExists(campaignId) {
        if (lockIndex >= campaignLocks[campaignId].length) {
            revert InvalidLockIndex();
        }
        
        FundLock storage lock = campaignLocks[campaignId][lockIndex];
        if (lock.isUnlocked) {
            revert FundsAlreadyUnlocked();
        }
        if (lock.reason != LockReason.Milestone) {
            revert NotMilestoneLock();
        }
        if (block.timestamp < lock.unlockTime) {
            revert LockPeriodNotExpired();
        }

        // Verify milestone is completed
        if (lock.milestoneId != 0) {
            VoluntaryCampaignManager.MilestoneDefinition memory milestone = 
                campaignManager.getMilestone(lock.milestoneId);
            if (milestone.status != VoluntaryCampaignManager.MilestoneStatus.Approved &&
                milestone.status != VoluntaryCampaignManager.MilestoneStatus.Completed) {
                revert MilestoneNotApproved();
            }
        }

        EscrowAccount storage escrow = escrowAccounts[campaignId];
        
        // Update interest before unlocking
        if (escrow.config.enableInterestAccrual) {
            _updateInterest(campaignId);
        }

        escrow.lockedAmount -= lock.amount;
        escrow.availableAmount += lock.amount;
        lock.isUnlocked = true;

        emit FundsUnlocked(campaignId, lock.amount, lock.milestoneId, lock.beneficiary);
    }

    /**
     * @dev Withdraw available funds from escrow
     * @param campaignId Campaign to withdraw from
     * @param amount Amount to withdraw
     */
    function withdrawFunds(
        uint256 campaignId,
        uint256 amount
    ) external nonReentrant onlyCampaignCreator(campaignId) escrowExists(campaignId) {
        EscrowAccount storage escrow = escrowAccounts[campaignId];
        if (amount == 0) {
            revert AmountMustBePositive();
        }
        if (amount > escrow.availableAmount) {
            revert InsufficientAvailableFunds();
        }

        // Check time-based release delay
        if (escrow.config.enableTimeBasedRelease) {
            if (block.timestamp < escrow.lastInterestUpdate + escrow.config.releaseDelay) {
                revert ReleaseDelayNotMet();
            }
        }

        // Update interest before withdrawal
        if (escrow.config.enableInterestAccrual) {
            _updateInterest(campaignId);
        }

        // Calculate withdrawal fee
        uint256 fee = (amount * escrowFeeRate) / BASIS_POINTS;
        uint256 netAmount = amount - fee;

        escrow.availableAmount -= amount;
        escrow.totalWithdrawn += netAmount;

        // Transfer funds
        if (escrow.paymentToken == address(0)) {
            // ETH transfer
            (bool success, ) = payable(msg.sender).call{value: netAmount}("");
            if (!success) {
                revert ETHTransferFailed();
            }
        } else {
            // ERC20 transfer
            IERC20(escrow.paymentToken).safeTransfer(msg.sender, netAmount);
        }

        emit FundsWithdrawn(campaignId, msg.sender, netAmount, fee);
    }

    /**
     * @dev Request refund from escrow (for contributors)
     * @param campaignId Campaign to refund from
     */
    function requestRefund(uint256 campaignId) 
        external 
        nonReentrant 
        escrowExists(campaignId) 
    {
        EscrowAccount storage escrow = escrowAccounts[campaignId];
        uint256 contributorBalance = contributorBalances[campaignId][msg.sender];
        if (contributorBalance == 0) {
            revert NoFundsToRefund();
        }

        // Verify campaign is eligible for refunds
        AegisCrowdShield.CampaignSovereignty memory campaign = crowdShield.getCampaign(campaignId);
        if (campaign.status != AegisCrowdShield.CampaignStatus.Failed &&
            !(block.timestamp > campaign.deadline && campaign.totalRaised < campaign.targetAmount)) {
            revert RefundNotAvailable();
        }

        // Update interest before refund
        if (escrow.config.enableInterestAccrual) {
            _updateInterest(campaignId);
        }

        // Calculate proportional interest share
        uint256 interestShare = 0;
        if (escrow.accruedInterest != 0 && escrow.totalDeposited != 0) {
            interestShare = (escrow.accruedInterest * contributorBalance) / escrow.totalDeposited;
        }

        uint256 refundAmount = contributorBalance + interestShare;
        
        contributorBalances[campaignId][msg.sender] = 0;
        escrow.totalRefunded += refundAmount;
        escrow.availableAmount -= refundAmount;

        // Transfer refund
        if (escrow.paymentToken == address(0)) {
            // ETH refund
            (bool success, ) = payable(msg.sender).call{value: refundAmount}("");
            if (!success) {
                revert ETHRefundFailed();
            }
        } else {
            // ERC20 refund
            IERC20(escrow.paymentToken).safeTransfer(msg.sender, refundAmount);
        }

        emit FundsRefunded(campaignId, msg.sender, refundAmount);
    }

    /**
     * @dev Emergency withdrawal with penalty (Austrian Economics: Market consequences)
     * @param campaignId Campaign to withdraw from
     * @param amount Amount to withdraw
     */
    function emergencyWithdraw(
        uint256 campaignId,
        uint256 amount
    ) external nonReentrant onlyCampaignCreator(campaignId) escrowExists(campaignId) {
        EscrowAccount storage escrow = escrowAccounts[campaignId];
        if (!escrow.config.enableEmergencyWithdraw) {
            revert EmergencyWithdrawalDisabled();
        }
        if (amount == 0) {
            revert AmountMustBePositive();
        }
        if (amount > escrow.availableAmount) {
            revert InsufficientAvailableFunds();
        }

        // Emergency withdrawal penalty
        uint256 penalty = (amount * emergencyFeeRate) / BASIS_POINTS;
        uint256 netAmount = amount - penalty;

        escrow.availableAmount -= amount;
        escrow.totalWithdrawn += netAmount;

        // Transfer funds
        if (escrow.paymentToken == address(0)) {
            // ETH transfer
            (bool success, ) = payable(msg.sender).call{value: netAmount}("");
            if (!success) {
                revert ETHTransferFailed();
            }
        } else {
            // ERC20 transfer
            IERC20(escrow.paymentToken).safeTransfer(msg.sender, netAmount);
        }

        emit EmergencyWithdrawal(campaignId, msg.sender, netAmount, penalty);
    }

    /**
     * @dev Update accrued interest for an escrow account
     * @param campaignId Campaign to update interest for
     */
    function _updateInterest(uint256 campaignId) internal {
        EscrowAccount storage escrow = escrowAccounts[campaignId];
        
        if (!escrow.config.enableInterestAccrual || escrow.config.interestRate == 0) {
            return;
        }

        uint256 lastUp = escrow.lastInterestUpdate;
        uint256 timeElapsed = lastUp > block.timestamp ? 0 : block.timestamp - lastUp;
        if (timeElapsed == 0) {
            return;
        }

        // Calculate compound interest
        uint256 principal = escrow.totalDeposited + escrow.accruedInterest;
        uint256 periodsElapsed = timeElapsed / COMPOUNDING_PERIOD;
        
        if (periodsElapsed != 0) {
            uint256 periodRate = (escrow.config.interestRate * COMPOUNDING_PERIOD) / (365 days * BASIS_POINTS);
            uint256 newInterest = _calculateCompoundInterest(principal, periodRate, periodsElapsed);
            
            escrow.accruedInterest += newInterest;
            escrow.availableAmount += newInterest;
            escrow.lastInterestUpdate = block.timestamp;

            emit InterestAccrued(campaignId, newInterest, escrow.totalDeposited + escrow.accruedInterest);
        }
    }

    /**
     * @dev Calculate compound interest
     * @param principal Principal amount
     * @param rate Interest rate per period
     * @param periods Number of periods
     * @return interest Calculated interest
     */
    function _calculateCompoundInterest(
        uint256 principal,
        uint256 rate,
        uint256 periods
    ) internal pure returns (uint256 interest) {
        // Simplified compound interest calculation
        // In production, would use more sophisticated math libraries
        uint256 compoundFactor = BASIS_POINTS + rate;
        uint256 finalAmount = principal;
        
        for (uint256 i = 0; i < periods && i < 365; i++) { // Limit iterations for gas
            finalAmount = (finalAmount * compoundFactor) / BASIS_POINTS;
        }
        
        return finalAmount > principal ? finalAmount - principal : 0;
    }

    /**
     * @dev Update escrow configuration
     * @param campaignId Campaign to update
     * @param config New configuration
     */
    function updateEscrowConfig(
        uint256 campaignId,
        EscrowConfig memory config
    ) external nonReentrant onlyCampaignCreator(campaignId) escrowExists(campaignId) {
        if (config.interestRate > MAXIMUM_INTEREST_RATE) {
            revert InterestRateTooHigh();
        }
        if (config.releaseDelay < MINIMUM_RELEASE_DELAY || 
            config.releaseDelay > MAXIMUM_RELEASE_DELAY) {
            revert InvalidReleaseDelay();
        }

        // Update interest before changing configuration
        if (escrowAccounts[campaignId].config.enableInterestAccrual) {
            _updateInterest(campaignId);
        }

        escrowAccounts[campaignId].config = config;

        emit EscrowConfigUpdated(campaignId, config);
    }

    // View Functions
    function getEscrowAccount(uint256 campaignId) 
        external 
        view 
        returns (EscrowAccount memory) 
    {
        return escrowAccounts[campaignId];
    }
    
    function getContributorBalance(uint256 campaignId, address contributor) 
        external 
        view 
        returns (uint256) 
    {
        return contributorBalances[campaignId][contributor];
    }
    
    function getCampaignLocks(uint256 campaignId) 
        external 
        view 
        returns (FundLock[] memory) 
    {
        return campaignLocks[campaignId];
    }
    
    function getCreatorEscrows(address creator) 
        external 
        view 
        returns (uint256[] memory) 
    {
        return creatorEscrows[creator];
    }
    
    function getContributorEscrows(address contributor) 
        external 
        view 
        returns (uint256[] memory) 
    {
        return contributorEscrows[contributor];
    }
    
    function calculateCurrentInterest(uint256 campaignId) 
        external 
        view 
        returns (uint256) 
    {
        EscrowAccount storage escrow = escrowAccounts[campaignId];
        
        if (!escrow.config.enableInterestAccrual || escrow.config.interestRate == 0) {
            return escrow.accruedInterest;
        }

        uint256 lastUp = escrow.lastInterestUpdate;
        uint256 timeElapsed = lastUp > block.timestamp ? 0 : block.timestamp - lastUp;
        uint256 principal = escrow.totalDeposited + escrow.accruedInterest;
        uint256 periodsElapsed = timeElapsed / COMPOUNDING_PERIOD;
        
        if (periodsElapsed == 0) {
            return escrow.accruedInterest;
        }

        uint256 periodRate = (escrow.config.interestRate * COMPOUNDING_PERIOD) / (365 days * BASIS_POINTS);
        uint256 newInterest = _calculateCompoundInterest(principal, periodRate, periodsElapsed);
        
        return escrow.accruedInterest + newInterest;
    }

    // Admin Functions (Austrian Economics: Minimal intervention)
    function updateFeeRates(
        uint256 _escrowFeeRate,
        uint256 _interestFeeRate,
        uint256 _emergencyFeeRate
    ) external {
        // Note: In a truly decentralized system, this would be governed by the community
        if (_escrowFeeRate > 500) {
            revert EscrowFeeTooHigh(); // Max 5%
        }
        if (_interestFeeRate > 2000) {
            revert InterestFeeTooHigh(); // Max 20%
        }
        if (_emergencyFeeRate > 1000) {
            revert EmergencyFeeTooHigh(); // Max 10%
        }
        
        escrowFeeRate = _escrowFeeRate;
        interestFeeRate = _interestFeeRate;
        emergencyFeeRate = _emergencyFeeRate;
    }

    // Receive ETH
    receive() external payable {
        // Allow contract to receive ETH for escrow purposes
    }
}
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "../interfaces/IVerifierFactory.sol";
import "../interfaces/IVerifier.sol";

/**
 * @title TimeLockPurchaseLimits
 * @dev Time-based purchase limits with ZK-based sybil protection that automatically expire after public sale completion
 * @notice Enforces purchase limits during Dutch auction with privacy-preserving identity verification
 * 
 * Features:
 * - Per-address purchase limits during active sale
 * - Time-based limit resets (daily/weekly)
 * - Automatic expiration after sale completion
 * - ZK-based anti-sybil protection during active period
 * - Privacy-preserving identity verification
 * - No admin controls - fully automated
 */
contract TimeLockPurchaseLimits is ReentrancyGuard {
    // ============ MUTABLE STATE ============
    address public dutchAuction;
    IVerifierFactory public immutable verifierFactory;
    uint256 public immutable maxPurchasePerAddress;    // Max tokens per address during sale
    uint256 public immutable maxPurchasePerPeriod;     // Max tokens per address per time period
    uint256 public immutable limitResetPeriod;         // Time period for limit reset (24 hours)
    uint256 public immutable saleStartTime;            // When limits become active
    uint256 public immutable emergencyUnlockTime;      // Emergency unlock if auction fails
    uint256 public immutable maxPurchasesPerIdentity;  // Max purchases per unique identity
    
    // ============ MUTABLE STATE ============
    mapping(address => uint256) public totalPurchased;           // Total purchased by address
    mapping(address => uint256) public periodPurchased;         // Purchased in current period
    mapping(address => uint256) public lastPurchaseTime;        // Last purchase timestamp
    mapping(address => uint256) public currentPeriodStart;      // Current period start time
    
    // ZK Privacy State
    mapping(uint256 => bool) public usedIdentityNullifiers;     // Used identity nullifiers
    mapping(address => uint256) public identityCommitments;     // Identity commitments for privacy
    mapping(uint256 => uint256) public identityPurchaseCounts;  // Purchase counts per identity
    
    bool public limitsActive;
    bool public limitsExpired;
    uint256 public expirationTime;
    
    // ============ EVENTS ============
    event LimitsActivated(uint256 timestamp);
    event LimitsExpired(uint256 timestamp);
    event PurchaseRecorded(address indexed buyer, uint256 amount, uint256 timestamp);
    event PeriodReset(address indexed buyer, uint256 newPeriodStart);
    event EmergencyUnlock(uint256 timestamp);
    event PrivateIdentityVerified(uint256 indexed identityNullifier, uint256 commitment, uint256 timestamp);
    event SybilAttemptDetected(address indexed suspect, uint256 timestamp);

    // ============ CONSTRUCTOR ============
    constructor(
        address _verifierFactory,
        uint256 _maxPurchasePerAddress,  // 10,000 * 1e18 = 10K AGS max per address
        uint256 _maxPurchasePerPeriod,   // 2,000 * 1e18 = 2K AGS per 24h period
        uint256 _limitResetPeriod,       // 86400 = 24 hours
        uint256 _saleStartTime,          // Auction start time
        uint256 _emergencyUnlockTime     // 7 days after sale start
    ) {
        require(_verifierFactory != address(0), "Invalid verifier factory address");
        require(_maxPurchasePerAddress > 0, "Max purchase per address must be > 0");
        require(_maxPurchasePerPeriod > 0, "Max purchase per period must be > 0");
        require(_maxPurchasePerPeriod <= _maxPurchasePerAddress, "Period limit cannot exceed total limit");
        require(_limitResetPeriod > 0, "Reset period must be > 0");
        require(_saleStartTime > block.timestamp, "Sale start time must be in the future");
        require(_emergencyUnlockTime > _saleStartTime, "Emergency unlock must be after sale start");
        verifierFactory = IVerifierFactory(_verifierFactory);
        maxPurchasePerAddress = _maxPurchasePerAddress;
        maxPurchasePerPeriod = _maxPurchasePerPeriod;
        limitResetPeriod = _limitResetPeriod;
        saleStartTime = _saleStartTime;
        emergencyUnlockTime = _emergencyUnlockTime;
    }

    // ============ MODIFIERS ============
    modifier onlyDutchAuction() {
        require(msg.sender == dutchAuction, "Only dutch auction can call");
        _;
    }

    modifier whenLimitsActive() {
        _updateLimitStatus();
        require(limitsActive && !limitsExpired, "Limits not active");
        _;
    }

    // ============ CORE FUNCTIONS ============

    /**
     * @dev Update limit status based on auction state and time
     */
    function _updateLimitStatus() internal {
        // Check if sale has started
        if (block.timestamp >= saleStartTime && !limitsActive && !limitsExpired) {
            limitsActive = true;
            emit LimitsActivated(block.timestamp);
        }

        // Check if auction is completed
        if (limitsActive && !limitsExpired) {
            bool auctionCompleted = false;
            (bool success, bytes memory data) = dutchAuction.staticcall(
                abi.encodeWithSignature("checkAndCompleteSale()")
            );
            if (success && data.length > 0) {
                auctionCompleted = abi.decode(data, (bool));
            } else {
                (bool s2, bytes memory d2) = dutchAuction.staticcall(
                    abi.encodeWithSignature("isSaleCompleted()")
                );
                if (s2 && d2.length > 0) {
                    auctionCompleted = abi.decode(d2, (bool));
                } else {
                    (bool s3, bytes memory d3) = dutchAuction.staticcall(
                        abi.encodeWithSignature("saleCompleted()")
                    );
                    if (s3 && d3.length > 0) {
                        auctionCompleted = abi.decode(d3, (bool));
                    }
                }
            }

            if (auctionCompleted) {
                limitsExpired = true;
                limitsActive = false;
                expirationTime = block.timestamp;
                emit LimitsExpired(block.timestamp);
            }
        }

        // Emergency unlock if auction fails to complete
        if (limitsActive && !limitsExpired && block.timestamp >= emergencyUnlockTime) {
            limitsExpired = true;
            limitsActive = false;
            expirationTime = block.timestamp;
            emit EmergencyUnlock(block.timestamp);
        }
    }

    /**
     * @dev Reset purchase period for an address if needed
     * @param buyer Address to check and reset
     */
    function _resetPeriodIfNeeded(address buyer) internal {
        uint256 periodStart = currentPeriodStart[buyer];
        
        // Initialize period start if first purchase
        if (periodStart == 0) {
            currentPeriodStart[buyer] = block.timestamp;
            return;
        }

        // Reset period if time has passed
        if (block.timestamp >= periodStart + limitResetPeriod) {
            currentPeriodStart[buyer] = block.timestamp;
            periodPurchased[buyer] = 0;
            emit PeriodReset(buyer, block.timestamp);
        }
    }

    /**
     * @dev Verify identity using ZK proof and record purchase with sybil protection
     * @param buyer Address making the purchase
     * @param amount Amount of tokens being purchased
     * @param proof ZK proof for sybil protection
     * @param identityNullifier Nullifier for unique identity
     * @param identityCommitment Commitment to identity
     */
    function recordPurchaseWithSybilProtection(
        address buyer, 
        uint256 amount,
        uint256[8] calldata proof,
        uint256 identityNullifier,
        uint256 identityCommitment
    ) 
        external 
        onlyDutchAuction 
        whenLimitsActive 
        nonReentrant 
    {
        require(buyer != address(0), "Invalid buyer address");
        require(amount > 0, "Purchase amount must be > 0");
        require(!usedIdentityNullifiers[identityNullifier], "Identity already used");

        // Verify ZK proof for sybil protection
        IVerifier sybilVerifier = IVerifier(verifierFactory.getVerifier("sybil-protection"));
        require(address(sybilVerifier) != address(0), "Sybil verifier not found");
        
        // Prepare public inputs for ZK verification
        uint256[] memory publicInputs = new uint256[](4);
        publicInputs[0] = identityCommitment;
        publicInputs[1] = identityNullifier;
        publicInputs[2] = uint256(uint160(buyer));
        publicInputs[3] = amount;
        
        require(
            sybilVerifier.verifyProof(
                [proof[0], proof[1]], // a
                [[proof[2], proof[3]], [proof[4], proof[5]]], // b
                [proof[6], proof[7]], // c
                publicInputs
            ),
            "Invalid sybil protection proof"
        );

        // Mark identity nullifier as used
        usedIdentityNullifiers[identityNullifier] = true;
        
        // Store identity commitment for privacy
        identityCommitments[buyer] = identityCommitment;
        
        // Increment purchase count for this identity
        identityPurchaseCounts[identityNullifier] = identityPurchaseCounts[identityNullifier] + 1;

        // Reset period if needed
        _resetPeriodIfNeeded(buyer);

        // Check total purchase limit
        uint256 newTotal = totalPurchased[buyer] + amount;
        require(newTotal <= maxPurchasePerAddress, "Exceeds total purchase limit");

        // Check period purchase limit
        uint256 newPeriodTotal = periodPurchased[buyer] + amount;
        require(newPeriodTotal <= maxPurchasePerPeriod, "Exceeds period purchase limit");

        // Update state
        totalPurchased[buyer] = newTotal;
        periodPurchased[buyer] = newPeriodTotal;
        lastPurchaseTime[buyer] = block.timestamp;

        emit PrivateIdentityVerified(identityNullifier, identityCommitment, block.timestamp);
        emit PurchaseRecorded(buyer, amount, block.timestamp);
    }

    /**
     * @dev Record a purchase and enforce limits (legacy function)
     * @param buyer Address making the purchase
     * @param amount Amount of tokens being purchased
     */
    function recordPurchase(address buyer, uint256 amount) 
        external 
        onlyDutchAuction 
        whenLimitsActive 
        nonReentrant 
    {
        require(buyer != address(0), "Invalid buyer address");
        require(amount > 0, "Purchase amount must be > 0");

        // Reset period if needed
        _resetPeriodIfNeeded(buyer);

        // Check total purchase limit
        uint256 newTotal = totalPurchased[buyer] + amount;
        require(newTotal <= maxPurchasePerAddress, "Exceeds total purchase limit");

        // Check period purchase limit
        uint256 newPeriodTotal = periodPurchased[buyer] + amount;
        require(newPeriodTotal <= maxPurchasePerPeriod, "Exceeds period purchase limit");

        // Update state
        totalPurchased[buyer] = newTotal;
        periodPurchased[buyer] = newPeriodTotal;
        lastPurchaseTime[buyer] = block.timestamp;

        emit PurchaseRecorded(buyer, amount, block.timestamp);
    }

    /**
     * @dev Check if a purchase is allowed
     * @param buyer Address wanting to make purchase
     * @param amount Amount of tokens to purchase
     * @return allowed Whether the purchase is allowed
     * @return reason Reason if not allowed
     */
    function checkPurchaseAllowed(address buyer, uint256 amount) 
        external 
        view 
        returns (bool allowed, string memory reason) 
    {
        // Check if sale has started first
        if (block.timestamp < saleStartTime) {
            return (false, "Sale not started");
        }

        // If limits are expired or not active, allow all purchases
        if (limitsExpired || !limitsActive) {
            return (true, "Limits not active");
        }

        // Check total limit
        uint256 newTotal = totalPurchased[buyer] + amount;
        if (newTotal > maxPurchasePerAddress) {
            return (false, "Exceeds total purchase limit");
        }

        // Check period limit (simulate period reset)
        uint256 periodStart = currentPeriodStart[buyer];
        uint256 currentPeriodPurchased = periodPurchased[buyer];
        
        if (periodStart > 0 && block.timestamp >= periodStart + limitResetPeriod) {
            currentPeriodPurchased = 0; // Period would be reset
        }

        uint256 newPeriodTotal = currentPeriodPurchased + amount;
        if (newPeriodTotal > maxPurchasePerPeriod) {
            return (false, "Exceeds period purchase limit");
        }

        return (true, "Purchase allowed");
    }

    /**
     * @dev Get remaining purchase allowance for an address
     * @param buyer Address to check
     * @return totalRemaining Remaining total purchase allowance
     * @return periodRemaining Remaining period purchase allowance
     * @return timeUntilReset Time until period reset (0 if reset available)
     */
    function getRemainingAllowance(address buyer) 
        external 
        view 
        returns (
            uint256 totalRemaining,
            uint256 periodRemaining,
            uint256 timeUntilReset
        ) 
    {
        // If limits expired, return max values
        if (limitsExpired || !limitsActive) {
            return (type(uint256).max, type(uint256).max, 0);
        }

        // Calculate total remaining
        totalRemaining = maxPurchasePerAddress - totalPurchased[buyer];

        // Calculate period remaining (considering potential reset)
        uint256 periodStart = currentPeriodStart[buyer];
        uint256 currentPeriodPurchased = periodPurchased[buyer];
        
        if (periodStart == 0) {
            // First purchase - full period allowance
            periodRemaining = maxPurchasePerPeriod;
            timeUntilReset = 0;
        } else if (block.timestamp >= periodStart + limitResetPeriod) {
            // Period can be reset
            periodRemaining = maxPurchasePerPeriod;
            timeUntilReset = 0;
        } else {
            // Within current period
            periodRemaining = maxPurchasePerPeriod - currentPeriodPurchased;
            timeUntilReset = periodStart + limitResetPeriod - block.timestamp;
        }

        // Return the minimum of total and period remaining
        if (periodRemaining > totalRemaining) {
            periodRemaining = totalRemaining;
        }
    }

    /**
     * @dev Set the Dutch auction address (can only be set once)
     * @param _dutchAuction Address of the Dutch auction contract
     */
    function setDutchAuction(address _dutchAuction) external {
        require(_dutchAuction != address(0), "Invalid Dutch auction address");
        require(dutchAuction == address(0), "Dutch auction address already set");
        dutchAuction = _dutchAuction;
    }

    /**
     * @dev Manual status update (anyone can call)
     */
    function updateStatus() external {
        _updateLimitStatus();
    }

    // ============ VIEW FUNCTIONS ============

    /**
     * @dev Get limit status and information
     */
    function getLimitInfo() external view returns (
        bool active,
        bool expired,
        uint256 expiration,
        uint256 saleStart,
        uint256 emergencyUnlock,
        uint256 maxPerAddress,
        uint256 maxPerPeriod,
        uint256 resetPeriod
    ) {
        active = limitsActive;
        expired = limitsExpired;
        expiration = expirationTime;
        saleStart = saleStartTime;
        emergencyUnlock = emergencyUnlockTime;
        maxPerAddress = maxPurchasePerAddress;
        maxPerPeriod = maxPurchasePerPeriod;
        resetPeriod = limitResetPeriod;
    }

    /**
     * @dev Get purchase history for an address
     */
    function getPurchaseHistory(address buyer) external view returns (
        uint256 total,
        uint256 periodAmount,
        uint256 lastPurchase,
        uint256 periodStart
    ) {
        total = totalPurchased[buyer];
        periodAmount = periodPurchased[buyer];
        lastPurchase = lastPurchaseTime[buyer];
        periodStart = currentPeriodStart[buyer];
    }

    /**
     * @dev Check if limits are currently active
     */
    function areLimitsActive() external view returns (bool) {
        if (limitsExpired) return false;
        if (!limitsActive && block.timestamp < saleStartTime) return false;
        if (block.timestamp >= emergencyUnlockTime) return false;
        
        // Check auction completion
        (bool success, bytes memory data) = dutchAuction.staticcall(
            abi.encodeWithSignature("checkAndCompleteSale()")
        );
        
        if (success && data.length > 0) {
            bool auctionCompleted = abi.decode(data, (bool));
            if (auctionCompleted) return false;
        }
        
        return block.timestamp >= saleStartTime;
    }

    /**
     * @dev Get time until various events
     */
    function getTimeInfo() external view returns (
        uint256 timeUntilSaleStart,
        uint256 timeUntilEmergencyUnlock,
        uint256 currentTime
    ) {
        currentTime = block.timestamp;
        
        if (block.timestamp < saleStartTime) {
            timeUntilSaleStart = saleStartTime - block.timestamp;
        } else {
            timeUntilSaleStart = 0;
        }
        
        if (block.timestamp < emergencyUnlockTime) {
            timeUntilEmergencyUnlock = emergencyUnlockTime - block.timestamp;
        } else {
            timeUntilEmergencyUnlock = 0;
        }
    }
}
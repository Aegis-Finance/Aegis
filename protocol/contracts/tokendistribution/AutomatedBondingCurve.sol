// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IVerifierFactory} from "../interfaces/IVerifierFactory.sol";
import {IVerifier} from "../interfaces/IVerifier.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @notice Interface for oracle aggregator price lookup
 * @dev Compatible with MultiOracleAggregator.getPrice()
 */
interface IOracleAggregator {
    function getPrice(bytes32 assetId) external view returns (
        uint256 medianPrice,
        uint256 timestamp,
        uint256 validOracles,
        bool isValid
    );
}

/**
 * @title AutomatedBondingCurve
 * @dev Privacy-preserving bonding curve for continuous AGS token distribution with ZK proofs
 * @notice Activates automatically after Dutch auction completion with privacy features
 * 
 * Features:
 * - Algorithmic price discovery based on supply
 * - ZK-based privacy-preserving purchases and sales
 * - No purchase limits (free market with privacy)
 * - Automatic activation after Dutch auction
 * - Immutable mathematical formula
 */
contract AutomatedBondingCurve is ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;
    // Note: SafeMath is no longer needed in Solidity ^0.8.0 due to built-in overflow protection

    /// @notice Integrator label: supply-quadratic curve + optional oracle band (see `MODERN_AUCTION_ECONOMICS.md`).
    uint8 public constant CURVE_FAMILY_ID = 1;

    // ============ IMMUTABLE STATE ============
    IERC20 public immutable agsToken;
    IVerifierFactory public immutable verifierFactory;
    address public immutable dutchAuction;
    uint256 public immutable basePrice;        // Base price in wei per token
    uint256 public immutable priceMultiplier;  // Price multiplier for curve steepness
    uint256 public immutable maxSupply;       // Maximum tokens that can be sold
    
    // ============ MUTABLE STATE ============
    uint256 public totalSold;
    bool public isActive;
    
    // ============ ORACLE INTEGRATION (GOVERNANCE-CONTROLLED) ============
    /// @notice Optional oracle aggregator for market price alignment (can be enabled/disabled via governance)
    address public oracleAggregator;
    /// @notice Asset ID for oracle price lookup (e.g., keccak256("AGS/SONIC"))
    bytes32 public oracleAssetId;
    /// @notice Whether oracle validation is enabled (governance-controlled)
    bool public oracleValidationEnabled;
    /// @notice Maximum deviation from oracle price (in basis points, default 5% = 500)
    uint256 public maxOracleDeviationBps;
    
    // ============ ZK PRIVACY STATE ============
    mapping(uint256 => bool) public usedNullifiers;

    /// @notice VerifierFactory circuit keys (must match `VerifierFactory` constructor list)
    string private constant BONDING_CURVE_PURCHASE_CIRCUIT = "bonding-curve-purchase";
    string private constant BONDING_CURVE_SELL_CIRCUIT = "bonding-curve-sell";
    
    // ============ SECURITY STATE ============
    /// @notice Flash loan detection: track block numbers
    uint32 private lastPurchaseBlock;  // Last block where purchase occurred
    uint256 private lastBlockTotalSold;  // Total sold in last block
    /// @notice Maximum price impact per transaction (50% = 5000 bps)
    uint256 public constant MAX_PRICE_IMPACT_BPS = 5000; // 50%
    /// @notice Flash loan detection threshold (10% change in same block)
    uint256 public constant FLASH_LOAN_THRESHOLD_BPS = 1000; // 10%
    /// @notice Minimum purchase amount to prevent dust attacks
    uint256 public constant MIN_PURCHASE_AMOUNT = 1e15; // 0.001 ETH
    
    // ============ EVENTS ============
    event CurveActivated(uint256 timestamp, uint256 startingPrice);
    event TokensPurchased(address indexed buyer, uint256 amount, uint256 price, uint256 totalCost);
    event TokensSold(address indexed seller, uint256 amount, uint256 price, uint256 totalReceived);
    event PrivatePurchase(address indexed buyer, uint256 commitment, uint256 amount);
    event PrivateSell(address indexed seller, uint256 nullifier, uint256 amount);
    event FlashLoanDetected(address indexed attacker, uint256 blockNumber);
    event PriceManipulationDetected(address indexed attacker, uint256 priceImpact);
    event OracleConfigured(address indexed aggregator, bytes32 indexed assetId, bool enabled);
    event OracleValidationToggled(bool enabled);
    event OracleDeviationUpdated(uint256 maxDeviationBps);

    // ============ ZK PROOF STRUCTS ============
    struct Proof {
        uint256[2] a;
        uint256[2][2] b;
        uint256[2] c;
    }

    struct PurchaseParams {
        Proof proof;
        uint256 root;
        uint256 nullifierHash;
        uint256 commitment;
        uint256 recipient; // Using uint256 for address inside circuit
    }

    struct SellParams {
        Proof proof;
        uint256 root;
        uint256 nullifierHash;
        uint256 commitmentHash;  // Commitment hash for merkle proof verification
        uint256 amount;
        uint256 recipient; // Using uint256 for address inside circuit
    }

    // ============ CONSTRUCTOR ============
    constructor(
        address _agsToken,
        address _verifierFactory,
        address _dutchAuction,
        uint256 _basePrice,       // 0.5 * 1e18 = $0.50 base price
        uint256 _priceMultiplier, // 1e12 = multiplier for curve steepness
        uint256 _maxSupply        // 5,000,000 * 1e18 = 5M tokens max
    ) Ownable(msg.sender) {
        require(_agsToken != address(0), "Invalid token address");
        require(_verifierFactory != address(0), "Invalid verifier factory address");
        require(_dutchAuction != address(0), "Invalid auction address");
        require(_basePrice > 0, "Base price must be > 0");
        require(_priceMultiplier > 0, "Price multiplier must be > 0");
        require(_maxSupply > 0, "Max supply must be > 0");

        agsToken = IERC20(_agsToken);
        verifierFactory = IVerifierFactory(_verifierFactory);
        dutchAuction = _dutchAuction;
        basePrice = _basePrice;
        priceMultiplier = _priceMultiplier;
        maxSupply = _maxSupply;
        
        // Initialize oracle settings (disabled by default, can be enabled via governance)
        oracleValidationEnabled = false;
        maxOracleDeviationBps = 500; // Default 5% deviation tolerance
    }

    // ============ MODIFIERS ============
    modifier onlyWhenActive() {
        if (!isActive) {
            _checkAndActivate();
        }
        require(isActive, "Bonding curve not active");
        _;
    }

    modifier onlyValidProof(string memory _verifierType, Proof memory _proof, uint256[] memory _publicInputs) {
        IVerifier verifier = IVerifier(verifierFactory.getVerifier(_verifierType));
        require(address(verifier) != address(0), "Invalid verifier");
        require(verifier.verifyProof(
            _proof.a,
            _proof.b,
            _proof.c,
            _publicInputs
        ), "Invalid ZK proof");
        _;
    }

    // ============ CORE FUNCTIONS ============

    /**
     * @dev Check if Dutch auction is complete and activate bonding curve
     */
    function _checkAndActivate() internal {
        // Try multiple known interfaces to determine auction completion
        bool auctionCompleted = false;

        // 1) Preferred: checkAndCompleteSale() -> bool
        (bool success1, bytes memory data1) = dutchAuction.staticcall(
            abi.encodeWithSignature("checkAndCompleteSale()")
        );
        if (success1 && data1.length > 0) {
            auctionCompleted = abi.decode(data1, (bool));
        } else {
            // 2) Fallback: isSaleCompleted() -> bool
            (bool success2, bytes memory data2) = dutchAuction.staticcall(
                abi.encodeWithSignature("isSaleCompleted()")
            );
            if (success2 && data2.length > 0) {
                auctionCompleted = abi.decode(data2, (bool));
            } else {
                // 3) Fallback: saleCompleted() -> bool (public variable getter)
                (bool success3, bytes memory data3) = dutchAuction.staticcall(
                    abi.encodeWithSignature("saleCompleted()")
                );
                if (success3 && data3.length > 0) {
                    auctionCompleted = abi.decode(data3, (bool));
                }
            }
        }

        if (auctionCompleted && !isActive) {
            isActive = true;
            emit CurveActivated(block.timestamp, getCurrentPrice());
        }
    }

    /**
     * @dev Get current price based on bonding curve formula
     * @return Current price per token in wei
     * Formula: price = basePrice + (totalSold^2 * priceMultiplier) / 1e18
     */
    function getCurrentPrice() public view returns (uint256) {
        if (totalSold == 0) {
            return basePrice;
        }
        
        // Quadratic bonding curve: price increases with square of supply
        uint256 supplySquared = totalSold * totalSold / 1e18;
        uint256 priceIncrease = supplySquared * priceMultiplier / 1e18;
        
        return basePrice + priceIncrease;
    }

    /**
     * @dev Get price for selling tokens (slightly lower than buy price)
     * @return Sell price per token in wei
     */
    function getSellPrice() public view returns (uint256) {
        if (totalSold == 0) {
            return 0;
        }
        
        // Calculate price at (totalSold - 1 token) position for sell price
        // Prevent underflow: if totalSold < 1e18, use base price
        if (totalSold < 1e18) {
            return basePrice * 95 / 100; // 5% spread at base
        }
        
        uint256 newSupply = totalSold - 1e18; // Subtract 1 token worth
        if (newSupply == 0) {
            return basePrice * 95 / 100; // 5% spread at base
        }
        
        uint256 supplySquared = newSupply * newSupply / 1e18;
        uint256 priceIncrease = supplySquared * priceMultiplier / 1e18;
        uint256 sellPrice = basePrice + priceIncrease;
        
        // Apply 5% spread
        return sellPrice * 95 / 100;
    }

    /**
     * @dev Calculate tokens receivable for given ETH amount
     * @param ethAmount Amount of ETH to spend
     * @return Number of tokens receivable
     */
    function getTokensForEth(uint256 ethAmount) public view returns (uint256) {
        uint256 currentPrice = getCurrentPrice();
        return ethAmount * 1e18 / currentPrice;
    }

    /**
     * @dev Calculate ETH receivable for given token amount (selling)
     * @param tokenAmount Amount of tokens to sell
     * @return ETH amount receivable
     */
    function getEthForTokens(uint256 tokenAmount) public view returns (uint256) {
        uint256 sellPrice = getSellPrice();
        return tokenAmount * sellPrice / 1e18;
    }

    /**
     * @dev Purchase tokens via bonding curve (legacy, public)
     * @param minTokensOut Minimum tokens expected (slippage protection)
     */
    function purchaseTokens(uint256 minTokensOut) external payable nonReentrant onlyWhenActive {
        // Flash loan protection
        _detectFlashLoan();
        
        // Calculate tokens before state changes
        uint256 currentPrice = getCurrentPrice();
        uint256 tokensToReceive = msg.value * 1e18 / currentPrice;
        
        // Slippage protection
        require(tokensToReceive >= minTokensOut, "Slippage too high");
        
        // Price manipulation protection
        uint256 priceImpact = _calculatePriceImpactForPurchase(msg.value, tokensToReceive);
        require(priceImpact <= MAX_PRICE_IMPACT_BPS, "Price impact too high");
        
        _purchaseTokens(msg.sender);
        
        // Update flash loan state
        _updateFlashLoanState();
    }

    /**
     * @dev Purchase tokens privately using a ZK proof
     * @param _params The purchase parameters including the proof
     */
    function purchaseTokensPrivate(PurchaseParams calldata _params)
        external
        payable
        nonReentrant
        onlyWhenActive
        onlyValidProof(
            BONDING_CURVE_PURCHASE_CIRCUIT,
            _params.proof,
            _toDynamicArray([
                _params.root,
                _params.nullifierHash,
                _params.commitment,
                uint256(uint160(address(this))),
                msg.value
            ])
        )
    {
        require(!usedNullifiers[_params.nullifierHash], "Nullifier already used");
        usedNullifiers[_params.nullifierHash] = true;

        address recipient = address(uint160(_params.recipient));
        require(recipient != address(0), "Invalid recipient");

        _purchaseTokens(recipient);

        emit PrivatePurchase(recipient, _params.commitment, msg.value);
    }

    /**
     * @dev Internal function to purchase tokens
     */
    function _purchaseTokens(address _recipient) internal {
        require(msg.value >= MIN_PURCHASE_AMOUNT, "Below minimum purchase amount");
        
        uint256 currentPrice = getCurrentPrice();
        
        // Optional oracle validation (if enabled via governance)
        if (oracleValidationEnabled && oracleAggregator != address(0) && oracleAssetId != bytes32(0)) {
            _validatePriceAgainstOracle(currentPrice);
        }
        
        uint256 tokensToReceive = msg.value * 1e18 / currentPrice;
        require(tokensToReceive > 0, "Invalid token amount");
        require(totalSold + tokensToReceive <= maxSupply, "Exceeds max supply");

        // Update state
        totalSold += tokensToReceive;

        // Transfer tokens
        agsToken.safeTransfer(_recipient, tokensToReceive);

        emit TokensPurchased(_recipient, tokensToReceive, currentPrice, msg.value);
    }

    /**
     * @dev Sell tokens back to bonding curve (legacy, public)
     * @param tokenAmount Amount of tokens to sell
     * @param minEthOut Minimum ETH expected (slippage protection)
     */
    function sellTokens(uint256 tokenAmount, uint256 minEthOut) external nonReentrant onlyWhenActive {
        // Flash loan protection
        _detectFlashLoan();
        
        // Calculate ETH before state changes
        uint256 ethToReceive = getEthForTokens(tokenAmount);
        
        // Slippage protection
        require(ethToReceive >= minEthOut, "Slippage too high");
        
        // Price manipulation protection
        uint256 priceImpact = _calculatePriceImpactForSell(tokenAmount, ethToReceive);
        require(priceImpact <= MAX_PRICE_IMPACT_BPS, "Price impact too high");
        
        _sellTokens(msg.sender, tokenAmount);
        
        // Update flash loan state
        _updateFlashLoanState();
    }

    /**
     * @dev Sell tokens privately using a ZK proof
     * @param _params The sell parameters including the proof
     */
    function sellTokensPrivate(SellParams calldata _params)
        external
        nonReentrant
        onlyWhenActive
        onlyValidProof(
            BONDING_CURVE_SELL_CIRCUIT,
            _params.proof,
            _toDynamicArray([
                _params.root,
                _params.nullifierHash,
                _params.commitmentHash,
                _params.amount,
                _params.recipient
            ])
        )
    {
        require(!usedNullifiers[_params.nullifierHash], "Nullifier already used");
        usedNullifiers[_params.nullifierHash] = true;

        address recipient = address(uint160(_params.recipient));
        require(recipient != address(0), "Invalid recipient");

        _sellTokens(recipient, _params.amount);

        emit PrivateSell(recipient, _params.nullifierHash, _params.amount);
    }

    /**
     * @dev Internal function to sell tokens
     */
    function _sellTokens(address _seller, uint256 _tokenAmount) internal {
        require(_tokenAmount > 0, "Must specify token amount");
        require(_tokenAmount <= totalSold, "Cannot sell more than total sold");

        uint256 sellPrice = getSellPrice();
        
        // Optional oracle validation (if enabled via governance)
        if (oracleValidationEnabled && oracleAggregator != address(0) && oracleAssetId != bytes32(0)) {
            _validatePriceAgainstOracle(sellPrice);
        }

        uint256 ethToReceive = getEthForTokens(_tokenAmount);
        require(ethToReceive > 0, "Invalid ETH amount");
        require(address(this).balance >= ethToReceive, "Insufficient ETH in contract");

        // Update state BEFORE external calls (CEI pattern)
        totalSold -= _tokenAmount;

        // Transfer tokens from the caller (msg.sender) who is executing the transaction
        // For public sells: msg.sender is the seller, so transfer from them
        // For private sells: msg.sender is proving ownership via ZK, so they must provide the tokens
        // The ZK proof verifies ownership, but the tokens still need to come from the caller
        agsToken.safeTransferFrom(msg.sender, address(this), _tokenAmount);

        // Send ETH to user, propagating the revert reason on failure
        (bool success, bytes memory data) = _seller.call{value: ethToReceive}("");
        if (!success) {
            if (data.length > 0) {
                // Bubble up the revert reason
                assembly {
                    revert(add(data, 32), mload(data))
                }
            } else {
                revert("ETH transfer failed");
            }
        }

        emit TokensSold(_seller, _tokenAmount, getSellPrice(), ethToReceive);
    }

    /**
     * @dev Manual activation function (anyone can call)
     */
    function activate() external {
        _checkAndActivate();
    }

    // ============ VIEW FUNCTIONS ============

    /**
     * @dev Get bonding curve information
     */
    function getCurveInfo() external view returns (
        uint256 currentPrice,
        uint256 sellPrice,
        uint256 totalTokensSold,
        uint256 remainingSupply,
        bool active
    ) {
        currentPrice = getCurrentPrice();
        sellPrice = getSellPrice();
        totalTokensSold = totalSold;
        remainingSupply = maxSupply - totalSold;
        active = isActive;
    }

    /**
     * @dev Calculate price impact for a given purchase
     * @param ethAmount ETH amount to spend
     * @return priceImpact Price impact as percentage (in basis points)
     */
    function calculatePriceImpact(uint256 ethAmount) external view returns (uint256 priceImpact) {
        uint256 currentPrice = getCurrentPrice();
        uint256 tokensToReceive = getTokensForEth(ethAmount);
        
        // Calculate new price after purchase
        uint256 newSupply = totalSold + tokensToReceive;
        uint256 newSupplySquared = newSupply * newSupply / 1e18;
        uint256 newPriceIncrease = newSupplySquared * priceMultiplier / 1e18;
        uint256 newPrice = basePrice + newPriceIncrease;
        
        // Calculate price impact in basis points (1% = 100 bp)
        if (newPrice > currentPrice) {
            priceImpact = (newPrice - currentPrice) * 10000 / currentPrice;
        }
    }

    // ============ HELPER FUNCTIONS ============
    
    /**
     * @dev Convert a fixed-size array to a dynamic array
     */
    function _toDynamicArray(uint256[5] memory _fixedArray) internal pure returns (uint256[] memory) {
        uint256[] memory dynamicArray = new uint256[](_fixedArray.length);
        for (uint256 i = 0; i < _fixedArray.length; i++) {
            dynamicArray[i] = _fixedArray[i];
        }
        return dynamicArray;
    }
    
    /**
     * @dev Convert a fixed-size array to a dynamic array
     */
    function _toDynamicArray(uint256[4] memory _fixedArray) internal pure returns (uint256[] memory) {
        uint256[] memory dynamicArray = new uint256[](_fixedArray.length);
        for (uint256 i = 0; i < _fixedArray.length; i++) {
            dynamicArray[i] = _fixedArray[i];
        }
        return dynamicArray;
    }

    // ============ SECURITY FUNCTIONS ============
    
    /**
     * @dev Detect flash loan attacks by checking same-block reserve changes
     */
    function _detectFlashLoan() internal {
        if (lastPurchaseBlock > 0 && uint256(lastPurchaseBlock) == block.number) {
            uint256 blockChange = totalSold - lastBlockTotalSold;
            if (lastBlockTotalSold > 0) {
                uint256 changeBps = (blockChange * 10000) / lastBlockTotalSold;
                if (changeBps > FLASH_LOAN_THRESHOLD_BPS) {
                    emit FlashLoanDetected(msg.sender, block.number);
                    revert("Flash loan detected");
                }
            }
        }
    }
    
    /**
     * @dev Update flash loan detection state
     */
    function _updateFlashLoanState() internal {
        if (uint256(lastPurchaseBlock) != block.number) {
            lastPurchaseBlock = uint32(block.number);
            lastBlockTotalSold = totalSold;
        }
    }
    
    /**
     * @dev Calculate price impact for purchase
     */
    function _calculatePriceImpactForPurchase(
        uint256 ethAmount,
        uint256 tokensReceived
    ) internal view returns (uint256 priceImpactBps) {
        if (totalSold == 0) return 0;
        if (tokensReceived == 0) return 0;
        
        uint256 currentPrice = getCurrentPrice();
        uint256 newSupply = totalSold + tokensReceived;
        uint256 newSupplySquared = newSupply * newSupply / 1e18;
        uint256 newPriceIncrease = newSupplySquared * priceMultiplier / 1e18;
        uint256 newPrice = basePrice + newPriceIncrease;
        
        if (newPrice > currentPrice) {
            priceImpactBps = ((newPrice - currentPrice) * 10000) / currentPrice;
        }

        // Also consider execution price derived from inputs to avoid unused parameter
        // executedPrice = ethAmount / tokensReceived (integer division)
        uint256 executedPrice = ethAmount / tokensReceived;
        if (executedPrice > 0) {
            uint256 execImpactBps;
            if (executedPrice > currentPrice) {
                execImpactBps = ((executedPrice - currentPrice) * 10000) / currentPrice;
            } else {
                execImpactBps = ((currentPrice - executedPrice) * 10000) / currentPrice;
            }
            if (execImpactBps > priceImpactBps) {
                priceImpactBps = execImpactBps;
            }
        }
    }
    
    /**
     * @dev Calculate price impact for sell
     */
    function _calculatePriceImpactForSell(
        uint256 tokenAmount,
        uint256 ethReceived
    ) internal view returns (uint256 priceImpactBps) {
        if (totalSold == 0) return 0;
        // Guard against underflow during view calculation; enforce exact limit in _sellTokens
        if (tokenAmount > totalSold) return 0;
        
        uint256 currentPrice = getCurrentPrice();
        uint256 newSupply = totalSold - tokenAmount;
        if (newSupply == 0) return 0;
        
        uint256 newSupplySquared = newSupply * newSupply / 1e18;
        uint256 newPriceIncrease = newSupplySquared * priceMultiplier / 1e18;
        uint256 newPrice = basePrice + newPriceIncrease;
        
        if (currentPrice > newPrice) {
            priceImpactBps = ((currentPrice - newPrice) * 10000) / currentPrice;
        }

        // Also consider execution price derived from outputs to avoid unused parameter
        // executedPrice = ethReceived / tokenAmount (integer division)
        if (tokenAmount > 0) {
            uint256 executedPrice = ethReceived / tokenAmount;
            if (executedPrice > 0) {
                uint256 execImpactBps;
                if (executedPrice > currentPrice) {
                    execImpactBps = ((executedPrice - currentPrice) * 10000) / currentPrice;
                } else {
                    execImpactBps = ((currentPrice - executedPrice) * 10000) / currentPrice;
                }
                if (execImpactBps > priceImpactBps) {
                    priceImpactBps = execImpactBps;
                }
            }
        }
    }

    // ============ RECEIVE FUNCTION ============
    receive() external payable {
        // Disable automatic purchases via receive() to prevent attacks
        // Users must explicitly call purchaseTokens() with slippage protection
        revert("Use purchaseTokens() with slippage protection");
    }

    // ============ ORACLE INTEGRATION (GOVERNANCE-CONTROLLED) ============
    
    /**
     * @dev Configure oracle aggregator for price validation (governance-controlled)
     * @param _oracleAggregator Address of MultiOracleAggregator contract
     * @param _assetId Asset ID for price lookup (e.g., keccak256("AGS/SONIC"))
     * @param _enabled Whether to enable oracle validation
     * @notice Only owner (governance) can configure oracle
     */
    function configureOracle(
        address _oracleAggregator,
        bytes32 _assetId,
        bool _enabled
    ) external onlyOwner {
        require(_oracleAggregator != address(0) || !_enabled, "Invalid aggregator address");
        require(_assetId != bytes32(0) || !_enabled, "Invalid asset ID");
        
        oracleAggregator = _oracleAggregator;
        oracleAssetId = _assetId;
        oracleValidationEnabled = _enabled;
        
        emit OracleConfigured(_oracleAggregator, _assetId, _enabled);
    }
    
    /**
     * @dev Toggle oracle validation on/off (governance-controlled)
     * @param _enabled Whether to enable oracle validation
     * @notice Only owner (governance) can toggle
     */
    function setOracleValidationEnabled(bool _enabled) external onlyOwner {
        require(oracleAggregator != address(0) && oracleAssetId != bytes32(0), "Oracle not configured");
        oracleValidationEnabled = _enabled;
        emit OracleValidationToggled(_enabled);
    }
    
    /**
     * @dev Set maximum deviation from oracle price (governance-controlled)
     * @param _maxDeviationBps Maximum deviation in basis points (e.g., 500 = 5%)
     * @notice Only owner (governance) can set deviation
     */
    function setMaxOracleDeviation(uint256 _maxDeviationBps) external onlyOwner {
        require(_maxDeviationBps <= 5000, "Deviation too high"); // Max 50%
        maxOracleDeviationBps = _maxDeviationBps;
        emit OracleDeviationUpdated(_maxDeviationBps);
    }
    
    /**
     * @dev Internal function to validate bonding curve price against oracle
     * @param curvePrice Current bonding curve price
     * @notice Reverts if price deviation exceeds maxOracleDeviationBps
     */
    function _validatePriceAgainstOracle(uint256 curvePrice) internal view {
        try IOracleAggregator(oracleAggregator).getPrice(oracleAssetId) returns (
            uint256 oraclePrice,
            uint256 timestamp,
            uint256,
            bool isValid
        ) {
            require(isValid, "Oracle price invalid");
            require(timestamp <= block.timestamp, "Oracle timestamp invalid");
            require(block.timestamp - timestamp <= 3600, "Oracle price stale"); // 1 hour
            
            // Calculate deviation
            uint256 deviationBps;
            if (oraclePrice > curvePrice) {
                deviationBps = ((oraclePrice - curvePrice) * 10000) / curvePrice;
            } else {
                deviationBps = ((curvePrice - oraclePrice) * 10000) / oraclePrice;
            }
            
            require(deviationBps <= maxOracleDeviationBps, "Price deviation too high");
        } catch {
            // If oracle call fails, allow transaction (fail-open for availability)
            // Governance can disable oracle validation if oracle is down
        }
    }

    // ============ FEE MONETIZATION REGISTRATION ============
    /**
     * @dev Register this contract with Sonic FeeM Projects' Contracts Registrar
     * @param projectId The FeeM project ID assigned during application
     */
    function registerMe(uint256 projectId) external onlyOwner {
        (bool _success,) = address(0xDC2B0D2Dd2b7759D97D50db4eabDC36973110830).call(
            abi.encodeWithSignature("selfRegister(uint256)", projectId)
        );
        require(_success, "FeeM registration failed");
    }
}
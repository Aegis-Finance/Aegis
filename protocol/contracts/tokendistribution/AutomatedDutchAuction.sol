// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "../interfaces/IVerifierFactory.sol";
import "../interfaces/IVerifier.sol";
import "./TimeLockPurchaseLimits.sol";
import "./interfaces/IAutomatedLiquidityDeployer.sol";
import "./libs/AuctionPriceLib.sol";
import "../interfaces/ISwapRouter02.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title AutomatedDutchAuction
 * @dev Privacy-preserving token sale with ZK-verified participation and a **time-linear Dutch** price path.
 * @notice Economics: price is discovered continuously over the sale window (each buyer pays the **spot**
 *         price at execution time). Optional `deferredSettlement` records balances and delivers tokens
 *         after finalization (closer to a **batch / clearing-style** UX without changing the marginal price rule).
 *
 *         The deploy-time **`owner`** (launch operator / DAO admin multisig) must call **`activate()`** to
 *         open the sale window (`auctionStartTime` / `auctionEndTime`) and set **`isActive`**. Until then,
 *         no purchases are allowed and the Dutch clock does **not** run (price stays at `startPrice` for preview).
 *         This keeps the sale from going live at deployment until the operator explicitly opens it.
 *         **ZK binding:** the Groth16 `"auction"` circuit assumes the linear schedule and the 6 public
 *         inputs documented in `getAuctionVerifierPublicInputs`. Replacing the curve (e.g. GDA / VRGDA)
 *         requires a new verifier + circuit + coordinated frontend/prover rollout.
 *
 *         **Market / credit risk (off-chain disclosure):** Dutch clearing fixes the *marginal* price path on-chain;
 *         it does not guarantee secondary-market liquidity, fair value, or absence of manipulation in the
 *         broader ecosystem. Participants should treat **post-settlement volatility** and **routing of proceeds**
 *         (`ecosystemProceedsSink`, liquidity deployer) as standard financial-market risk vectors—analogous to
 *         primary issuance plus **term / risk premium** discussions in money-and-banking curricula—without
 *         sacrificing ZK participation privacy on-chain.
 *
 *         **Unsold AGS (from the sale tranche held by this contract):** After the sale ends, unsold tokens are **not**
 *         meant to remain locked here indefinitely. Anyone may call `transferUnsoldToTreasury()` **≥ 30 days** after
 *         completion; it transfers the unsold balance to **`ecosystemProceedsSink`** (immutable at deploy). Choose that
 *         sink as a **DAO-controlled router**, `GovernanceTreasury`, or another contract that can route funds into
 *         liquidity, rewards, or treasury policy — **not** an EOA that cannot forward, and **not** `address(0)`.
 *         Native excess (after auto-liquidity) is pushed to the same sink via `withdrawProceeds()`. The function name
 *         `transferUnsoldToTreasury` is historical; the recipient is always `ecosystemProceedsSink`.
 */
contract AutomatedDutchAuction is ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;
    // Note: SafeMath is no longer needed in Solidity ^0.8.0 due to built-in overflow protection

    // ============ IMMUTABLE STATE ============
    IERC20 public immutable agsToken;
    IVerifierFactory public immutable verifierFactory;
    
    // Liquidity deployment configuration
    address public immutable liquidityDeployer;  // AutomatedLiquidityDeployer address
    uint256 public constant LIQUIDITY_TOKEN_AMOUNT = 1_000_000 * 1e18; // 1M AGS hard cap for v3 seed

    /// @notice AGS wei paired into Uniswap v3 at post-sale seeding (≤ `LIQUIDITY_TOKEN_AMOUNT`). Set before `activate()`.
    uint256 public liquiditySeedAgs;

    /// @notice Receives unsold AGS (post-sale sweep), excess pay-rail balances after liquidity seeding, and non-paired proceeds.
    /// @dev **Operational requirement:** set at deploy to a contract the DAO trusts to **route value** (e.g. `GovernanceTreasury`,
    ///      rewards router, or connector) so unsold sale tokens are never stranded. Not the 4.2M treasury tranche from `TokenAllocation`.
    address public immutable ecosystemProceedsSink;

    /// @notice Optional ERC-20 rails for the **legacy** purchase path. Zero address disables that rail.
    /// @dev TGE-only fixed pegs (not market oracles): **1 S = 1 wS = USD 0.02**, **1 WETH = USD 1000**,
    ///      **1 USDC / USDT / EURC = USD 0.98** (6 decimals). Converts spend to **wei S equivalent** then applies
    ///      the same Dutch `getCurrentPrice()` rule as `purchaseTokensLegacy`. Proceeds are **held in this contract**
    ///      until post-sale liquidity seeding; native S + wS fund the Uniswap band, then all rails sweep to the sink.
    ///      `totalEthCollected` increases by the S-equivalent for mean-price accounting.
    IERC20 public immutable payTokenWs;
    IERC20 public immutable payTokenWeth;
    IERC20 public immutable payTokenUsdc;
    IERC20 public immutable payTokenUsdt;
    IERC20 public immutable payTokenEurc;

    /// @notice Uniswap v3 SwapRouter02 for converting non-S/wS proceeds to wS before LP seeding. Zero disables on-chain swap.
    address public immutable swapRouter02;
    
    // Mutable state (can be set after deployment)
    TimeLockPurchaseLimits public timeLock;
    /// @notice Length of the Dutch window once `activate()` has run.
    uint256 public immutable auctionDuration;
    /// @notice Set on first `activate()`; zero means sale has never been scheduled.
    uint256 public auctionStartTime;
    /// @notice Set on first `activate()` together with `auctionStartTime`.
    uint256 public auctionEndTime;
    uint256 public immutable startPrice;      // Starting price in wei per token
    uint256 public immutable reservePrice;    // Minimum price in wei per token
    uint256 public immutable totalTokens;     // Total tokens for sale
    uint256 public immutable maxPerAddress;   // Max tokens per address
    uint256 public immutable minPurchase;     // Minimum purchase amount
    
    // ============ MUTABLE STATE ============
    uint256 public tokensSold;
    /// @notice Cumulative **wei S equivalent** paid into the sale (native `msg.value` wei + ERC-20 amounts valued at TGE pegs). Used by `getMeanPrice()`.
    uint256 public totalEthCollected;  // S-equivalent wei (legacy name)
    bool public saleCompleted;
    uint256 public saleCompletionTime;  // Timestamp when sale actually completed (for early sellout)
    bool public isActive;  // Set true in `activate()` by `owner` (launch admin / multisig)
    bool public liquidityFundsSent;  // Track if liquidity funds have been sent
    mapping(address => uint256) public purchaseAmounts;
    mapping(address => uint256) public lastPurchaseTime;
    
    // ZK Privacy State
    mapping(bytes32 => bool) public usedNullifiers;  // Prevent double-spending of ZK proofs
    mapping(address => bytes32) public addressCommitments;  // Privacy-preserving address commitments
    
    // ============ SECURITY STATE ============
    /// @notice Flash loan detection: track block numbers and reserve changes
    uint32 private lastPurchaseBlock;  // Last block where purchase occurred
    uint256 private lastBlockTokensSold;  // Tokens sold in last block
    uint256 private lastBlockEthCollected;  // ETH collected in last block
    /// @notice Maximum price impact per transaction (50% = 5000 bps)
    uint256 public constant MAX_PRICE_IMPACT_BPS = 5000; // 50%
    /// @notice Flash loan detection threshold (10% change in same block)
    uint256 public constant FLASH_LOAN_THRESHOLD_BPS = 1000; // 10%
    /// @notice Minimum purchase amount to prevent dust attacks
    uint256 public constant MIN_PURCHASE_AMOUNT = 1e15; // 0.001 ETH

    /// @notice Slippage guard for permissionless settlement swaps (TGE peg floor vs pool price).
    uint256 public constant SETTLEMENT_SWAP_SLIPPAGE_BPS = 200; // 2%
    /// @notice Default Uniswap v3 fee tier for settlement single-hop swaps.
    uint24 public constant SETTLEMENT_POOL_FEE = 3000;

    /// @notice Integrator / analytics ID for the on-chain price law. `1` = time-linear Dutch (ZK v1).
    uint8 public constant AUCTION_PRICE_CURVE_ID = 1;
    
    // ============ EVENTS ============
    event TokensPurchased(address indexed buyer, uint256 amount, uint256 price, uint256 totalCost);
    event TokensPurchasedErc20(
        address indexed buyer,
        address indexed paymentToken,
        uint256 tokenPaid,
        uint256 sEquivalentWei,
        uint256 agsAmount,
        uint256 spotPrice
    );
    event PrivatePurchase(bytes32 indexed commitment, uint256 amount, uint256 price);
    event SaleCompleted(uint256 totalSold, uint256 finalPrice);
    event PurchaseLimitsExpired();
    event SybilProtectionTriggered(address indexed suspect, bytes32 proofHash);
    event UnsoldTokensTransferredToTreasury(address indexed treasury, uint256 amount);
    event FlashLoanDetected(address indexed attacker, uint256 blockNumber);
    event PriceManipulationDetected(address indexed attacker, uint256 priceImpact);
    event SaleActivated(address indexed activatedBy, uint256 timestamp);
    event LiquidityFundsSent(address indexed liquidityDeployer, uint256 agsAmount, uint256 sonicAmount);
    event LiquiditySeedAgsUpdated(uint256 previousAmount, uint256 newAmount);
    event PayTokenSwappedToWs(address indexed tokenIn, uint256 amountIn, uint256 wsOut);

    // ============ DEFERRED SETTLEMENT (OPTIONAL) ============
    /// @notice If enabled before sale start, purchases record entitlements and users claim post-finalization
    bool public deferredSettlement;
    bool private deferredSettlementFrozen; // can only set once, before start

    /// @notice Entitlements recorded when deferredSettlement is enabled
    mapping(address => uint256) public legacyEntitlement;
    mapping(bytes32 => uint256) public privateEntitlement; // keyed by commitment

    /// @notice Finalization timestamp for claim gating
    bool public saleFinalized;
    uint256 public finalizedAt; // timestamp when finalizeSale() first succeeded

    // ============ CONSTRUCTOR ============
    /// @notice Dutch auction. `_startPrice` / `_reservePrice` are **wei of native S per 1e18 wei AGS** (same units as `getCurrentPrice()`), not USD.
    /// @dev Example: `100e18` top and `5e18` floor ≈ 100 S and 5 S principal per 1 AGS at those curve points (~USD 2.00 and USD 0.10 per AGS at the fixed TGE peg **USD 0.02 per 1 S**). Native fills use `msg.value`. ERC-20 rails use `purchaseTokensWithErc20` (ZK) or `purchaseTokensLegacyWithErc20` (transparent legacy).
    constructor(
        address _agsToken,
        address _verifierFactory,
        address _liquidityDeployer,  // AutomatedLiquidityDeployer address
        address _ecosystemProceedsSink, // e.g. DecentralizedPrivacyRewards — unsold AGS + excess native
        uint256 _startPrice,      // top: wei S per 1e18 wei AGS (e.g. 100e18 ≈ 100 S/AGS at curve start)
        uint256 _reservePrice,    // floor: same units (e.g. 5e18 ≈ 5 S/AGS)
        uint256 _totalTokens,     // 9,500,000 * 1e18 = 9.5M tokens (10.5M - 1.0M for liquidity)
        uint256 _maxPerAddress,   // 50,000 * 1e18 = 50K tokens max per address
        uint256 _minPurchase,     // 100 * 1e18 = 100 tokens minimum
        uint256 _duration,        // 2592000 = 30 days
        address _payWs,
        address _payWeth,
        address _payUsdc,
        address _payUsdt,
        address _payEurc,
        address _swapRouter02
    ) Ownable(msg.sender) {
        require(_agsToken != address(0), "Invalid token address");
        require(_verifierFactory != address(0), "Invalid verifier factory");
        require(_liquidityDeployer != address(0), "Invalid liquidity deployer address");
        require(_ecosystemProceedsSink != address(0), "Invalid ecosystem proceeds sink");
        require(_startPrice > _reservePrice, "Start price must be > reserve price");
        require(_totalTokens > 0, "Total tokens must be > 0");
        require(_maxPerAddress > _minPurchase, "Max per address must be > min purchase");
        require(_duration > 0, "Duration must be > 0");

        agsToken = IERC20(_agsToken);
        verifierFactory = IVerifierFactory(_verifierFactory);
        liquidityDeployer = _liquidityDeployer;
        ecosystemProceedsSink = _ecosystemProceedsSink;
        liquiditySeedAgs = LIQUIDITY_TOKEN_AMOUNT;
        auctionDuration = _duration;
        startPrice = _startPrice;
        reservePrice = _reservePrice;
        totalTokens = _totalTokens;
        maxPerAddress = _maxPerAddress;
        minPurchase = _minPurchase;

        payTokenWs = IERC20(_payWs);
        payTokenWeth = IERC20(_payWeth);
        payTokenUsdc = IERC20(_payUsdc);
        payTokenUsdt = IERC20(_payUsdt);
        payTokenEurc = IERC20(_payEurc);
        swapRouter02 = _swapRouter02;
    }

    // ============ CORE FUNCTIONS ============

    /**
     * @dev Get current auction price based on time elapsed
     * @return Current price per token in wei
     */
    function getCurrentPrice() public view returns (uint256) {
        if (auctionStartTime == 0) {
            return startPrice;
        }
        return AuctionPriceLib.linearDutchPrice(
            startPrice,
            reservePrice,
            auctionStartTime,
            auctionEndTime,
            block.timestamp,
            saleCompleted
        );
    }

    /**
     * @dev Calculate tokens receivable for given ETH amount
     * @param ethAmount Amount of ETH to spend
     * @return Number of tokens receivable
     */
    function getTokensForEth(uint256 ethAmount) public view returns (uint256) {
        uint256 currentPrice = getCurrentPrice();
        return AuctionPriceLib.tokensForEthAtPrice(ethAmount, currentPrice);
    }

    /// @dev 1 wei WETH maps to `50000e18 / 1e18` wei S (full WETH = 50_000 S).
    uint256 private constant S_WEI_PER_WETH_WEI = 50000e18;
    /// @dev 1 smallest-unit stable (1e-6 whole) maps to `49e18 / 1e6` wei S (full coin = 49 S).
    uint256 private constant S_WEI_NUM_STABLE = 49e18;

    function _isStable6Token(IERC20 token) private view returns (bool) {
        return (address(payTokenUsdc) != address(0) && token == payTokenUsdc)
            || (address(payTokenUsdt) != address(0) && token == payTokenUsdt)
            || (address(payTokenEurc) != address(0) && token == payTokenEurc);
    }

    function _tokenToSEquivWei(IERC20 token, uint256 tokenAmount) internal view returns (uint256) {
        if (tokenAmount == 0) return 0;
        if (address(payTokenWs) != address(0) && token == payTokenWs) {
            return tokenAmount;
        }
        if (address(payTokenWeth) != address(0) && token == payTokenWeth) {
            return Math.mulDiv(tokenAmount, S_WEI_PER_WETH_WEI, 1e18);
        }
        if (_isStable6Token(token)) {
            return Math.mulDiv(tokenAmount, S_WEI_NUM_STABLE, 1e6);
        }
        revert("Unsupported payment token");
    }

    function _sEquivToTokenCeil(IERC20 token, uint256 sEquivWei) internal view returns (uint256) {
        if (sEquivWei == 0) return 0;
        if (address(payTokenWs) != address(0) && token == payTokenWs) {
            return sEquivWei;
        }
        if (address(payTokenWeth) != address(0) && token == payTokenWeth) {
            return Math.mulDiv(sEquivWei, 1e18, S_WEI_PER_WETH_WEI, Math.Rounding.Ceil);
        }
        if (_isStable6Token(token)) {
            return Math.mulDiv(sEquivWei, 1e6, S_WEI_NUM_STABLE, Math.Rounding.Ceil);
        }
        revert("Unsupported payment token");
    }

    /**
     * @notice Max `paymentToken` units (ceil) needed to buy `agsOut` wei AGS at the current Dutch spot (TGE pegs).
     */
    function quoteErc20ForAgs(IERC20 paymentToken, uint256 agsOut) external view returns (uint256 tokenIn) {
        uint256 currentPrice = getCurrentPrice();
        if (currentPrice == 0) return 0;
        uint256 sCost = Math.mulDiv(agsOut, currentPrice, 1e18, Math.Rounding.Ceil);
        return _sEquivToTokenCeil(paymentToken, sCost);
    }

    /**
     * @notice ERC-20 purchase (legacy path). Same schedule as `purchaseTokensLegacy` using S-equivalent spend.
     * @param token One of the configured `payToken*` addresses (wS, WETH, USDC, USDT, EURC).
     * @param maxTokenIn Maximum payment units approved; only `tokenCost` is pulled.
     * @param minTokensOut Slippage bound on AGS received.
     */
    function purchaseTokensLegacyWithErc20(IERC20 token, uint256 maxTokenIn, uint256 minTokensOut) external nonReentrant {
        require(isActive, "Sale not activated by admin");
        require(auctionStartTime > 0, "Sale not scheduled");
        require(block.timestamp >= auctionStartTime, "Sale not started");
        require(block.timestamp < auctionEndTime, "Sale ended");
        require(!saleCompleted, "Sale completed");
        require(address(token) != address(0), "Invalid token");

        uint256 sMax = _tokenToSEquivWei(token, maxTokenIn);
        require(sMax >= MIN_PURCHASE_AMOUNT, "Below minimum purchase amount");

        _detectFlashLoan();

        uint256 currentPrice = getCurrentPrice();
        uint256 tokensToReceive = (sMax * 1e18) / currentPrice;
        require(tokensToReceive >= minPurchase, "Below minimum purchase");
        require(tokensToReceive >= minTokensOut, "Slippage too high");

        uint256 priceImpact = _calculatePriceImpact(sMax, tokensToReceive, currentPrice);
        require(priceImpact <= MAX_PRICE_IMPACT_BPS, "Price impact too high");

        uint256 costSEquiv = sMax;
        if (tokensSold + tokensToReceive > totalTokens) {
            uint256 remainingTokens = totalTokens - tokensSold;
            costSEquiv = (remainingTokens * currentPrice) / 1e18;
            tokensToReceive = remainingTokens;
        }

        uint256 tokenCost = _sEquivToTokenCeil(token, costSEquiv);
        require(tokenCost <= maxTokenIn, "Insufficient max token in");

        require(block.timestamp >= lastPurchaseTime[msg.sender] + 3600, "Rate limited");

        tokensSold = tokensSold + tokensToReceive;
        totalEthCollected = totalEthCollected + costSEquiv;
        purchaseAmounts[msg.sender] = purchaseAmounts[msg.sender] + tokensToReceive;
        lastPurchaseTime[msg.sender] = block.timestamp;

        _updateFlashLoanState();

        bool saleIsCompleted = tokensSold >= totalTokens;
        if (saleIsCompleted && !saleCompleted) {
            saleCompleted = true;
            saleCompletionTime = block.timestamp;
        }

        token.safeTransferFrom(msg.sender, address(this), tokenCost);

        if (deferredSettlement) {
            legacyEntitlement[msg.sender] += tokensToReceive;
        } else {
            agsToken.safeTransfer(msg.sender, tokensToReceive);
        }

        emit TokensPurchasedErc20(msg.sender, address(token), tokenCost, costSEquiv, tokensToReceive, getCurrentPrice());
        emit TokensPurchased(msg.sender, tokensToReceive, getCurrentPrice(), costSEquiv);

        if (saleIsCompleted) {
            emit SaleCompleted(tokensSold, getCurrentPrice());
        }
    }

    /**
     * @notice Public inputs passed to the `"auction"` Groth16 verifier (must match the circuit layout).
     * @param referenceTimestamp Unix seconds; in `purchaseTokens` this is always `block.timestamp`.
     * @return pub Fixed-size array: `[startPrice, reservePrice, startTime, duration, referenceTimestamp, decayRatePerSecondWad]`
     */
    function getAuctionVerifierPublicInputs(uint256 referenceTimestamp) public view returns (uint256[6] memory pub) {
        require(auctionStartTime > 0, "Auction not activated");
        pub[0] = startPrice;
        pub[1] = reservePrice;
        pub[2] = auctionStartTime;
        pub[3] = auctionEndTime - auctionStartTime;
        pub[4] = referenceTimestamp;
        pub[5] = AuctionPriceLib.decayRatePerSecondWad(startPrice, reservePrice, auctionStartTime, auctionEndTime);
    }

    function _verifyAuctionProof(uint256[8] calldata proof) internal view {
        IVerifier auctionVerifier = IVerifier(verifierFactory.getVerifier("auction"));
        require(address(auctionVerifier) != address(0), "Auction verifier not found");
        uint256[6] memory pub = getAuctionVerifierPublicInputs(block.timestamp);
        uint256[] memory publicInputs = new uint256[](6);
        for (uint256 i = 0; i < 6; i++) {
            publicInputs[i] = pub[i];
        }
        require(auctionVerifier.verifyProof(proof, publicInputs), "Invalid auction proof");
    }

    function _finalizePurchaseState(uint256 tokensToReceive, uint256 costSEquiv) internal returns (bool saleIsCompleted) {
        tokensSold = tokensSold + tokensToReceive;
        totalEthCollected = totalEthCollected + costSEquiv;
        saleIsCompleted = tokensSold >= totalTokens;
        if (saleIsCompleted && !saleCompleted) {
            saleCompleted = true;
            saleCompletionTime = block.timestamp;
        }
        _updateFlashLoanState();
    }

    /**
     * @dev Purchase tokens with ETH - FULLY AUTOMATED with ZK Privacy
     * @param proof ZK proof for purchase validation
     * @param commitment Purchase commitment for privacy
     * @param nullifier Nullifier to prevent double-spending
     * @param minTokensOut Minimum tokens expected (slippage protection)
     */
    function purchaseTokens(
        uint256[8] calldata proof,
        uint256 commitment,
        uint256 nullifier,
        uint256 minTokensOut
    ) external payable nonReentrant {
        require(isActive, "Sale not activated by admin");
        require(auctionStartTime > 0, "Sale not scheduled");
        require(block.timestamp >= auctionStartTime, "Sale not started");
        require(block.timestamp < auctionEndTime, "Sale ended");
        require(!saleCompleted, "Sale completed");
        require(msg.value >= MIN_PURCHASE_AMOUNT, "Below minimum purchase amount");
        require(!usedNullifiers[bytes32(nullifier)], "Nullifier already used");

        // Flash loan protection: detect same-block manipulation
        _detectFlashLoan();

        // Calculate tokens with current price (before state changes)
        uint256 currentPrice = getCurrentPrice();
        uint256 tokensToReceive = getTokensForEth(msg.value);
        require(tokensToReceive >= minPurchase, "Below minimum purchase");
        
        // Slippage protection
        require(tokensToReceive >= minTokensOut, "Slippage too high");
        
        // Price manipulation protection: check price impact
        uint256 priceImpact = _calculatePriceImpact(msg.value, tokensToReceive, currentPrice);
        require(priceImpact <= MAX_PRICE_IMPACT_BPS, "Price impact too high");
        
        // Check available supply
        require(tokensSold + tokensToReceive <= totalTokens, "Exceeds available supply");

        // Verify ZK proof for auction participation
        _verifyAuctionProof(proof);

        // CHECKS-EFFECTS-INTERACTIONS pattern: Update all state FIRST
        // Mark nullifier as used to prevent double-spending
        usedNullifiers[bytes32(nullifier)] = true;
        
        // Store commitment for privacy
        addressCommitments[msg.sender] = bytes32(commitment);

        // Update state BEFORE external calls (CEI pattern)
        tokensSold = tokensSold + tokensToReceive;
        totalEthCollected = totalEthCollected + msg.value;  // Track ETH collected
        
        // Auto-complete sale if all tokens sold (update state before interactions)
        bool saleIsCompleted = tokensSold >= totalTokens;
        if (saleIsCompleted && !saleCompleted) {
            saleCompleted = true;
            saleCompletionTime = block.timestamp;  // Record actual completion time
        }
        
        // Update flash loan detection state
        _updateFlashLoanState();

        // INTERACTIONS: External calls AFTER state updates
        // Record purchase with sybil protection in time lock
        timeLock.recordPurchaseWithSybilProtection(
            msg.sender,
            tokensToReceive,
            proof,
            nullifier,
            commitment
        );

        if (deferredSettlement) {
            // Record entitlement for private path keyed by commitment
            privateEntitlement[bytes32(commitment)] += tokensToReceive;
        } else {
            // Transfer tokens AFTER state update
            agsToken.safeTransfer(msg.sender, tokensToReceive);
        }

        emit PrivatePurchase(bytes32(commitment), tokensToReceive, getCurrentPrice());
        
        if (saleIsCompleted) {
            emit SaleCompleted(tokensSold, getCurrentPrice());
        }
    }

    /**
     * @notice Private (ZK) purchase with an allowed ERC-20 pay token (wS, WETH, USDC, USDT, EURC).
     * @dev Same Groth16 `"auction"` proof as `purchaseTokens`; payment is held until post-sale settlement.
     *      When `deferredSettlement` is enabled, entitlement is keyed by `commitment` (no indexed buyer leak).
     */
    function purchaseTokensWithErc20(
        uint256[8] calldata proof,
        uint256 commitment,
        uint256 nullifier,
        IERC20 token,
        uint256 maxTokenIn,
        uint256 minTokensOut
    ) external nonReentrant {
        require(isActive, "Sale not activated by admin");
        require(auctionStartTime > 0, "Sale not scheduled");
        require(block.timestamp >= auctionStartTime, "Sale not started");
        require(block.timestamp < auctionEndTime, "Sale ended");
        require(!saleCompleted, "Sale completed");
        require(address(token) != address(0), "Invalid token");
        require(!usedNullifiers[bytes32(nullifier)], "Nullifier already used");

        uint256 sMax = _tokenToSEquivWei(token, maxTokenIn);
        require(sMax >= MIN_PURCHASE_AMOUNT, "Below minimum purchase amount");

        _detectFlashLoan();

        uint256 currentPrice = getCurrentPrice();
        uint256 tokensToReceive = (sMax * 1e18) / currentPrice;
        require(tokensToReceive >= minPurchase, "Below minimum purchase");
        require(tokensToReceive >= minTokensOut, "Slippage too high");

        uint256 priceImpact = _calculatePriceImpact(sMax, tokensToReceive, currentPrice);
        require(priceImpact <= MAX_PRICE_IMPACT_BPS, "Price impact too high");

        uint256 costSEquiv = sMax;
        if (tokensSold + tokensToReceive > totalTokens) {
            uint256 remainingTokens = totalTokens - tokensSold;
            costSEquiv = (remainingTokens * currentPrice) / 1e18;
            tokensToReceive = remainingTokens;
        }

        uint256 tokenCost = _sEquivToTokenCeil(token, costSEquiv);
        require(tokenCost <= maxTokenIn, "Insufficient max token in");
        require(tokensSold + tokensToReceive <= totalTokens, "Exceeds available supply");

        _verifyAuctionProof(proof);

        usedNullifiers[bytes32(nullifier)] = true;
        addressCommitments[msg.sender] = bytes32(commitment);

        bool saleIsCompleted = _finalizePurchaseState(tokensToReceive, costSEquiv);

        timeLock.recordPurchaseWithSybilProtection(
            msg.sender,
            tokensToReceive,
            proof,
            nullifier,
            commitment
        );

        token.safeTransferFrom(msg.sender, address(this), tokenCost);

        if (deferredSettlement) {
            privateEntitlement[bytes32(commitment)] += tokensToReceive;
        } else {
            agsToken.safeTransfer(msg.sender, tokensToReceive);
        }

        emit PrivatePurchase(bytes32(commitment), tokensToReceive, getCurrentPrice());

        if (saleIsCompleted) {
            emit SaleCompleted(tokensSold, getCurrentPrice());
        }
    }

    /**
     * @dev Legacy purchase function for backward compatibility (less private)
     * @param minTokensOut Minimum tokens expected (slippage protection)
     */
    function purchaseTokensLegacy(uint256 minTokensOut) external payable nonReentrant {
        require(isActive, "Sale not activated by admin");
        require(auctionStartTime > 0, "Sale not scheduled");
        require(block.timestamp >= auctionStartTime, "Sale not started");
        require(block.timestamp < auctionEndTime, "Sale ended");
        require(!saleCompleted, "Sale completed");
        require(msg.value >= MIN_PURCHASE_AMOUNT, "Below minimum purchase amount");

        // Flash loan protection: detect same-block manipulation
        _detectFlashLoan();

        uint256 currentPrice = getCurrentPrice();
        uint256 tokensToReceive = (msg.value * 1e18) / currentPrice;
        require(tokensToReceive >= minPurchase, "Below minimum purchase");
        
        // Slippage protection
        require(tokensToReceive >= minTokensOut, "Slippage too high");
        
        // Price manipulation protection
        uint256 priceImpact = _calculatePriceImpact(msg.value, tokensToReceive, currentPrice);
        require(priceImpact <= MAX_PRICE_IMPACT_BPS, "Price impact too high");
        
        uint256 cost = msg.value;

        if (tokensSold + tokensToReceive > totalTokens) {
            uint256 remainingTokens = totalTokens - tokensSold;
            cost = remainingTokens * currentPrice / 1e18;
            tokensToReceive = remainingTokens;
        }

        // Rate limiting: 1 hour between purchases for same address
        require(block.timestamp >= lastPurchaseTime[msg.sender] + 3600, "Rate limited");

        // CHECKS-EFFECTS-INTERACTIONS pattern: Update all state FIRST
        // Update state BEFORE external calls (CEI pattern)
        tokensSold = tokensSold + tokensToReceive;
        // Track ETH collected (use cost, not msg.value, to account for refunds)
        totalEthCollected = totalEthCollected + cost;
        purchaseAmounts[msg.sender] = purchaseAmounts[msg.sender] + tokensToReceive;
        lastPurchaseTime[msg.sender] = block.timestamp;
        
        // Update flash loan detection state
        _updateFlashLoanState();
        
        // Auto-complete sale if all tokens sold (update state before interactions)
        bool saleIsCompleted = tokensSold >= totalTokens;
        if (saleIsCompleted && !saleCompleted) {
            saleCompleted = true;
            saleCompletionTime = block.timestamp;  // Record actual completion time
        }

        // INTERACTIONS: External calls AFTER state updates
        if (deferredSettlement) {
            legacyEntitlement[msg.sender] += tokensToReceive;
        } else {
            // Transfer tokens AFTER state update
            agsToken.safeTransfer(msg.sender, tokensToReceive);
        }

        // Refund excess ETH if any (after token transfer)
        if (msg.value > cost) {
            (bool refundSuccess, ) = payable(msg.sender).call{value: msg.value - cost}("");
            require(refundSuccess, "ETH refund failed");
        }

        emit TokensPurchased(msg.sender, tokensToReceive, getCurrentPrice(), cost);
        
        if (saleIsCompleted) {
            emit SaleCompleted(tokensSold, getCurrentPrice());
        }
    }

    /**
     * @dev Internal function to check and update sale completion status
     * This ensures saleCompleted is set to true when end time is reached
     */
    function _checkAndCompleteSale() internal {
        if (auctionStartTime == 0) {
            return;
        }
        if (!saleCompleted && block.timestamp >= auctionEndTime) {
            saleCompleted = true;
            saleCompletionTime = block.timestamp;  // Record completion time (by time, not sellout)
            emit SaleCompleted(tokensSold, getCurrentPrice());
        }
        if (saleCompleted && !saleFinalized) {
            saleFinalized = true;
            if (finalizedAt == 0) {
                finalizedAt = block.timestamp;
            }
        }
    }

    /**
     * @dev Check and update sale completion status
     * @return True if sale is completed
     */
    function checkAndCompleteSale() external returns (bool) {
        _checkAndCompleteSale();
        return saleCompleted;
    }

    /**
     * @dev Explicitly finalize the sale; callable after sellout or time end.
     * Records finalizedAt for claim delay gating.
     */
    function finalizeSale() external returns (bool) {
        require(auctionStartTime > 0, "Sale not activated");
        if (!saleCompleted && block.timestamp < auctionEndTime) {
            revert("Sale not ended");
        }
        if (!saleCompleted) {
            saleCompleted = true;
            saleCompletionTime = block.timestamp;  // Record completion time
            emit SaleCompleted(tokensSold, getCurrentPrice());
        }
        if (!saleFinalized) {
            saleFinalized = true;
        }
        if (finalizedAt == 0) {
            finalizedAt = block.timestamp;
        }
        return true;
    }

    /**
     * @dev Check if purchase limits have expired (24 hours after sale completion)
     * @return True if limits have expired
     * @notice Uses actual sale completion time (for early sellout) or auctionEndTime (for time-based completion)
     */
    function purchaseLimitsExpired() public view returns (bool) {
        if (auctionStartTime == 0) {
            return false;
        }
        if (!saleCompleted && block.timestamp < auctionEndTime) {
            return false;
        }
        
        // Use actual completion time if sale ended early, otherwise use scheduled auction end
        uint256 effectiveEnd = saleCompletionTime > 0 ? saleCompletionTime : auctionEndTime;
            
        return block.timestamp >= effectiveEnd + 86400; // 24 hours after sale end
    }

    /**
     * @dev Get remaining tokens available for purchase
     */
    function getRemainingTokens() public view returns (uint256) {
        return totalTokens - tokensSold;
    }

    /**
     * @dev Get sale status information
     */
    function getSaleInfo() external view returns (
        uint256 currentPrice,
        uint256 remainingTokens,
        uint256 timeRemaining,
        bool isCompleted,
        bool limitsExpired
    ) {
        currentPrice = getCurrentPrice();
        remainingTokens = totalTokens - tokensSold;
        if (auctionStartTime == 0) {
            timeRemaining = auctionDuration;
            isCompleted = false;
        } else {
            timeRemaining = block.timestamp >= auctionEndTime ? 0 : auctionEndTime - block.timestamp;
            isCompleted = saleCompleted || block.timestamp >= auctionEndTime;
        }
        limitsExpired = purchaseLimitsExpired();
    }

    /**
     * @dev Sweep unsold sale AGS to `ecosystemProceedsSink` (not the literal DAO multisig unless that sink *is* the multisig).
     * @notice Callable by anyone after sale end + **30 days**. Ensures the 9.5M-sale remainder (and any unsold portion
     *         of the 10.5M public tranche held here) can exit the auction contract into ecosystem routing policy.
     * @notice Function name is legacy; event `UnsoldTokensTransferredToTreasury` refers to the sink address argument.
     */
    function transferUnsoldToTreasury() external {
        require(auctionStartTime > 0, "Sale not activated");
        require(saleCompleted || block.timestamp >= auctionEndTime, "Sale still active");
        
        // Use actual completion time if sale ended early, otherwise use auctionEndTime
        uint256 completionTime = saleCompletionTime > 0 ? saleCompletionTime : auctionEndTime;
        require(block.timestamp >= completionTime + 2592000, "Must wait 30 days after sale completion"); // 30 days
        
        uint256 unsoldTokens = totalTokens - tokensSold;
        if (unsoldTokens > 0) {
            agsToken.safeTransfer(ecosystemProceedsSink, unsoldTokens);
            
            emit UnsoldTokensTransferredToTreasury(ecosystemProceedsSink, unsoldTokens);
        }
    }

    /**
     * @notice Native S + wS held for Uniswap seeding (1:1 S-equivalent for the liquidity band).
     */
    function availableLiquidityQuote() public view returns (uint256) {
        uint256 quote = address(this).balance;
        if (address(payTokenWs) != address(0)) {
            quote += payTokenWs.balanceOf(address(this));
        }
        return quote;
    }

    /**
     * @notice Preview the liquidity bundle at the current mean price (view-only).
     */
    function previewLiquiditySeed()
        external
        view
        returns (uint256 agsToPair, uint256 quoteToPair, bool canSeed)
    {
        uint256 meanPrice = getMeanPrice();
        if (meanPrice == 0) {
            return (0, 0, false);
        }
        (agsToPair, quoteToPair) = _computeLiquidityBundle(meanPrice);
        canSeed = agsToPair > 0 && quoteToPair > 0;
    }

    function _computeLiquidityBundle(uint256 meanPrice)
        internal
        view
        returns (uint256 agsToSend, uint256 quoteToSend)
    {
        uint256 availableQuote = availableLiquidityQuote();
        uint256 availableAgs = agsToken.balanceOf(address(this));
        if (availableQuote == 0 || availableAgs == 0 || meanPrice == 0) {
            return (0, 0);
        }

        agsToSend = liquiditySeedAgs;
        if (agsToSend > availableAgs) {
            agsToSend = availableAgs;
        }

        quoteToSend = Math.mulDiv(agsToSend, meanPrice, 1e18);
        if (quoteToSend > availableQuote) {
            quoteToSend = availableQuote;
            agsToSend = Math.mulDiv(quoteToSend, 1e18, meanPrice);
        }

        if (agsToSend > availableAgs) {
            agsToSend = availableAgs;
            quoteToSend = Math.mulDiv(agsToSend, meanPrice, 1e18);
            if (quoteToSend > availableQuote) {
                quoteToSend = availableQuote;
            }
        }
    }

    function _completionTimestamp() internal view returns (uint256) {
        return saleCompletionTime > 0 ? saleCompletionTime : auctionEndTime;
    }

    function _liquidityDelayElapsed() internal view returns (bool) {
        if (auctionStartTime == 0) return false;
        return block.timestamp >= _completionTimestamp() + 86400;
    }

    function _ensureSaleMarkedComplete() internal {
        if (!saleCompleted && block.timestamp >= auctionEndTime) {
            saleCompleted = true;
            saleCompletionTime = block.timestamp;
            emit SaleCompleted(tokensSold, getCurrentPrice());
        }
        if (saleCompleted && !saleFinalized) {
            saleFinalized = true;
            if (finalizedAt == 0) {
                finalizedAt = block.timestamp;
            }
        }
    }

    function _convertProceedsToWsForLiquidity() internal {
        if (swapRouter02 == address(0) || address(payTokenWs) == address(0)) {
            return;
        }
        _swapPayTokenBalanceToWs(payTokenWeth);
        _swapPayTokenBalanceToWs(payTokenUsdc);
        _swapPayTokenBalanceToWs(payTokenUsdt);
        _swapPayTokenBalanceToWs(payTokenEurc);
    }

    function _swapPayTokenBalanceToWs(IERC20 token) private {
        if (address(token) == address(0)) {
            return;
        }
        uint256 bal = token.balanceOf(address(this));
        if (bal == 0) {
            return;
        }

        uint256 minOut = _tokenToSEquivWei(token, bal);
        minOut = Math.mulDiv(minOut, 10000 - SETTLEMENT_SWAP_SLIPPAGE_BPS, 10000);

        token.forceApprove(swapRouter02, bal);

        ISwapRouter02.ExactInputSingleParams memory params = ISwapRouter02.ExactInputSingleParams({
            tokenIn: address(token),
            tokenOut: address(payTokenWs),
            fee: SETTLEMENT_POOL_FEE,
            recipient: address(this),
            amountIn: bal,
            amountOutMinimum: minOut,
            sqrtPriceLimitX96: 0
        });

        try ISwapRouter02(swapRouter02).exactInputSingle(params) returns (uint256 amountOut) {
            emit PayTokenSwappedToWs(address(token), bal, amountOut);
        } catch {
            // Pool may be missing or illiquid — proceeds remain for sweepProceedsToSink.
        }

        token.forceApprove(swapRouter02, 0);
    }

    function _prepareAndSeedLiquidity() internal returns (bool sent) {
        _convertProceedsToWsForLiquidity();
        return _executeLiquiditySeed();
    }

    function _executeLiquiditySeed() internal returns (bool sent) {
        uint256 meanPrice = getMeanPrice();
        if (meanPrice == 0 || tokensSold == 0) {
            return false;
        }

        (uint256 agsToSend, uint256 quoteToSend) = _computeLiquidityBundle(meanPrice);
        if (agsToSend == 0 || quoteToSend == 0) {
            return false;
        }

        liquidityFundsSent = true;

        uint256 nativeSend = Math.min(address(this).balance, quoteToSend);
        uint256 wsSend = quoteToSend - nativeSend;
        if (wsSend > 0) {
            require(address(payTokenWs) != address(0), "wS rail required for liquidity");
            payTokenWs.safeTransfer(liquidityDeployer, wsSend);
        }

        agsToken.safeTransfer(liquidityDeployer, agsToSend);
        IAutomatedLiquidityDeployer(liquidityDeployer).seedFromAuction{value: nativeSend}(meanPrice, agsToSend);

        emit LiquidityFundsSent(liquidityDeployer, agsToSend, quoteToSend);
        return true;
    }

    /**
     * @dev Permissionless post-sale settlement: finalize (if needed) and seed Uniswap liquidity after the 24h delay.
     * @return seeded True when liquidity was seeded in this call.
     */
    function settlePostSale() external nonReentrant returns (bool seeded) {
        if (auctionStartTime == 0 || liquidityFundsSent) {
            return liquidityFundsSent;
        }
        if (!saleCompleted && block.timestamp < auctionEndTime) {
            return false;
        }

        _ensureSaleMarkedComplete();
        if (!saleFinalized) {
            saleFinalized = true;
            if (finalizedAt == 0) {
                finalizedAt = block.timestamp;
            }
        }
        if (!_liquidityDelayElapsed()) {
            return false;
        }

        return _prepareAndSeedLiquidity();
    }

    /**
     * @dev Automatically check conditions and seed liquidity if ready (keeper-friendly).
     * @notice Uses native S + wS held in this contract; scales the 1M AGS band proportionally when quote is short.
     * @return sent True if funds were sent, false if conditions not met
     */
    function checkAndSendLiquidityFunds() public returns (bool sent) {
        if (auctionStartTime == 0 || liquidityFundsSent) {
            return false;
        }
        if (!saleCompleted && block.timestamp < auctionEndTime) {
            return false;
        }
        _ensureSaleMarkedComplete();
        if (!_liquidityDelayElapsed()) {
            return false;
        }
        return _prepareAndSeedLiquidity();
    }

    /**
     * @dev Manually send liquidity funds (legacy alias — prefer `settlePostSale()`).
     */
    function sendLiquidityFunds() external {
        require(auctionStartTime > 0, "Sale not activated");
        require(!liquidityFundsSent, "Liquidity funds already sent");
        require(saleCompleted || block.timestamp >= auctionEndTime, "Sale still active");
        require(_liquidityDelayElapsed(), "Must wait 24h after sale completion");

        uint256 meanPrice = getMeanPrice();
        require(meanPrice > 0, "Mean price not available (no tokens sold)");
        require(_prepareAndSeedLiquidity(), "Insufficient liquidity quote");
    }

    /**
     * @dev Sweep all pay-rail balances to `ecosystemProceedsSink` after liquidity is seeded.
     * @notice Callable by anyone once `liquidityFundsSent` is true (no extra delay).
     */
    function sweepProceedsToSink() external nonReentrant {
        require(liquidityFundsSent, "Liquidity not seeded");
        _sweepAllPayRailsToSink();
    }

    function _sweepErc20Rail(IERC20 token) private {
        if (address(token) == address(0)) {
            return;
        }
        uint256 bal = token.balanceOf(address(this));
        if (bal > 0) {
            token.safeTransfer(ecosystemProceedsSink, bal);
        }
    }

    function _sweepAllPayRailsToSink() internal {
        uint256 nativeBal = address(this).balance;
        if (nativeBal > 0) {
            (bool success, ) = payable(ecosystemProceedsSink).call{value: nativeBal}("");
            require(success, "SONIC transfer to ecosystem sink failed");
        }
        _sweepErc20Rail(payTokenWs);
        _sweepErc20Rail(payTokenWeth);
        _sweepErc20Rail(payTokenUsdc);
        _sweepErc20Rail(payTokenUsdt);
        _sweepErc20Rail(payTokenEurc);
    }

    /**
     * @dev Withdraw proceeds after liquidity seeding + 30 days (legacy entry point).
     * @notice Attempts automatic liquidity seeding first, then sweeps all pay rails to the ecosystem sink.
     */
    function withdrawProceeds() external {
        require(auctionStartTime > 0, "Sale not activated");
        require(saleCompleted || block.timestamp >= auctionEndTime, "Sale still active");

        uint256 completionTime = _completionTimestamp();
        require(block.timestamp >= completionTime + 2592000, "Must wait 30 days after sale completion");

        if (!liquidityFundsSent) {
            _ensureSaleMarkedComplete();
            if (_liquidityDelayElapsed()) {
                _prepareAndSeedLiquidity();
            }
        }
        require(liquidityFundsSent, "Liquidity not seeded");

        _sweepAllPayRailsToSink();
    }

    // ============ VIEW FUNCTIONS ============

    /**
     * @dev Calculate the mean (average) price from all purchases
     * @return meanPrice Mean **wei S per 1e18 wei AGS** (totalEthCollected is S-equivalent wei including ERC-20 rails)
     * @notice Returns 0 if no tokens have been sold yet
     */
    function getMeanPrice() public view returns (uint256 meanPrice) {
        if (tokensSold == 0) {
            return 0;  // No tokens sold yet, cannot calculate mean
        }
        // Mean price = total ETH collected / total tokens sold
        // Multiply by 1e18 first to maintain precision, then divide
        return (totalEthCollected * 1e18) / tokensSold;
    }

    /**
     * @dev Get auction statistics including mean price
     * @return meanPrice Mean price from all purchases
     * @return totalEth Total ETH collected
     * @return totalTokensSold Total tokens sold
     */
    function getAuctionStatistics() external view returns (
        uint256 meanPrice,
        uint256 totalEth,
        uint256 totalTokensSold
    ) {
        return (getMeanPrice(), totalEthCollected, tokensSold);
    }

    /**
     * @dev Get user's purchase information
     */
    function getUserPurchaseInfo(address user) external view returns (
        uint256 purchased,
        uint256 remaining,
        bool canPurchase,
        uint256 nextPurchaseTime
    ) {
        purchased = purchaseAmounts[user];
        remaining = purchaseLimitsExpired() ? type(uint256).max : maxPerAddress - purchased;
        nextPurchaseTime = lastPurchaseTime[user] + 3600; // 1 hour cooldown
        canPurchase = block.timestamp >= lastPurchaseTime[user] + 3600 &&
                     remaining > 0;
    }

    /**
     * @dev View: is deferred settlement enabled
     */
    function isDeferredSettlement() external view returns (bool) {
        return deferredSettlement;
    }

    /**
     * @dev Claim legacy entitlements after sale finalization + 24h
     */
    function claim() external nonReentrant {
        require(deferredSettlement, "Deferred off");
        require(auctionStartTime > 0, "Sale not activated");
        require(saleCompleted || block.timestamp >= auctionEndTime, "Sale active");
        uint256 gateTime = finalizedAt == 0 ? (auctionEndTime + 86400) : (finalizedAt + 86400);
        require(block.timestamp >= gateTime, "Claim locked 24h");

        uint256 amount = legacyEntitlement[msg.sender];
        require(amount > 0, "Nothing to claim");
        legacyEntitlement[msg.sender] = 0;
        agsToken.safeTransfer(msg.sender, amount);
    }

    /**
     * @dev Claim private entitlements after sale finalization + 24h
     * Note: ties claim to the original sender stored in addressCommitments for minimal integration.
     * For full privacy claims, integrate a claim-proof circuit.
     */
    function claimPrivate(
        bytes32 commitment,
        uint256[8] calldata proof,
        uint256[] calldata publicInputs
    ) external nonReentrant {
        require(deferredSettlement, "Deferred off");
        require(auctionStartTime > 0, "Sale not activated");
        require(saleCompleted || block.timestamp >= auctionEndTime, "Sale active");
        uint256 gateTime = finalizedAt == 0 ? (auctionEndTime + 86400) : (finalizedAt + 86400);
        require(block.timestamp >= gateTime, "Claim locked 24h");

        uint256 amount = privateEntitlement[commitment];
        require(amount > 0, "Nothing to claim");

        // Verify claim proof via VerifierFactory ("auction-claim" circuit)
        IVerifier claimVerifier = IVerifier(verifierFactory.getVerifier("auction-claim"));
        require(address(claimVerifier) != address(0), "Claim verifier not found");

        // Public inputs convention:
        // [0] = commitment (field), [1] = recipient (uint160(msg.sender))
        require(publicInputs.length >= 2, "Invalid public inputs");
        require(publicInputs[0] == uint256(commitment), "Commitment mismatch");
        require(publicInputs[1] == uint256(uint160(msg.sender)), "Recipient mismatch");

        require(claimVerifier.verifyProof(proof, publicInputs), "Invalid claim proof");

        // Clear entitlement and transfer
        privateEntitlement[commitment] = 0;
        agsToken.safeTransfer(msg.sender, amount);
    }

    // ============ SECURITY FUNCTIONS ============
    
    /**
     * @dev Detect flash loan attacks by checking same-block reserve changes
     * @notice Reverts if flash loan detected (>10% change in same block)
     */
    function _detectFlashLoan() internal {
        if (lastPurchaseBlock > 0 && uint256(lastPurchaseBlock) == block.number) {
            // Same block purchase detected - check for manipulation
            uint256 blockTokensChange = tokensSold - lastBlockTokensSold;
            uint256 blockEthChange = totalEthCollected - lastBlockEthCollected;
            
            // Calculate percentage change
            if (lastBlockTokensSold > 0) {
                uint256 tokensChangeBps = (blockTokensChange * 10000) / lastBlockTokensSold;
                if (tokensChangeBps > FLASH_LOAN_THRESHOLD_BPS) {
                    emit FlashLoanDetected(msg.sender, block.number);
                    revert("Flash loan detected");
                }
            }
            
            if (lastBlockEthCollected > 0) {
                uint256 ethChangeBps = (blockEthChange * 10000) / lastBlockEthCollected;
                if (ethChangeBps > FLASH_LOAN_THRESHOLD_BPS) {
                    emit FlashLoanDetected(msg.sender, block.number);
                    revert("Flash loan detected");
                }
            }
        }
    }
    
    /**
     * @dev Update flash loan detection state after purchase
     */
    function _updateFlashLoanState() internal {
        if (uint256(lastPurchaseBlock) != block.number) {
            // New block - reset tracking
            lastPurchaseBlock = uint32(block.number);
            lastBlockTokensSold = tokensSold;
            lastBlockEthCollected = totalEthCollected;
        }
    }
    
    /**
     * @dev Calculate price impact of a purchase
     * @param ethAmount ETH amount being spent
     * @param tokensReceived Tokens being received
     * @param currentPrice Current price before purchase
     * @return priceImpactBps Price impact in basis points
     */
    function _calculatePriceImpact(
        uint256 ethAmount,
        uint256 tokensReceived,
        uint256 currentPrice
    ) internal view returns (uint256 priceImpactBps) {
        if (tokensSold == 0) {
            return 0; // First purchase, no impact
        }
        
        // Calculate effective price paid
        uint256 effectivePrice = (ethAmount * 1e18) / tokensReceived;
        
        // Calculate price impact
        if (effectivePrice > currentPrice) {
            priceImpactBps = ((effectivePrice - currentPrice) * 10000) / currentPrice;
        } else {
            priceImpactBps = ((currentPrice - effectivePrice) * 10000) / currentPrice;
        }
    }

    // ============ RECEIVE FUNCTION ============
    receive() external payable {
        // Disable automatic purchases via receive() to prevent attacks
        // Users must explicitly call purchaseTokensLegacy() with slippage protection
        revert("Use purchaseTokensLegacy() with slippage protection");
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

    // ============ ADMIN FUNCTIONS ============

    /**
     * @notice Cap AGS sent to Uniswap v3 at post-sale seeding (default 1M). Lower before `activate()` to keep
     *         more auction quote in treasury for `TreasuryLiquidityAllocator` / ops runway.
     */
    function setLiquiditySeedAgs(uint256 amount) external onlyOwner {
        require(auctionStartTime == 0, "Sale window already scheduled");
        require(amount > 0 && amount <= LIQUIDITY_TOKEN_AMOUNT, "Invalid seed amount");
        emit LiquiditySeedAgsUpdated(liquiditySeedAgs, amount);
        liquiditySeedAgs = amount;
    }
    
    /**
     * @dev Activate the sale (only `owner` — launch admin / DAO multisig). Starts the Dutch clock for `auctionDuration`.
     * @notice The sale does not accept purchases until this is called, even though the contract is deployed.
     */
    function activate() external onlyOwner {
        require(!isActive, "Sale already activated");
        require(auctionStartTime == 0, "Sale window already scheduled");
        auctionStartTime = block.timestamp;
        auctionEndTime = block.timestamp + auctionDuration;
        isActive = true;
        emit SaleActivated(msg.sender, block.timestamp);
    }
    
    /**
     * @dev Set the time lock contract address (can only be set once)
     * @param _timeLock Address of the TimeLockPurchaseLimits contract
     */
    function setTimeLock(address _timeLock) external onlyOwner {
        require(address(timeLock) == address(0), "Time lock already set");
        require(_timeLock != address(0), "Invalid time lock address");
        timeLock = TimeLockPurchaseLimits(_timeLock);
    }

    /**
     * @dev Enable or disable deferred settlement. Can only be set once and only before sale starts.
     */
    function setDeferredSettlement(bool enabled) external onlyOwner {
        require(!deferredSettlementFrozen, "Deferred frozen");
        require(auctionStartTime == 0, "Already started");
        deferredSettlement = enabled;
        deferredSettlementFrozen = true;
    }
}
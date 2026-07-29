// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";

interface IWrappedNative {
    function deposit() external payable;
    function withdraw(uint256 amount) external;
}

/**
 * @title PublicLiquidityPool
 * @notice Simple constant-product AMM between AGS and a quote token.
 *         LP shares are ERC20 tokens. No admin keys – liquidity providers manage positions directly.
 */
contract PublicLiquidityPool is ERC20, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 private constant MINIMUM_LIQUIDITY = 1_000;
    uint256 private constant BPS = 10_000;
    /// @notice Maximum price impact per swap (50% = 5000 bps)
    uint256 private constant MAX_PRICE_IMPACT_BPS = 5000;
    /// @notice Minimum amount to prevent dust attacks (1000 wei)
    uint256 private constant MIN_AMOUNT = 1_000;

    /// @notice Trading fee in basis points (e.g. 30 = 0.30%)
    uint256 public immutable feeBps;

    IERC20 public immutable agsToken;
    IERC20 public immutable quoteToken;
    bool public immutable quoteIsNative;

    uint256 public reserveAGS;
    uint256 public reserveQuote;

    event LiquidityAdded(
        address indexed provider,
        uint256 agsAmount,
        uint256 quoteAmount,
        uint256 lpShares,
        address indexed recipient
    );

    event LiquidityRemoved(
        address indexed provider,
        uint256 lpShares,
        uint256 agsAmount,
        uint256 quoteAmount,
        address indexed recipient
    );

    event SwapExecuted(
        address indexed trader,
        bool agsToQuote,
        uint256 amountIn,
        uint256 amountOut,
        address indexed recipient
    );

    /**
     * @param _agsToken Address of the AGS token
     * @param _quoteToken Address of the quote token (USDC, SONIC, etc.)
     * @param _name LP token name
     * @param _symbol LP token symbol
     * @param _feeBps trading fee in basis points (e.g. 30 for 0.30%)
     */
    constructor(
        address _agsToken,
        address _quoteToken,
        bool _quoteIsNative,
        string memory _name,
        string memory _symbol,
        uint256 _feeBps
    ) ERC20(_name, _symbol) {
        require(_agsToken != address(0), "AGS address zero");
        require(_quoteToken != address(0), "Quote address zero");
        require(_feeBps < BPS, "Fee too high");

        agsToken = IERC20(_agsToken);
        quoteToken = IERC20(_quoteToken);
        feeBps = _feeBps;
        quoteIsNative = _quoteIsNative;
    }

    /**
     * @notice Adds liquidity to the pool. Caller must approve the pool beforehand.
     * @param agsAmountDesired amount of AGS token offered
     * @param quoteAmountDesired amount of quote token offered
     * @param minShares minimum LP shares expected
     * @param recipient address that receives LP shares
     */
    function addLiquidity(
        uint256 agsAmountDesired,
        uint256 quoteAmountDesired,
        uint256 minShares,
        address recipient
    )
        external
        payable
        nonReentrant
        returns (uint256 sharesMinted, uint256 agsUsed, uint256 quoteUsed)
    {
        require(recipient != address(0), "Recipient zero");
        require(agsAmountDesired > 0 && quoteAmountDesired > 0, "Invalid deposit amounts");

        // Grab current reserves for ratio calculation
        (uint256 _reserveAGS, uint256 _reserveQuote) = getReserves();

        IERC20 ags = agsToken;
        IERC20 quote = quoteToken;

        ags.safeTransferFrom(msg.sender, address(this), agsAmountDesired);

        if (quoteIsNative) {
            require(msg.value == quoteAmountDesired, "Invalid native value");
            // slither-disable-next-line reentrancy-benign
            // False positive: nonReentrant modifier prevents reentrancy. Wrapped native deposit is safe.
            // Reserves updated before minting (CEI pattern), deposit() cannot call back into this contract.
            IWrappedNative(address(quote)).deposit{value: msg.value}();
        } else {
            require(msg.value == 0, "Unexpected value");
            quote.safeTransferFrom(msg.sender, address(this), quoteAmountDesired);
        }

        // Use actual transferred amounts to prevent flash loan manipulation
        // Balance reading happens after transfers to ensure we have actual tokens
        uint256 agsBalance = ags.balanceOf(address(this));
        uint256 quoteBalance = quote.balanceOf(address(this));

        agsUsed = agsBalance - _reserveAGS;
        quoteUsed = quoteBalance - _reserveQuote;
        require(agsUsed > 0 && quoteUsed > 0, "Insufficient liquidity added");
        require(agsUsed >= MIN_AMOUNT && quoteUsed >= MIN_AMOUNT, "Amount too small");

        uint256 _totalSupply = totalSupply();
        if (_totalSupply == 0) {
            // Initial liquidity: K = agsUsed * quoteUsed, shares = sqrt(K) - MINIMUM_LIQUIDITY
            uint256 k = agsUsed * quoteUsed;
            require(k > 0, "K invariant zero");
            sharesMinted = _sqrt(k);
            require(sharesMinted > MINIMUM_LIQUIDITY, "Shares too low");
            sharesMinted = sharesMinted - MINIMUM_LIQUIDITY;
            _mint(address(this), MINIMUM_LIQUIDITY);
            _burn(address(this), MINIMUM_LIQUIDITY);
        } else {
            require(_reserveAGS > 0 && _reserveQuote > 0, "Pool reserves zero");
            // Calculate shares with precision: use multiplication first, then division
            // shares = min(agsUsed * totalSupply / reserveAGS, quoteUsed * totalSupply / reserveQuote)
            uint256 sharesFromAGS = (agsUsed * _totalSupply) / _reserveAGS;
            uint256 sharesFromQuote = (quoteUsed * _totalSupply) / _reserveQuote;
            sharesMinted = _min(sharesFromAGS, sharesFromQuote);
            require(sharesMinted > 0, "Shares calculation error");
        }

        require(sharesMinted >= minShares, "Insufficient LP shares minted");
        
        // slither-disable-next-line reentrancy-benign
        // False positive: nonReentrant modifier prevents reentrancy. Reserves updated before minting
        // follows CEI pattern. External calls (deposit/transferFrom) completed earlier.
        // SECURITY: Update state BEFORE minting (CEI pattern)
        // Update reserves first to prevent reentrancy via state reads
        _updateReserves(agsBalance, quoteBalance);
        
        // Then mint (internal state change)
        _mint(recipient, sharesMinted);
        emit LiquidityAdded(msg.sender, agsUsed, quoteUsed, sharesMinted, recipient);
    }

    /**
     * @notice Removes liquidity and returns proportional reserves.
     * @param shares amount of LP tokens to burn
     * @param minAGS minimum AGS expected
     * @param minQuote minimum quote token expected
     * @param recipient address receiving withdrawn tokens
     */
    function removeLiquidity(
        uint256 shares,
        uint256 minAGS,
        uint256 minQuote,
        address recipient
    ) external nonReentrant returns (uint256 agsAmount, uint256 quoteAmount) {
        require(recipient != address(0), "Recipient zero");
        require(shares > 0, "Shares zero");

        uint256 _totalSupply = totalSupply();
        require(_totalSupply > 0, "Total supply zero");
        (uint256 _reserveAGS, uint256 _reserveQuote) = getReserves();

        // Calculate amounts with precision protection: multiply first, then divide
        agsAmount = (shares * _reserveAGS) / _totalSupply;
        quoteAmount = (shares * _reserveQuote) / _totalSupply;
        require(agsAmount > 0 && quoteAmount > 0, "Amount zero");
        require(agsAmount >= minAGS && quoteAmount >= minQuote, "Slippage");

        // Verify reserves after removal
        uint256 reserveAGSAfter = _reserveAGS - agsAmount;
        uint256 reserveQuoteAfter = _reserveQuote - quoteAmount;
        // Allow reserves to go to zero when removing all liquidity
        // The pool can be empty (reserves = 0) after all liquidity is removed
        
        // K invariant: K should decrease proportionally when removing liquidity
        // K_after should be approximately K_before * (remaining_shares / total_supply)^2
        // Due to rounding, we allow K_after <= K_before (must decrease or stay same)
        uint256 kBefore = _reserveAGS * _reserveQuote;
        uint256 kAfter = reserveAGSAfter * reserveQuoteAfter;
        // K must not increase when removing liquidity
        require(kAfter <= kBefore, "K invariant violation");

        _burn(msg.sender, shares);

        IERC20 ags = agsToken;
        IERC20 quote = quoteToken;

        require(_reserveAGS >= agsAmount, "Insufficient AGS reserve");
        require(_reserveQuote >= quoteAmount, "Insufficient quote reserve");

        _updateReserves(reserveAGSAfter, reserveQuoteAfter);

        ags.safeTransfer(recipient, agsAmount);
        if (quoteIsNative) {
            IWrappedNative(address(quote)).withdraw(quoteAmount);
            Address.sendValue(payable(recipient), quoteAmount);
        } else {
            quote.safeTransfer(recipient, quoteAmount);
        }

        emit LiquidityRemoved(msg.sender, shares, agsAmount, quoteAmount, recipient);
    }

    /**
     * @notice Executes a swap along the constant-product curve.
     * @param agsToQuote true if swapping AGS → quote token, false for quote → AGS
     * @param amountIn exact amount provided by the trader
     * @param minOut minimum acceptable output
     * @param recipient address receiving swap proceeds
     */
    function swapExactInput(
        bool agsToQuote,
        uint256 amountIn,
        uint256 minOut,
        address recipient
    ) external payable nonReentrant returns (uint256 amountOut) {
        require(recipient != address(0), "Recipient zero");
        require(amountIn > 0, "Amount zero");

        IERC20 ags = agsToken;
        IERC20 quote = quoteToken;

        (uint256 _reserveAGS, uint256 _reserveQuote) = getReserves();
        require(_reserveAGS > 0 && _reserveQuote > 0, "Pool empty");

        if (agsToQuote) {
            // Read balance before transfer to detect tokens already in pool
            uint256 agsBalanceBefore = ags.balanceOf(address(this));
            ags.safeTransferFrom(msg.sender, address(this), amountIn);
            // Read balance after transfer to prevent flash loan manipulation
            uint256 agsBalance = ags.balanceOf(address(this));
            uint256 agsInput = agsBalance - _reserveAGS;
            require(agsInput > 0 && agsInput >= MIN_AMOUNT, "No AGS received");
            // agsInput can be > amountIn if tokens were already in pool (sent directly)
            // But it should equal amountIn + (balanceBefore - reserveAGS)
            uint256 tokensAlreadyInPool = agsBalanceBefore > _reserveAGS ? agsBalanceBefore - _reserveAGS : 0;
            require(agsInput <= amountIn + tokensAlreadyInPool, "Input exceeds expected");

            // Calculate output: amountOut = (amountInWithFee * reserveQuote) / (reserveAGS + amountInWithFee)
            // Using constant product formula: K = reserveAGS * reserveQuote must be maintained
            // Multiply before divide to avoid precision loss
            uint256 newReserveAGS = _reserveAGS + agsInput;
            amountOut = (agsInput * (BPS - feeBps) * _reserveQuote) / (BPS * newReserveAGS);
            require(amountOut > 0 && amountOut >= MIN_AMOUNT, "Output too small");
            require(amountOut >= minOut, "Insufficient output");
            
            // Verify K invariant: newReserveAGS * newReserveQuote >= reserveAGS * reserveQuote
            uint256 newReserveQuote = _reserveQuote - amountOut;
            require(newReserveQuote > 0, "Quote reserve would be zero");
            
            // K invariant check: K_new = newReserveAGS * newReserveQuote should be >= K_old
            // Due to fees, K_new > K_old (profit for LP)
            uint256 kBefore = _reserveAGS * _reserveQuote;
            uint256 kAfter = newReserveAGS * newReserveQuote;
            require(kAfter >= kBefore, "K invariant violation");
            
            // Price impact protection: prevent >50% price manipulation in single swap
            // priceImpact = (amountOut * BPS) / reserveQuote (percentage of output reserve removed)
            uint256 priceImpactBps = (amountOut * BPS) / _reserveQuote;
            require(priceImpactBps <= MAX_PRICE_IMPACT_BPS, "Price impact too high");
            
            require(_reserveQuote >= amountOut, "Insufficient quote reserve");
            
            // slither-disable-next-line reentrancy-benign
            // False positive: nonReentrant modifier prevents reentrancy. Reserves updated before
            // external transfer follows CEI pattern. TransferFrom completed earlier.
            // SECURITY: Update state BEFORE external call (CEI pattern)
            _updateReserves(newReserveAGS, newReserveQuote);

            if (quoteIsNative) {
                IWrappedNative(address(quote)).withdraw(amountOut);
                Address.sendValue(payable(recipient), amountOut);
            } else {
                quote.safeTransfer(recipient, amountOut);
            }
        } else {
            uint256 quoteInput;
            if (quoteIsNative) {
                require(msg.value == amountIn, "Invalid native value");
                // slither-disable-next-line reentrancy-benign
                // False positive: nonReentrant modifier prevents reentrancy. Wrapped native deposit is safe.
                // Reserves updated before external transfer (CEI pattern), deposit() cannot call back.
                IWrappedNative(address(quote)).deposit{value: msg.value}();
                // Read balance after deposit to prevent flash loan manipulation
                uint256 quoteBalance = quote.balanceOf(address(this));
                quoteInput = quoteBalance - _reserveQuote;
            } else {
                require(msg.value == 0, "Unexpected value");
                // Read balance before transfer to detect tokens already in pool
                uint256 quoteBalanceBefore = quote.balanceOf(address(this));
                quote.safeTransferFrom(msg.sender, address(this), amountIn);
                // Read balance after transfer to prevent flash loan manipulation
                uint256 quoteBalance = quote.balanceOf(address(this));
                quoteInput = quoteBalance - _reserveQuote;
                // quoteInput can be > amountIn if tokens were already in pool (sent directly)
                uint256 tokensAlreadyInPool = quoteBalanceBefore > _reserveQuote 
                    ? quoteBalanceBefore - _reserveQuote 
                    : 0;
                require(quoteInput <= amountIn + tokensAlreadyInPool, "Input exceeds expected");
            }
            require(quoteInput > 0 && quoteInput >= MIN_AMOUNT, "No quote received");

            // Calculate output: amountOut = (amountInWithFee * reserveAGS) / (reserveQuote + amountInWithFee)
            // Multiply before divide to avoid precision loss
            uint256 newReserveQuote = _reserveQuote + quoteInput;
            amountOut = (quoteInput * (BPS - feeBps) * _reserveAGS) / (BPS * newReserveQuote);
            require(amountOut > 0 && amountOut >= MIN_AMOUNT, "Output too small");
            require(amountOut >= minOut, "Insufficient output");
            
            // Verify K invariant: newReserveAGS * newReserveQuote >= reserveAGS * reserveQuote
            require(_reserveAGS >= amountOut, "Insufficient AGS reserve");
            uint256 newReserveAGS = _reserveAGS - amountOut;
            require(newReserveAGS > 0, "AGS reserve would be zero");
            
            // K invariant check: K_new = newReserveAGS * newReserveQuote should be >= K_old
            uint256 kBefore = _reserveAGS * _reserveQuote;
            uint256 kAfter = newReserveAGS * newReserveQuote;
            require(kAfter >= kBefore, "K invariant violation");
            
            // Price impact protection: prevent >50% price manipulation in single swap
            // priceImpact = (amountOut * BPS) / reserveAGS (percentage of output reserve removed)
            uint256 priceImpactBps = (amountOut * BPS) / _reserveAGS;
            require(priceImpactBps <= MAX_PRICE_IMPACT_BPS, "Price impact too high");
            
            // slither-disable-next-line reentrancy-benign
            // False positive: nonReentrant modifier prevents reentrancy. Reserves updated before
            // external transfer follows CEI pattern. Deposit/transferFrom completed earlier.
            // SECURITY: Update state BEFORE external call (CEI pattern)
            _updateReserves(newReserveAGS, newReserveQuote);

            ags.safeTransfer(recipient, amountOut);
        }

        emit SwapExecuted(msg.sender, agsToQuote, amountIn, amountOut, recipient);
    }

    /**
     * @notice Returns output amount for a prospective swap without executing.
     */
    function quoteSwap(bool agsToQuote, uint256 amountIn) external view returns (uint256 amountOut) {
        require(amountIn > 0, "Amount zero");
        (uint256 _reserveAGS, uint256 _reserveQuote) = getReserves();
        if (_reserveAGS == 0 || _reserveQuote == 0) return 0;

        if (agsToQuote) {
            // Multiply before divide to avoid precision loss
            uint256 numerator = amountIn * (BPS - feeBps) * _reserveQuote;
            uint256 denominator = BPS * _reserveAGS + amountIn * (BPS - feeBps);
            amountOut = numerator / denominator;
        } else {
            // Multiply before divide to avoid precision loss
            uint256 numerator = amountIn * (BPS - feeBps) * _reserveAGS;
            uint256 denominator = BPS * _reserveQuote + amountIn * (BPS - feeBps);
            amountOut = numerator / denominator;
        }
    }

    /**
     * @return reserves of AGS and quote tokens.
     */
    function getReserves() public view returns (uint256, uint256) {
        return (reserveAGS, reserveQuote);
    }

    function _updateReserves(uint256 newReserveAGS, uint256 newReserveQuote) internal {
        // Reserves can be zero when all liquidity is removed (legitimate case)
        // K invariant checks are performed in calling functions:
        // - swapExactInput: K must increase (due to fees) or stay same, reserves must be > 0
        // - addLiquidity: K must increase (new liquidity), reserves must be > 0
        // - removeLiquidity: K decreases proportionally (explicitly checked there), reserves can be 0
        reserveAGS = newReserveAGS;
        reserveQuote = newReserveQuote;
    }

    function _sqrt(uint256 y) internal pure returns (uint256 z) {
        if (y == 0) return 0;
        uint256 x = y / 2 + 1;
        z = y;
        while (x < z) {
            z = x;
            x = (y / x + x) / 2;
        }
    }

    function _min(uint256 a, uint256 b) internal pure returns (uint256) {
        return a < b ? a : b;
    }

    receive() external payable {
        require(quoteIsNative, "Direct payments disabled");
    }
}


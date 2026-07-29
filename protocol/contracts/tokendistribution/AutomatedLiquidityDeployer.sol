// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {IWETH9} from "./interfaces/IWETH9.sol";
import {IUniswapV3NpmLike} from "./interfaces/IUniswapV3NpmLike.sol";
import {IAutomatedLiquidityDeployer} from "./interfaces/IAutomatedLiquidityDeployer.sol";
import {UniswapV3PriceLib} from "./libs/UniswapV3PriceLib.sol";

/**
 * @title AutomatedLiquidityDeployer
 * @notice Receives AGS + quote from a trusted auction, wraps native, and seeds the canonical Uniswap v3 AGS/wS pool.
 * @dev Post-sale flow is **permissionless**: the auction calls `seedFromAuction` after the 24h delay.
 *      `mintInitialLiquidity` remains for governance overrides (custom ticks / recovery).
 */
contract AutomatedLiquidityDeployer is Ownable, ReentrancyGuard, IAutomatedLiquidityDeployer {
    using SafeERC20 for IERC20;
    using Address for address payable;

    IERC20 public immutable agsToken;
    IWETH9 public immutable weth9;
    IUniswapV3NpmLike public immutable positionManager;
    uint24 public immutable poolFee;

    /// @dev Full-range ticks for 0.3% fee tier (tick spacing 60).
    int24 public constant DEFAULT_TICK_LOWER = -887220;
    int24 public constant DEFAULT_TICK_UPPER = 887220;

    /// @notice Receives unsold / scaled-out AGS and dust after seeding.
    address public excessTokenSink;
    /// @notice NFT recipient for the Uniswap v3 position (often a timelock or ops Safe).
    address public positionRecipient;
    /// @notice Allowlist for push-based auction settlement.
    address public trustedAuction;

    bool public liquiditySeeded;

    event ExcessSinkUpdated(address indexed previousSink, address indexed newSink);
    event PositionRecipientUpdated(address indexed previousRecipient, address indexed newRecipient);
    event TrustedAuctionUpdated(address indexed previousAuction, address indexed newAuction);
    event InitialLiquidityMinted(
        uint256 indexed tokenId,
        uint128 liquidity,
        uint256 amount0Used,
        uint256 amount1Used,
        uint160 sqrtPriceX96
    );
    event LiquiditySeededFromAuction(
        address indexed auction,
        uint256 meanPriceWad,
        uint256 agsAmount,
        uint256 nativeReceived,
        uint256 wethWrapped,
        uint160 sqrtPriceX96
    );
    event NativeReceived(address indexed from, uint256 amount);

    error ZeroAddress();
    error InvalidSqrtPrice();
    error InvalidTickRange();
    error PastDeadline();
    error UnauthorizedAuction();
    error AlreadySeeded();
    error InsufficientAgsBalance();

    constructor(
        address ags_,
        address weth9_,
        address positionManager_,
        uint24 poolFee_,
        address initialOwner,
        address excessTokenSink_,
        address positionRecipient_
    ) Ownable(initialOwner) {
        if (ags_ == address(0) || weth9_ == address(0) || positionManager_ == address(0)) revert ZeroAddress();
        if (initialOwner == address(0)) revert ZeroAddress();
        agsToken = IERC20(ags_);
        weth9 = IWETH9(weth9_);
        positionManager = IUniswapV3NpmLike(positionManager_);
        poolFee = poolFee_;
        excessTokenSink = excessTokenSink_ == address(0) ? initialOwner : excessTokenSink_;
        positionRecipient = positionRecipient_ == address(0) ? initialOwner : positionRecipient_;
    }

    receive() external payable {
        emit NativeReceived(msg.sender, msg.value);
    }

    function setExcessTokenSink(address sink) external onlyOwner {
        if (sink == address(0)) revert ZeroAddress();
        emit ExcessSinkUpdated(excessTokenSink, sink);
        excessTokenSink = sink;
    }

    function setPositionRecipient(address recipient) external onlyOwner {
        if (recipient == address(0)) revert ZeroAddress();
        emit PositionRecipientUpdated(positionRecipient, recipient);
        positionRecipient = recipient;
    }

    function setTrustedAuction(address auction) external onlyOwner {
        emit TrustedAuctionUpdated(trustedAuction, auction);
        trustedAuction = auction;
    }

    /// @notice Optional gate so an auction contract can push `agsAmount` in the same tx as native.
    function notifyAuctionPayout(uint256 agsAmount) external nonReentrant {
        if (trustedAuction == address(0) || msg.sender != trustedAuction) revert UnauthorizedAuction();
        if (agsAmount != 0) {
            agsToken.safeTransferFrom(msg.sender, address(this), agsAmount);
        }
    }

    /**
     * @notice Permissionless entry from the trusted auction: wrap native, initialize pool at mean price, mint full-range LP.
     * @dev The auction must transfer `agsAmount` AGS to this contract before calling (same tx). Any wS already held is paired.
     */
    function seedFromAuction(uint256 meanPriceWad, uint256 agsAmount) external payable nonReentrant {
        if (trustedAuction == address(0) || msg.sender != trustedAuction) revert UnauthorizedAuction();
        if (liquiditySeeded) revert AlreadySeeded();
        if (agsAmount == 0 || meanPriceWad == 0) revert InvalidSqrtPrice();

        uint256 agsBal = agsToken.balanceOf(address(this));
        if (agsBal < agsAmount) revert InsufficientAgsBalance();

        liquiditySeeded = true;

        uint256 nativeReceived = msg.value;
        if (nativeReceived != 0) {
            weth9.deposit{value: nativeReceived}();
        }

        address tAgs = address(agsToken);
        address tWeth = address(weth9);
        address token0 = tAgs < tWeth ? tAgs : tWeth;

        uint160 sqrtPriceX96 = UniswapV3PriceLib.sqrtPriceX96FromMeanPrice(meanPriceWad, token0, tAgs, tWeth);

        uint256 wethWrapped = weth9.balanceOf(address(this));
        (uint256 tokenId, uint256 amount0Used, uint256 amount1Used, uint128 liquidity) =
            _mintPosition(sqrtPriceX96, DEFAULT_TICK_LOWER, DEFAULT_TICK_UPPER, block.timestamp + 1 hours);

        emit LiquiditySeededFromAuction(
            msg.sender, meanPriceWad, agsAmount, nativeReceived, wethWrapped, sqrtPriceX96
        );
        emit InitialLiquidityMinted(tokenId, liquidity, amount0Used, amount1Used, sqrtPriceX96);

        _rescueDustToSink();
    }

    /**
     * @notice Manual override: wrap native, ensure pool exists + initialized, then mint one NPM position.
     */
    function mintInitialLiquidity(
        uint160 sqrtPriceX96,
        int24 tickLower,
        int24 tickUpper,
        uint256 /* amount0Min */,
        uint256 /* amount1Min */,
        uint256 deadline
    ) external onlyOwner nonReentrant {
        if (deadline < block.timestamp) revert PastDeadline();
        if (sqrtPriceX96 <= UniswapV3PriceLib.MIN_SQRT_RATIO || sqrtPriceX96 >= UniswapV3PriceLib.MAX_SQRT_RATIO) {
            revert InvalidSqrtPrice();
        }
        if (tickLower >= tickUpper) revert InvalidTickRange();

        uint256 nativeBal = address(this).balance;
        if (nativeBal != 0) {
            weth9.deposit{value: nativeBal}();
        }

        (uint256 tokenId, uint256 amount0Used, uint256 amount1Used, uint128 liquidity) =
            _mintPosition(sqrtPriceX96, tickLower, tickUpper, deadline);

        emit InitialLiquidityMinted(tokenId, liquidity, amount0Used, amount1Used, sqrtPriceX96);
    }

    function _mintPosition(
        uint160 sqrtPriceX96,
        int24 tickLower,
        int24 tickUpper,
        uint256 deadline
    ) private returns (uint256 tokenId, uint256 amount0Used, uint256 amount1Used, uint128 liquidity) {
        address tAgs = address(agsToken);
        address tWeth = address(weth9);
        address token0 = tAgs < tWeth ? tAgs : tWeth;
        address token1 = tAgs < tWeth ? tWeth : tAgs;

        positionManager.createAndInitializePoolIfNecessary{value: 0}(token0, token1, poolFee, sqrtPriceX96);

        uint256 agsBal = agsToken.balanceOf(address(this));
        uint256 wethBal = weth9.balanceOf(address(this));

        uint256 amount0Desired = token0 == tAgs ? agsBal : wethBal;
        uint256 amount1Desired = token0 == tAgs ? wethBal : agsBal;

        IERC20(token0).forceApprove(address(positionManager), amount0Desired);
        IERC20(token1).forceApprove(address(positionManager), amount1Desired);

        IUniswapV3NpmLike.MintParams memory params = IUniswapV3NpmLike.MintParams({
            token0: token0,
            token1: token1,
            fee: poolFee,
            tickLower: tickLower,
            tickUpper: tickUpper,
            amount0Desired: amount0Desired,
            amount1Desired: amount1Desired,
            amount0Min: 0,
            amount1Min: 0,
            recipient: positionRecipient,
            deadline: deadline
        });

        (tokenId, liquidity, amount0Used, amount1Used) = positionManager.mint(params);

        IERC20(token0).forceApprove(address(positionManager), 0);
        IERC20(token1).forceApprove(address(positionManager), 0);
    }

    /**
     * @notice Computes `(agsToPair, nativeToPair)` from balances using `meanPriceWad` (quote native **wei** per 1e18 AGS wei).
     */
    function previewProportionalPairing(uint256 meanPriceWad, uint256 maxAgsToUse, uint256 nativeAvailable)
        external
        view
        returns (uint256 agsToPair, uint256 nativeToPair)
    {
        uint256 agsBal = agsToken.balanceOf(address(this));
        if (agsBal > maxAgsToUse) {
            agsBal = maxAgsToUse;
        }
        if (meanPriceWad == 0 || agsBal == 0) {
            return (0, 0);
        }
        uint256 idealNative = Math.mulDiv(agsBal, meanPriceWad, 1e18);
        if (nativeAvailable >= idealNative) {
            return (agsBal, idealNative);
        }
        nativeToPair = nativeAvailable;
        agsToPair = Math.mulDiv(nativeToPair, 1e18, meanPriceWad);
        if (agsToPair > agsBal) {
            agsToPair = agsBal;
        }
    }

    function sweepToken(address token, address to, uint256 amount) external onlyOwner nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        IERC20(token).safeTransfer(to, amount);
    }

    function unwrapAndSweepNative(address payable to, uint256 wethAmount) external onlyOwner nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        weth9.withdraw(wethAmount);
        to.sendValue(wethAmount);
    }

    function rescueDustToSink() external onlyOwner nonReentrant {
        _rescueDustToSink();
    }

    function _rescueDustToSink() private {
        uint256 ags = agsToken.balanceOf(address(this));
        if (ags != 0) {
            agsToken.safeTransfer(excessTokenSink, ags);
        }
        uint256 wad = weth9.balanceOf(address(this));
        if (wad != 0) {
            IERC20(address(weth9)).safeTransfer(excessTokenSink, wad);
        }
    }
}

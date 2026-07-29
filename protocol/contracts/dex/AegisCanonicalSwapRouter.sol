// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {ISwapRouter02} from "../interfaces/ISwapRouter02.sol";
import {IAutomatedLiquidityDeployer} from "../tokendistribution/interfaces/IAutomatedLiquidityDeployer.sol";
import {IPublicLiquidityPoolMinimal} from "./interfaces/IPublicLiquidityPoolMinimal.sol";
import {IUniswapV3Factory} from "./interfaces/IUniswapV3Factory.sol";
import {IUniswapV3Pool} from "./interfaces/IUniswapV3Pool.sol";

/**
 * @title AegisCanonicalSwapRouter
 * @notice Single swap policy for AGS: one canonical AGS/wS venue (Uniswap v3 after TGE seed) plus
 *         isolated ERC20 quote pools (USDC, USDT, WETH). Prevents competing S/AGS prices from
 *         bootstrap `PublicLiquidityPool` instances once v3 is seeded.
 * @dev ERC20 quotes (USDC, …) stay on internal pools; Odos may aggregate in the frontend for those legs.
 *      Native S and wS always route through Uniswap v3 when `liquidityDeployer.liquiditySeeded()`.
 */
contract AegisCanonicalSwapRouter is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 private constant BPS = 10_000;
    uint256 private constant Q192 = 1 << 192;

    /// @dev Route discriminator returned by `quote` / `swapExactInput`.
    uint8 public constant ROUTE_UNISWAP_V3 = 1;
    uint8 public constant ROUTE_PUBLIC_POOL = 2;

    IERC20 public immutable agsToken;
    IERC20 public immutable weth9;
    ISwapRouter02 public immutable uniSwapRouter;
    IUniswapV3Factory public immutable uniV3Factory;
    IAutomatedLiquidityDeployer public immutable liquidityDeployer;
    uint24 public immutable uniPoolFee;

    /// @notice Fallback native-S bootstrap pool — ignored for routing once v3 is seeded.
    address public nativeQuotePool;
    /// @notice ERC20 quote token (USDC, USDT, WETH, …) → `PublicLiquidityPool`. Never wS when v3 is live.
    mapping(address quoteToken => address pool) public erc20QuotePools;

    event NativeQuotePoolSet(address indexed pool);
    event Erc20QuotePoolSet(address indexed quoteToken, address indexed pool);
    event CanonicalSwap(
        uint8 indexed route,
        bool agsToQuote,
        address indexed quoteToken,
        bool quoteIsNative,
        uint256 amountIn,
        uint256 amountOut,
        address indexed recipient
    );

    error ZeroAddress();
    error PoolAgsMismatch();
    error NativePoolNotAllowed();
    error WsPoolNotAllowed();
    error QuotePoolMissing();
    error Slippage();
    error WrongNativeValue();
    error V3NotSeeded();
    error V3PoolMissing();

    constructor(
        address agsToken_,
        address weth9_,
        address uniSwapRouter_,
        address uniV3Factory_,
        address liquidityDeployer_,
        uint24 uniPoolFee_,
        address initialOwner
    ) Ownable(initialOwner) {
        if (
            agsToken_ == address(0) || weth9_ == address(0) || uniSwapRouter_ == address(0)
                || uniV3Factory_ == address(0) || liquidityDeployer_ == address(0) || initialOwner == address(0)
        ) {
            revert ZeroAddress();
        }
        agsToken = IERC20(agsToken_);
        weth9 = IERC20(weth9_);
        uniSwapRouter = ISwapRouter02(uniSwapRouter_);
        uniV3Factory = IUniswapV3Factory(uniV3Factory_);
        liquidityDeployer = IAutomatedLiquidityDeployer(liquidityDeployer_);
        uniPoolFee = uniPoolFee_;
    }

    function v3Seeded() public view returns (bool) {
        return liquidityDeployer.liquiditySeeded();
    }

    function v3Pool() public view returns (address pool) {
        return uniV3Factory.getPool(address(agsToken), address(weth9), uniPoolFee);
    }

    /// @notice True when swaps for this quote should use Uniswap v3 (canonical AGS/wS).
    function usesCanonicalV3(address quoteToken, bool quoteIsNative) public view returns (bool) {
        if (!v3Seeded()) return false;
        if (quoteIsNative) return true;
        return quoteToken == address(weth9);
    }

    function setNativeQuotePool(address pool) external onlyOwner {
        if (pool != address(0)) {
            _validateNativePool(pool);
        }
        nativeQuotePool = pool;
        emit NativeQuotePoolSet(pool);
    }

    function setErc20QuotePool(address pool) external onlyOwner {
        if (pool == address(0)) revert ZeroAddress();
        IPublicLiquidityPoolMinimal p = IPublicLiquidityPoolMinimal(pool);
        if (p.agsToken() != address(agsToken)) revert PoolAgsMismatch();
        if (p.quoteIsNative()) revert NativePoolNotAllowed();
        address qt = p.quoteToken();
        if (qt == address(weth9)) revert WsPoolNotAllowed();
        erc20QuotePools[qt] = pool;
        emit Erc20QuotePoolSet(qt, pool);
    }

    /**
     * @notice Mid-market AGS wei per 1e18 wei wS from Uniswap v3 `slot0` (single reference price).
     * @return agsPerWsWad Zero when v3 pool is not initialized.
     */
    function canonicalAgsPerWsWad() external view returns (uint256 agsPerWsWad) {
        address poolAddr = v3Pool();
        if (poolAddr == address(0)) return 0;
        IUniswapV3Pool pool = IUniswapV3Pool(poolAddr);
        (uint160 sqrtPriceX96,,,,,,) = pool.slot0();
        if (sqrtPriceX96 == 0) return 0;

        address t0 = pool.token0();
        address t1 = pool.token1();
        uint256 ratioX192 = uint256(sqrtPriceX96) * uint256(sqrtPriceX96);

        if (t0 == address(weth9) && t1 == address(agsToken)) {
            // price = AGS/wS
            agsPerWsWad = Math.mulDiv(ratioX192, 1e18, Q192);
        } else if (t0 == address(agsToken) && t1 == address(weth9)) {
            // price = wS/AGS → invert
            agsPerWsWad = Math.mulDiv(1e18, Q192, ratioX192);
        }
    }

    /**
     * @notice Quote output for a prospective swap. V3 quotes use spot `slot0` + fee (display / guardrail).
     */
    function quote(bool agsToQuote, address quoteToken, bool quoteIsNative, uint256 amountIn)
        external
        view
        returns (uint8 route, uint256 amountOut)
    {
        if (amountIn == 0) return (0, 0);
        if (usesCanonicalV3(quoteToken, quoteIsNative)) {
            return (ROUTE_UNISWAP_V3, _quoteV3Spot(agsToQuote, amountIn));
        }
        address pool = _resolvePublicPool(quoteToken, quoteIsNative);
        if (pool == address(0)) revert QuotePoolMissing();
        return (ROUTE_PUBLIC_POOL, IPublicLiquidityPoolMinimal(pool).quoteSwap(agsToQuote, amountIn));
    }

    function swapExactInput(
        bool agsToQuote,
        address quoteToken,
        bool quoteIsNative,
        uint256 amountIn,
        uint256 minOut,
        address recipient
    ) external payable nonReentrant returns (uint8 route, uint256 amountOut) {
        if (recipient == address(0)) revert ZeroAddress();
        if (amountIn == 0) revert Slippage();

        if (usesCanonicalV3(quoteToken, quoteIsNative)) {
            amountOut = _swapV3(agsToQuote, amountIn, minOut, recipient, quoteIsNative);
            route = ROUTE_UNISWAP_V3;
        } else {
            amountOut = _swapPublicPool(agsToQuote, quoteToken, quoteIsNative, amountIn, minOut, recipient);
            route = ROUTE_PUBLIC_POOL;
        }

        if (amountOut < minOut) revert Slippage();
        emit CanonicalSwap(route, agsToQuote, quoteToken, quoteIsNative, amountIn, amountOut, recipient);
    }

    function _resolvePublicPool(address quoteToken, bool quoteIsNative) internal view returns (address pool) {
        if (quoteIsNative) return nativeQuotePool;
        return erc20QuotePools[quoteToken];
    }

    function _validateNativePool(address pool) internal view {
        IPublicLiquidityPoolMinimal p = IPublicLiquidityPoolMinimal(pool);
        if (p.agsToken() != address(agsToken)) revert PoolAgsMismatch();
        if (!p.quoteIsNative()) revert NativePoolNotAllowed();
    }

    function _quoteV3Spot(bool agsToQuote, uint256 amountIn) internal view returns (uint256 amountOut) {
        address poolAddr = v3Pool();
        if (poolAddr == address(0)) revert V3PoolMissing();
        IUniswapV3Pool pool = IUniswapV3Pool(poolAddr);
        (uint160 sqrtPriceX96,,,,,,) = pool.slot0();
        if (sqrtPriceX96 == 0) revert V3PoolMissing();

        uint256 inAfterFee = Math.mulDiv(amountIn, BPS - 30, BPS);
        address t0 = pool.token0();
        uint256 ratioX192 = uint256(sqrtPriceX96) * uint256(sqrtPriceX96);

        if (agsToQuote) {
            bool agsIs0 = t0 == address(agsToken);
            amountOut = agsIs0
                ? Math.mulDiv(inAfterFee, ratioX192, Q192)
                : Math.mulDiv(inAfterFee, Q192, ratioX192);
        } else {
            bool wsIs0 = t0 == address(weth9);
            amountOut = wsIs0
                ? Math.mulDiv(inAfterFee, ratioX192, Q192)
                : Math.mulDiv(inAfterFee, Q192, ratioX192);
        }
    }

    function _swapV3(bool agsToQuote, uint256 amountIn, uint256 minOut, address recipient, bool quoteIsNative)
        internal
        returns (uint256 amountOut)
    {
        if (!v3Seeded()) revert V3NotSeeded();

        if (agsToQuote) {
            IERC20(address(agsToken)).safeTransferFrom(msg.sender, address(this), amountIn);
            IERC20(address(agsToken)).forceApprove(address(uniSwapRouter), amountIn);
            amountOut = uniSwapRouter.exactInputSingle(
                ISwapRouter02.ExactInputSingleParams({
                    tokenIn: address(agsToken),
                    tokenOut: address(weth9),
                    fee: uniPoolFee,
                    recipient: recipient,
                    amountIn: amountIn,
                    amountOutMinimum: minOut,
                    sqrtPriceLimitX96: 0
                })
            );
            IERC20(address(agsToken)).forceApprove(address(uniSwapRouter), 0);
            return amountOut;
        }

        if (quoteIsNative) {
            if (msg.value != amountIn) revert WrongNativeValue();
        } else {
            IERC20(address(weth9)).safeTransferFrom(msg.sender, address(this), amountIn);
            IERC20(address(weth9)).forceApprove(address(uniSwapRouter), amountIn);
        }

        amountOut = uniSwapRouter.exactInputSingle{value: quoteIsNative ? amountIn : 0}(
            ISwapRouter02.ExactInputSingleParams({
                tokenIn: address(weth9),
                tokenOut: address(agsToken),
                fee: uniPoolFee,
                recipient: recipient,
                amountIn: amountIn,
                amountOutMinimum: minOut,
                sqrtPriceLimitX96: 0
            })
        );

        if (!quoteIsNative) {
            IERC20(address(weth9)).forceApprove(address(uniSwapRouter), 0);
        }
    }

    function _swapPublicPool(
        bool agsToQuote,
        address quoteToken,
        bool quoteIsNative,
        uint256 amountIn,
        uint256 minOut,
        address recipient
    ) internal returns (uint256 amountOut) {
        address pool = _resolvePublicPool(quoteToken, quoteIsNative);
        if (pool == address(0)) revert QuotePoolMissing();

        if (agsToQuote) {
            IERC20(address(agsToken)).safeTransferFrom(msg.sender, address(this), amountIn);
            IERC20(address(agsToken)).forceApprove(pool, amountIn);
            amountOut = IPublicLiquidityPoolMinimal(pool).swapExactInput(true, amountIn, minOut, recipient);
            IERC20(address(agsToken)).forceApprove(pool, 0);
            return amountOut;
        }

        if (quoteIsNative) {
            if (msg.value != amountIn) revert WrongNativeValue();
            return IPublicLiquidityPoolMinimal(pool).swapExactInput{value: amountIn}(
                false, amountIn, minOut, recipient
            );
        }

        IERC20(quoteToken).safeTransferFrom(msg.sender, address(this), amountIn);
        IERC20(quoteToken).forceApprove(pool, amountIn);
        amountOut = IPublicLiquidityPoolMinimal(pool).swapExactInput(false, amountIn, minOut, recipient);
        IERC20(quoteToken).forceApprove(pool, 0);
    }

    receive() external payable {}
}

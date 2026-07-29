// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EnumerableSet} from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {IPublicLiquidityPoolMinimal} from "./interfaces/IPublicLiquidityPoolMinimal.sol";

/**
 * @title AegisPublicPoolRouter
 * @notice Governance-owned allowlist of `PublicLiquidityPool` instances sharing one (AGS, quote) pair shape.
 * @dev M2: `bestQuote` compares `quoteSwap` outputs across allowlisted pools. `swapExactInputOnBest` pulls input
 *      from `msg.sender`, approves the winning pool, and forwards the swap. All settlement remains on the pool
 *      contracts (explorer-visible).
 */
contract AegisPublicPoolRouter is Ownable, ReentrancyGuard {
    using EnumerableSet for EnumerableSet.AddressSet;
    using SafeERC20 for IERC20;

    EnumerableSet.AddressSet private _pools;

    address public agsToken;
    address public quoteToken;
    bool public quoteIsNative;
    bool public pairPinned;

    event PoolAdded(address indexed pool);
    event PoolRemoved(address indexed pool);
    event RoutedSwap(address indexed pool, bool indexed agsToQuote, uint256 amountIn, uint256 amountOut, address recipient);

    error ZeroAddress();
    error PairMismatch();
    error NoPools();
    error NoLiquidity();
    error Slippage();
    error WrongNativeValue();
    error PoolAlreadyAdded();
    error PoolNotInSet();

    constructor(address initialOwner) Ownable(initialOwner) {}

    /// @notice Allowlist a pool; first pool pins (agsToken, quoteToken, quoteIsNative) for all subsequent pools.
    function addPool(address pool) external onlyOwner {
        if (pool == address(0)) revert ZeroAddress();
        IPublicLiquidityPoolMinimal p = IPublicLiquidityPoolMinimal(pool);
        address ags = p.agsToken();
        address qt = p.quoteToken();
        bool qn = p.quoteIsNative();
        if (!pairPinned) {
            agsToken = ags;
            quoteToken = qt;
            quoteIsNative = qn;
            pairPinned = true;
        } else {
            if (ags != agsToken || qt != quoteToken || qn != quoteIsNative) revert PairMismatch();
        }
        if (!_pools.add(pool)) revert PoolAlreadyAdded();
        emit PoolAdded(pool);
    }

    function removePool(address pool) external onlyOwner {
        if (!_pools.remove(pool)) revert PoolNotInSet();
        emit PoolRemoved(pool);
    }

    function poolCount() external view returns (uint256) {
        return _pools.length();
    }

    function poolAt(uint256 index) external view returns (address) {
        return _pools.at(index);
    }

    function isPoolAllowed(address pool) external view returns (bool) {
        return _pools.contains(pool);
    }

    /// @notice View-only best output among allowlisted pools (reverts if none deliver liquidity).
    function bestQuote(bool agsToQuote, uint256 amountIn) external view returns (address bestPool, uint256 bestOut) {
        (bestPool, bestOut) = _bestQuote(agsToQuote, amountIn);
    }

    function _bestQuote(bool agsToQuote, uint256 amountIn) internal view returns (address bestPool, uint256 bestOut) {
        uint256 n = _pools.length();
        if (n == 0) revert NoPools();
        bestOut = 0;
        bestPool = address(0);
        for (uint256 i = 0; i < n; i++) {
            address poolAddr = _pools.at(i);
            try IPublicLiquidityPoolMinimal(poolAddr).quoteSwap(agsToQuote, amountIn) returns (uint256 out) {
                if (out > bestOut) {
                    bestOut = out;
                    bestPool = poolAddr;
                }
            } catch {
                // ignore pools that revert on quote (empty / misconfigured)
            }
        }
        if (bestPool == address(0)) revert NoLiquidity();
    }

    /**
     * @notice Execute `swapExactInput` on the allowlisted pool with the best quote for this size and direction.
     * @param recipient Pool sends output assets to this address (typically `msg.sender`).
     */
    function swapExactInputOnBest(bool agsToQuote, uint256 amountIn, uint256 minOut, address recipient)
        external
        payable
        nonReentrant
        returns (address bestPool, uint256 amountOut)
    {
        (bestPool, amountOut) = _bestQuote(agsToQuote, amountIn);
        if (amountOut < minOut) revert Slippage();

        if (agsToQuote) {
            IERC20(agsToken).safeTransferFrom(msg.sender, address(this), amountIn);
            IERC20(agsToken).safeIncreaseAllowance(bestPool, amountIn);
            amountOut = IPublicLiquidityPoolMinimal(bestPool).swapExactInput(true, amountIn, minOut, recipient);
            // Pool may consume the full allowance; reset rather than strict decrease-by-amountIn.
            IERC20(agsToken).forceApprove(bestPool, 0);
        } else if (quoteIsNative) {
            if (msg.value != amountIn) revert WrongNativeValue();
            amountOut = IPublicLiquidityPoolMinimal(bestPool).swapExactInput{value: amountIn}(
                false, amountIn, minOut, recipient
            );
        } else {
            IERC20(quoteToken).safeTransferFrom(msg.sender, address(this), amountIn);
            IERC20(quoteToken).safeIncreaseAllowance(bestPool, amountIn);
            amountOut = IPublicLiquidityPoolMinimal(bestPool).swapExactInput(false, amountIn, minOut, recipient);
            IERC20(quoteToken).forceApprove(bestPool, 0);
        }

        emit RoutedSwap(bestPool, agsToQuote, amountIn, amountOut, recipient);
    }

    receive() external payable {}
}

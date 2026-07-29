// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {IPublicLiquidityPoolMinimal} from "../dex/interfaces/IPublicLiquidityPoolMinimal.sol";

/// @dev Test double for `AegisPublicPoolRouter` — constant-product style quotes and swaps.
contract MockPublicLiquidityPool is IPublicLiquidityPoolMinimal {
    using SafeERC20 for IERC20;

    address private immutable _ags;
    address private immutable _quote;
    bool private immutable _native;

    uint256 public reserveAGS;
    uint256 public reserveQuote;
    bool public failQuote;

    constructor(address ags_, address quote_, bool native_, uint256 rAgs, uint256 rQuote) {
        _ags = ags_;
        _quote = quote_;
        _native = native_;
        reserveAGS = rAgs;
        reserveQuote = rQuote;
    }

    function agsToken() external view override returns (address) {
        return _ags;
    }

    function quoteToken() external view override returns (address) {
        return _quote;
    }

    function quoteIsNative() external view override returns (bool) {
        return _native;
    }

    function setFailQuote(bool v) external {
        failQuote = v;
    }

    function quoteSwap(bool agsToQuote, uint256 amountIn) external view override returns (uint256 amountOut) {
        if (failQuote) revert("quote fail");
        return _quoteOut(agsToQuote, amountIn);
    }

    function _quoteOut(bool agsToQuote, uint256 amountIn) internal view returns (uint256) {
        if (amountIn == 0) return 0;
        if (agsToQuote) {
            if (reserveAGS + amountIn == 0) return 0;
            return (reserveQuote * amountIn) / (reserveAGS + amountIn);
        }
        if (reserveQuote + amountIn == 0) return 0;
        return (reserveAGS * amountIn) / (reserveQuote + amountIn);
    }

    function swapExactInput(bool agsToQuote, uint256 amountIn, uint256 minOut, address recipient)
        external
        payable
        override
        returns (uint256 amountOut)
    {
        amountOut = _quoteOut(agsToQuote, amountIn);
        if (amountOut < minOut) revert("slippage");

        if (agsToQuote) {
            IERC20(_ags).safeTransferFrom(msg.sender, address(this), amountIn);
            unchecked {
                reserveAGS += amountIn;
                reserveQuote -= amountOut;
            }
            if (_native) {
                (bool ok,) = recipient.call{value: amountOut}("");
                if (!ok) revert("native out");
            } else {
                IERC20(_quote).safeTransfer(recipient, amountOut);
            }
            return amountOut;
        }
        if (_native) {
            if (msg.value != amountIn) revert("native in");
        } else {
            IERC20(_quote).safeTransferFrom(msg.sender, address(this), amountIn);
        }
        unchecked {
            reserveQuote += amountIn;
            reserveAGS -= amountOut;
        }
        IERC20(_ags).safeTransfer(recipient, amountOut);
        return amountOut;
    }

    receive() external payable {}
}

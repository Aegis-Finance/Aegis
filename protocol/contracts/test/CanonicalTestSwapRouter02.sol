// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ISwapRouter02} from "../interfaces/ISwapRouter02.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @dev Test-only stub for `AegisCanonicalSwapRouter` v3 leg.
contract CanonicalTestSwapRouter02 is ISwapRouter02 {
    using SafeERC20 for IERC20;

    uint256 public amountOut;
    uint256 public lastAmountIn;

    function setAmountOut(uint256 out) external {
        amountOut = out;
    }

    function exactInputSingle(ExactInputSingleParams calldata params)
        external
        payable
        returns (uint256)
    {
        lastAmountIn = params.amountIn;
        if (msg.value == 0) {
            IERC20(params.tokenIn).safeTransferFrom(msg.sender, address(this), params.amountIn);
        }
        IERC20(params.tokenOut).safeTransfer(params.recipient, amountOut);
        return amountOut;
    }
}

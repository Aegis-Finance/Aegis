// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract TransferTester {
    function execute(address token, address to, uint256 amount) external returns (bool) {
        return IERC20(token).transfer(to, amount);
    }
}


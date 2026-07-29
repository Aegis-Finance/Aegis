// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {MintableTestToken} from "./MintableTestToken.sol";

/// @notice Test double used by Hardhat specs (`contracts/test/MockERC20.sol:MockERC20`).
/// @dev Same behavior as {MintableTestToken}; kept as a stable factory name for JS tests.
contract MockERC20 is MintableTestToken {
    constructor(string memory name_, string memory symbol_) MintableTestToken(name_, symbol_) {}
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

interface IBondingCurve {
    function purchaseTokens(uint256 minTokensOut) external payable;
    function sellTokens(uint256 tokenAmount, uint256 minEthOut) external;
}

interface IERC20Min {
    function balanceOf(address account) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
}

/**
 * @notice Test double-spend / reentrancy helper for `AutomatedBondingCurve` integration tests.
 */
contract MaliciousReentrancy {
    IBondingCurve public immutable curve;
    IERC20Min public immutable token;
    bool public attacking;
    uint256 public callCount;

    constructor(address curve_, address token_) {
        curve = IBondingCurve(curve_);
        token = IERC20Min(token_);
    }

    function startAttack() external payable {
        curve.purchaseTokens{value: msg.value}(0);
    }

    function sellAndTriggerReentrancy() external {
        uint256 bal = token.balanceOf(address(this));
        require(bal > 0, "No tokens to sell");
        require(token.approve(address(curve), bal), "approve failed");
        curve.sellTokens(bal, 0);
    }

    /// @dev Bonding curve pulls tokens before sending ETH; on receive, AGS balance is already 0.
    ///      Reenter via `purchaseTokens` (also `nonReentrant`) to trigger `ReentrancyGuardReentrantCall`.
    receive() external payable {
        unchecked {
            ++callCount;
        }
        attacking = true;
        if (msg.value > 0) {
            curve.purchaseTokens{value: msg.value}(0);
        }
    }
}

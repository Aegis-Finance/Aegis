// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "../feem/FeeMRegistrationMixin.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title FeeMRegistrationHarness
 * @notice Deterministic harness used for formal verification of FeeMRegistrationMixin. It forces the
 *         registry call to succeed while still exercising the mixin logic (including reentrancy
 *         guards and state transitions) so that CVL rules can reason about monotonicity without
 *         depending on the live Sonic registry contract or external mocking.
 */
contract FeeMRegistrationHarness is FeeMRegistrationMixin, Ownable {
    constructor() Ownable(msg.sender) {}
    function _feeMRegistryAddress() internal view override returns (address) {
        return address(this);
    }

    function _callFeeMRegistry(bytes memory) internal pure override returns (bool, bytes memory) {
        return (true, "");
    }

    /**
     * @notice Withdraw any ether that may have been sent to this contract
     * @dev Prevents ether locking as detected by Slither
     */
    function withdraw(address payable recipient, uint256 amount) external onlyOwner {
        require(recipient != address(0), "recipient=0");
        require(amount <= address(this).balance, "insufficient");
        (bool ok, ) = recipient.call{value: amount}("");
        require(ok, "native send failed");
    }
}


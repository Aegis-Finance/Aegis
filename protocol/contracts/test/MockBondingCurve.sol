// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

contract MockBondingCurve {
    bool public active = true;

    function setActive(bool _active) external {
        active = _active;
    }

    function isActive() external view returns (bool) {
        return active;
    }
}



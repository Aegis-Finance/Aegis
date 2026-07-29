// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "../governance/EnumerableTimelockController.sol";

contract TestTimelockController is EnumerableTimelockController {
    constructor(
        uint256 minDelay,
        address[] memory proposers,
        address[] memory executors,
        address admin
    ) EnumerableTimelockController(minDelay, proposers, executors, admin) {}
}


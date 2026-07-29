// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";

/**
 * @title AegisTimelockController
 * @notice Named OpenZeppelin Timelock deployment for Aegis. Governance (`PrivateGovernance`) should hold
 *         `PROPOSER_ROLE` / `CANCELLER_ROLE`; `EXECUTOR_ROLE` is commonly granted to `address(0)` so any
 *         address may execute after `minDelay` (see OpenZeppelin TimelockController documentation).
 * @dev Optional `admin` receives `DEFAULT_ADMIN_ROLE` to finish role setup, then should call
 *      `renounceRole(DEFAULT_ADMIN_ROLE, admin)` so only the timelock contract administers roles.
 */
contract AegisTimelockController is TimelockController {
    constructor(
        uint256 minDelay,
        address[] memory proposers,
        address[] memory executors,
        address admin
    ) TimelockController(minDelay, proposers, executors, admin) {}
}

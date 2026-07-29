// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {GovernanceAccessLib} from "../libraries/GovernanceAccessLib.sol";

/**
 * @title MessagingAdapterAllowlist
 * @notice Governance-gated **allowlist** for **future** omnichain / messaging adapter contracts (e.g. LZ-style
 *         endpoints). This module does **not** route messages itself; consumers (bridges, routers, UI policy)
 *         consult `isAllowed(adapter)` before treating an address as trusted infrastructure.
 * @dev Auth model matches `LiquidityMiningGauge`: `onlyOwner` wires `governanceContract`; thereafter
 *      `onlyGovernance` may set timelock + toggle allowlist entries.
 */
contract MessagingAdapterAllowlist is Ownable {
    address public governanceContract;
    address public timelockController;

    mapping(address => bool) private _allowed;

    event GovernanceUpdated(address indexed previousGovernance, address indexed newGovernance);
    event TimelockControllerUpdated(address indexed previousTimelock, address indexed newTimelock);
    event MessagingAdapterSet(address indexed adapter, bool allowed);

    error ZeroAddress();
    error UnauthorizedAccess();

    modifier onlyGovernance() {
        if (!GovernanceAccessLib.isGovernanceTimelockOrCore(governanceContract, timelockController, msg.sender)) {
            revert UnauthorizedAccess();
        }
        _;
    }

    constructor(address initialOwner) Ownable(initialOwner) {}

    function setGovernance(address g) external onlyOwner {
        if (g == address(0)) revert ZeroAddress();
        emit GovernanceUpdated(governanceContract, g);
        governanceContract = g;
    }

    function setTimelockController(address t) external onlyGovernance {
        emit TimelockControllerUpdated(timelockController, t);
        timelockController = t;
    }

    /// @notice Add or remove a messaging adapter contract address from the trusted set.
    function setMessagingAdapterAllowed(address adapter, bool allowed) external onlyGovernance {
        if (adapter == address(0)) revert ZeroAddress();
        _allowed[adapter] = allowed;
        emit MessagingAdapterSet(adapter, allowed);
    }

    function isMessagingAdapterAllowed(address adapter) external view returns (bool) {
        return _allowed[adapter];
    }
}

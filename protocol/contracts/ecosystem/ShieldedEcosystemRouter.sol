// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ICommonErrors} from "../interfaces/ICommonErrors.sol";
import {GovernanceAccessLib} from "../libraries/GovernanceAccessLib.sol";

/**
 * @title ShieldedEcosystemRouter
 * @notice DAO-governed registry of authorized shielded module addresses for unified privacy layer routing.
 */
contract ShieldedEcosystemRouter is ICommonErrors {
    mapping(bytes32 => address) public modules;

    address public governanceContract;
    address public timelockController;
    address public owner;

    event ModuleRegistered(bytes32 indexed moduleId, address indexed moduleAddress);
    event ModuleRemoved(bytes32 indexed moduleId);
    event GovernanceUpdated(address indexed previous, address indexed next);
    event TimelockControllerUpdated(address indexed previous, address indexed next);

    modifier onlyGovernance() {
        if (!GovernanceAccessLib.isGovernanceTimelockOrCore(governanceContract, timelockController, msg.sender)) {
            revert UnauthorizedAccess();
        }
        _;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert UnauthorizedAccess();
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    function setGovernance(address g) external onlyOwner {
        if (g == address(0)) revert ZeroAddress();
        emit GovernanceUpdated(governanceContract, g);
        governanceContract = g;
    }

    function setTimelockController(address t) external onlyOwner {
        emit TimelockControllerUpdated(timelockController, t);
        timelockController = t;
    }

    function registerModule(bytes32 moduleId, address moduleAddress) external onlyGovernance {
        if (moduleAddress == address(0)) revert ZeroAddress();
        modules[moduleId] = moduleAddress;
        emit ModuleRegistered(moduleId, moduleAddress);
    }

    function removeModule(bytes32 moduleId) external onlyGovernance {
        delete modules[moduleId];
        emit ModuleRemoved(moduleId);
    }
}

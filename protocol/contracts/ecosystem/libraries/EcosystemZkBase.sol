// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {PrivateTokenContract} from "../../PrivateTokenContract.sol";
import {VerifierFactory} from "../../VerifierFactory.sol";
import {GovernanceAccessLib} from "../../libraries/GovernanceAccessLib.sol";
import {ICommonErrors} from "../../interfaces/ICommonErrors.sol";

/**
 * @title EcosystemZkBase
 * @notice Shared wiring for shielded ecosystem modules: AGS token, verifier factory, governance gate.
 */
abstract contract EcosystemZkBase is Ownable, ReentrancyGuard, Pausable, ICommonErrors {
    PrivateTokenContract public immutable TOKEN;
    VerifierFactory public immutable VERIFIER_FACTORY;

    address public governanceContract;
    address public timelockController;

    event GovernanceUpdated(address indexed previous, address indexed next);
    event TimelockControllerUpdated(address indexed previous, address indexed next);

    modifier onlyGovernance() {
        if (!GovernanceAccessLib.isGovernanceTimelockOrCore(governanceContract, timelockController, msg.sender)) {
            revert UnauthorizedAccess();
        }
        _;
    }

    constructor(address token_, address verifierFactory_) Ownable(msg.sender) {
        if (token_ == address(0) || verifierFactory_ == address(0)) revert ZeroAddress();
        TOKEN = PrivateTokenContract(token_);
        VERIFIER_FACTORY = VerifierFactory(verifierFactory_);
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

    function pauseModule() external onlyGovernance {
        _pause();
    }

    function unpauseModule() external onlyGovernance {
        _unpause();
    }

    function _requireValidProof(
        string memory circuitType,
        uint256[8] memory proof,
        uint256[] memory publicInputs
    ) internal view {
        if (!VERIFIER_FACTORY.verifyProof(circuitType, proof, publicInputs)) {
            revert ProofVerificationFailed();
        }
    }
}

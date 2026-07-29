// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IPrivacySavingsVault} from "../interfaces/IPrivacySavingsVault.sol";
import {EcosystemZkBase} from "./libraries/EcosystemZkBase.sol";

/**
 * @title ShieldedYieldVault
 * @notice Unified term lock + farming rail: savings lock via `PrivacySavingsVault`, farm stake via `farming` circuit.
 */
contract ShieldedYieldVault is EcosystemZkBase {
    string private constant FARMING_CIRCUIT = "farming";

    IPrivacySavingsVault public savingsVault;
    mapping(bytes32 => bool) public spentFarmNullifiers;

    event SavingsVaultUpdated(address indexed previous, address indexed next);
    event LockedYieldOpened(uint256 indexed depositId, bytes32 commitment);
    event FarmStakeRecorded(bytes32 indexed nullifierHash, bytes32 indexed stakeCommitment);

    error SavingsVaultNotSet();

    constructor(address token_, address verifierFactory_, address savingsVault_)
        EcosystemZkBase(token_, verifierFactory_)
    {
        if (savingsVault_ != address(0)) {
            savingsVault = IPrivacySavingsVault(savingsVault_);
        }
    }

    function setSavingsVault(address vault) external onlyGovernance {
        emit SavingsVaultUpdated(address(savingsVault), vault);
        savingsVault = IPrivacySavingsVault(vault);
    }

    function openLockedYield(bytes32 commitment, uint256 lockDuration) external whenNotPaused returns (uint256 depositId) {
        if (address(savingsVault) == address(0)) revert SavingsVaultNotSet();
        depositId = savingsVault.openSavings(commitment, lockDuration);
        emit LockedYieldOpened(depositId, commitment);
    }

    /**
     * @param publicInputs farming circuit public inputs (pool id, nullifier, commitment, amount, …)
     */
    function recordFarmStake(uint256[8] calldata proof, uint256[] calldata publicInputs) external whenNotPaused {
        if (publicInputs.length < 3) revert InvalidPublicInputs();
        bytes32 nullifier = bytes32(publicInputs[1]);
        if (spentFarmNullifiers[nullifier]) revert NullifierAlreadyUsed();
        _requireValidProof(FARMING_CIRCUIT, proof, publicInputs);
        spentFarmNullifiers[nullifier] = true;
        emit FarmStakeRecorded(nullifier, bytes32(publicInputs[2]));
    }
}

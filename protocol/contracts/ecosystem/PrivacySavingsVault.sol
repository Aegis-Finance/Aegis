// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {EcosystemZkBase} from "./libraries/EcosystemZkBase.sol";

/**
 * @title PrivacySavingsVault
 * @notice Shielded savings / term deposits: lock commitment until maturity; ZK withdraw with nullifier.
 */
contract PrivacySavingsVault is EcosystemZkBase {
    string private constant SAVINGS_CIRCUIT = "savings";

    struct Deposit {
        bytes32 commitment;
        uint256 maturity;
        bool withdrawn;
    }

    uint256 public nextDepositId;
    mapping(uint256 => Deposit) public deposits;
    mapping(bytes32 => bool) public spentNullifiers;

    event SavingsOpened(uint256 indexed depositId, bytes32 indexed commitment, uint256 maturity);
    event SavingsWithdrawn(uint256 indexed depositId, bytes32 indexed nullifierHash);

    error NotMature();
    error AlreadyWithdrawn();

    constructor(address token_, address verifierFactory_) EcosystemZkBase(token_, verifierFactory_) {}

    function openSavings(bytes32 commitment, uint256 lockDuration) external whenNotPaused returns (uint256 depositId) {
        if (commitment == bytes32(0)) revert ZeroAddress();
        if (lockDuration == 0) revert ZeroAmount();
        depositId = nextDepositId++;
        deposits[depositId] = Deposit({commitment: commitment, maturity: block.timestamp + lockDuration, withdrawn: false});
        emit SavingsOpened(depositId, commitment, deposits[depositId].maturity);
    }

    /**
     * @param publicInputs [depositId, nullifierHash, newCommitmentHash, merkleRoot]
     */
    function withdrawSavings(
        uint256[8] calldata proof,
        uint256[] calldata publicInputs
    ) external nonReentrant whenNotPaused {
        if (publicInputs.length < 4) revert InvalidPublicInputs();
        uint256 depositId = publicInputs[0];
        Deposit storage dep = deposits[depositId];
        if (dep.withdrawn) revert AlreadyWithdrawn();
        if (block.timestamp < dep.maturity) revert NotMature();
        bytes32 nullifier = bytes32(publicInputs[1]);
        if (spentNullifiers[nullifier]) revert NullifierAlreadyUsed();

        _requireValidProof(SAVINGS_CIRCUIT, proof, publicInputs);
        spentNullifiers[nullifier] = true;
        dep.withdrawn = true;
        emit SavingsWithdrawn(depositId, nullifier);
    }
}

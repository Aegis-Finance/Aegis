// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {EcosystemZkBase} from "./libraries/EcosystemZkBase.sol";

/**
 * @title PrivateStableVault
 * @notice Collateral-backed stable-value commitments: mint/burn stable notes in shielded state via ZK.
 */
contract PrivateStableVault is EcosystemZkBase {
    string private constant STABLE_CIRCUIT = "private-stable";

    uint256 public collateralRatioBps = 15_000; // 150% min
    uint256 public totalStableLiability;

    mapping(bytes32 => bool) public spentNullifiers;
    mapping(bytes32 => uint256) public collateralByCommitment;

    event StableMinted(bytes32 indexed stableCommitment, bytes32 indexed collateralCommitment, uint256 stableAmount);
    event StableBurned(bytes32 indexed nullifierHash, uint256 stableAmount);


    constructor(address token_, address verifierFactory_) EcosystemZkBase(token_, verifierFactory_) {}

    function setCollateralRatioBps(uint256 bps) external onlyGovernance {
        collateralRatioBps = bps;
    }

    /**
     * @param publicInputs [nullifierHash, stableCommitment, collateralCommitment, stableAmount, collateralAmount]
     */
    function mintStable(
        uint256[8] calldata proof,
        uint256[] calldata publicInputs
    ) external whenNotPaused {
        if (publicInputs.length < 5) revert InvalidPublicInputs();
        bytes32 nullifier = bytes32(publicInputs[0]);
        if (spentNullifiers[nullifier]) revert NullifierAlreadyUsed();
        _requireValidProof(STABLE_CIRCUIT, proof, publicInputs);
        spentNullifiers[nullifier] = true;
        uint256 stableAmount = publicInputs[3];
        totalStableLiability += stableAmount;
        collateralByCommitment[bytes32(publicInputs[2])] = publicInputs[4];
        emit StableMinted(bytes32(publicInputs[1]), bytes32(publicInputs[2]), stableAmount);
    }

    function burnStable(
        uint256[8] calldata proof,
        uint256[] calldata publicInputs
    ) external whenNotPaused {
        if (publicInputs.length < 3) revert InvalidPublicInputs();
        bytes32 nullifier = bytes32(publicInputs[0]);
        if (spentNullifiers[nullifier]) revert NullifierAlreadyUsed();
        _requireValidProof(STABLE_CIRCUIT, proof, publicInputs);
        spentNullifiers[nullifier] = true;
        uint256 stableAmount = publicInputs[2];
        if (totalStableLiability >= stableAmount) totalStableLiability -= stableAmount;
        emit StableBurned(nullifier, stableAmount);
    }
}

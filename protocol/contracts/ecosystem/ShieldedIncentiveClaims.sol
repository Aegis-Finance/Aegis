// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {EcosystemZkBase} from "./libraries/EcosystemZkBase.sol";

/**
 * @title ShieldedIncentiveClaims
 * @notice ZK claim router for `LiquidityMiningGauge` rewards and `TreasuryBondAuction` note redemptions
 *         into shielded commitments (callers route transparent legs via `getRewardTo` / `purchaseTo` first).
 */
contract ShieldedIncentiveClaims is EcosystemZkBase {
    string private constant FARMING_CIRCUIT = "farming";
    string private constant PRIVATE_BOND_CIRCUIT = "private-bond";

    address public liquidityMiningGauge;
    address public treasuryBondAuction;

    mapping(bytes32 => bool) public spentNullifiers;

    event LiquidityMiningGaugeUpdated(address indexed previous, address indexed next);
    event TreasuryBondAuctionUpdated(address indexed previous, address indexed next);
    event ShieldedGaugeClaimVerified(bytes32 indexed nullifierHash, bytes32 indexed recipientCommitment);
    event ShieldedBondRedemptionVerified(bytes32 indexed nullifierHash, uint256 indexed noteId);

    constructor(address token_, address verifierFactory_) EcosystemZkBase(token_, verifierFactory_) {}

    function setLiquidityMiningGauge(address gauge) external onlyGovernance {
        emit LiquidityMiningGaugeUpdated(liquidityMiningGauge, gauge);
        liquidityMiningGauge = gauge;
    }

    function setTreasuryBondAuction(address auction) external onlyGovernance {
        emit TreasuryBondAuctionUpdated(treasuryBondAuction, auction);
        treasuryBondAuction = auction;
    }

    /**
     * @param publicInputs [nullifierHash, recipientCommitment, rewardAmount, merkleRoot, …]
     */
    function verifyGaugeClaim(uint256[8] calldata proof, uint256[] calldata publicInputs) external whenNotPaused {
        if (liquidityMiningGauge == address(0)) revert ZeroAddress();
        if (publicInputs.length < 2) revert InvalidPublicInputs();
        bytes32 nullifier = bytes32(publicInputs[0]);
        if (spentNullifiers[nullifier]) revert NullifierAlreadyUsed();
        _requireValidProof(FARMING_CIRCUIT, proof, publicInputs);
        spentNullifiers[nullifier] = true;
        emit ShieldedGaugeClaimVerified(nullifier, bytes32(publicInputs[1]));
    }

    /**
     * @param publicInputs [nullifierHash, noteId, holderCommitment, …]
     */
    function verifyBondRedemption(uint256[8] calldata proof, uint256[] calldata publicInputs) external whenNotPaused {
        if (treasuryBondAuction == address(0)) revert ZeroAddress();
        if (publicInputs.length < 2) revert InvalidPublicInputs();
        bytes32 nullifier = bytes32(publicInputs[0]);
        if (spentNullifiers[nullifier]) revert NullifierAlreadyUsed();
        _requireValidProof(PRIVATE_BOND_CIRCUIT, proof, publicInputs);
        spentNullifiers[nullifier] = true;
        emit ShieldedBondRedemptionVerified(nullifier, publicInputs[1]);
    }
}

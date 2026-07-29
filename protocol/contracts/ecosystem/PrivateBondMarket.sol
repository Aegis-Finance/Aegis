// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {EcosystemZkBase} from "./libraries/EcosystemZkBase.sol";

/**
 * @title PrivateBondMarket
 * @notice ZK-gated bond note purchase into shielded commitments (wraps transparent `TreasuryBondAuction` economics).
 */
contract PrivateBondMarket is EcosystemZkBase {
    using SafeERC20 for IERC20;

    string private constant PRIVATE_BOND_CIRCUIT = "private-bond";

    IERC20 public immutable QUOTE_TOKEN;

    mapping(bytes32 => bool) public spentNullifiers;
    mapping(uint256 => bytes32) public noteCommitments;
    uint256 public nextNoteId;

    event PrivateBondPurchased(uint256 indexed noteId, bytes32 indexed commitment, uint256 quotePaid);
    event PrivateBondRedeemed(uint256 indexed noteId, bytes32 indexed nullifierHash);


    constructor(address token_, address verifierFactory_, address quoteToken_)
        EcosystemZkBase(token_, verifierFactory_)
    {
        if (quoteToken_ == address(0)) revert ZeroAddress();
        QUOTE_TOKEN = IERC20(quoteToken_);
    }

    /**
     * @param publicInputs [nullifierHash, commitmentHash, quoteAmount, maturity]
     */
    function purchaseBond(
        uint256 quoteAmount,
        uint256[8] calldata proof,
        uint256[] calldata publicInputs
    ) external nonReentrant whenNotPaused returns (uint256 noteId) {
        if (publicInputs.length < 4) revert InvalidPublicInputs();
        bytes32 nullifier = bytes32(publicInputs[0]);
        if (spentNullifiers[nullifier]) revert NullifierAlreadyUsed();

        _requireValidProof(PRIVATE_BOND_CIRCUIT, proof, publicInputs);
        spentNullifiers[nullifier] = true;
        QUOTE_TOKEN.safeTransferFrom(msg.sender, address(this), quoteAmount);

        noteId = nextNoteId++;
        noteCommitments[noteId] = bytes32(publicInputs[1]);
        emit PrivateBondPurchased(noteId, bytes32(publicInputs[1]), quoteAmount);
    }

    function redeemBond(
        uint256 noteId,
        uint256[8] calldata proof,
        uint256[] calldata publicInputs
    ) external nonReentrant whenNotPaused {
        if (publicInputs.length < 2) revert InvalidPublicInputs();
        bytes32 nullifier = bytes32(publicInputs[0]);
        if (spentNullifiers[nullifier]) revert NullifierAlreadyUsed();
        _requireValidProof(PRIVATE_BOND_CIRCUIT, proof, publicInputs);
        spentNullifiers[nullifier] = true;
        emit PrivateBondRedeemed(noteId, nullifier);
    }
}

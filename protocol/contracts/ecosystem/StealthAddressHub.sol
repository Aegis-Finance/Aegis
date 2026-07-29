// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {EcosystemZkBase} from "./libraries/EcosystemZkBase.sol";

/**
 * @title StealthAddressHub
 * @notice Stealth receive rail: payers use opaque `paymentTag` per payment; recipients claim into
 *         shielded commitments via ZK without reusing a public wallet address graph.
 */
contract StealthAddressHub is EcosystemZkBase {
    string private constant STEALTH_CIRCUIT = "stealth-address";

    struct StealthMeta {
        bytes32 spendingKeyHash;
        uint256 registeredAt;
        bool active;
    }

    mapping(bytes32 => StealthMeta) public stealthMetas;
    mapping(bytes32 => bool) public spentPaymentTags;

    event StealthMetaRegistered(bytes32 indexed viewTag, bytes32 spendingKeyHash, address indexed registrar);
    event StealthPaymentClaimed(bytes32 indexed paymentTag, bytes32 indexed commitment);

    error MetaAlreadyRegistered();
    error MetaNotActive();
    error PaymentTagSpent();

    constructor(address token_, address verifierFactory_) EcosystemZkBase(token_, verifierFactory_) {}

    function registerStealthMeta(bytes32 viewTag, bytes32 spendingKeyHash) external whenNotPaused {
        if (viewTag == bytes32(0) || spendingKeyHash == bytes32(0)) revert ZeroAddress();
        if (stealthMetas[viewTag].registeredAt != 0) revert MetaAlreadyRegistered();
        stealthMetas[viewTag] = StealthMeta({
            spendingKeyHash: spendingKeyHash,
            registeredAt: block.timestamp,
            active: true
        });
        emit StealthMetaRegistered(viewTag, spendingKeyHash, msg.sender);
    }

    function deactivateStealthMeta(bytes32 viewTag) external whenNotPaused {
        StealthMeta storage meta = stealthMetas[viewTag];
        if (meta.registeredAt == 0 || !meta.active) revert MetaNotActive();
        meta.active = false;
    }

    /**
     * @param publicInputs [paymentTag, viewTag, commitmentHash, nullifierHash]
     */
    function claimStealthPayment(
        uint256[8] calldata proof,
        uint256[] calldata publicInputs
    ) external nonReentrant whenNotPaused {
        if (publicInputs.length < 4) revert InvalidPublicInputs();
        bytes32 paymentTag = bytes32(publicInputs[0]);
        bytes32 viewTag = bytes32(publicInputs[1]);
        if (spentPaymentTags[paymentTag]) revert PaymentTagSpent();
        StealthMeta storage meta = stealthMetas[viewTag];
        if (meta.registeredAt == 0 || !meta.active) revert MetaNotActive();

        _requireValidProof(STEALTH_CIRCUIT, proof, publicInputs);
        spentPaymentTags[paymentTag] = true;
        emit StealthPaymentClaimed(paymentTag, bytes32(publicInputs[2]));
    }
}

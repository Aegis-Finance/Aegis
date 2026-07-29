// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {PrivateTokenContract} from "../PrivateTokenContract.sol";

/**
 * @title MockPrivacyEntryRelay
 * @author Aegis Protocol Team
 * @notice Test / **Phase F scaffold**: an **authorized** forwarder for `PrivateTokenContract` **privacy entry**
 *         (`shield`, transparent exit via `unshield`, `shieldedTransfer`) so a **relayer EOA** pays gas while proofs bind value
 *         (`shield` debits `depositor` from public inputs when caller is authorized — see token NatSpec).
 * @dev Production: EIP-712 signed intents, nonces, relayer fee, allowlists, audits. Transparent exit (`unshield`) / `shieldedTransfer`
 *      here do **not** add extra binding checks — the ZK verifier must bind principals; relay only fixes **gas payer**.
 */
contract MockPrivacyEntryRelay {
    /// @notice The AGS privacy token.
    PrivateTokenContract public immutable TOKEN;

    /// @notice Successful `relayShield` calls.
    uint256 public shieldRelayCount;
    /// @notice Successful `relayUnshield` calls.
    uint256 public unshieldRelayCount;
    /// @notice Successful `relayShieldedTransfer` calls.
    uint256 public shieldedTransferRelayCount;

    error ZeroDepositor();
    error BadPublicInputLength();
    error DepositorMismatch(address expected, uint256 encoded);

    /**
     * @notice Deploys relay bound to `token_`; governance must `authorizeContract` on the token.
     * @param token_ Deployed `PrivateTokenContract`.
     */
    constructor(PrivateTokenContract token_) {
        TOKEN = token_;
    }

    /**
     * @notice Relayer calls here; `publicInputs` must match `mint-optimized` layout with
     *         `[3] = uint256(uint160(depositor))` (same as `mintShieldHelper.js`).
     * @param depositor Transparent balance debited by `shield` (must match `publicInputs[3]`).
     * @param proof Groth16 proof bytes for mint circuit.
     * @param publicInputs Four public signals: nullifier, commitment, amount, depositor.
     */
    function relayShield(address depositor, uint256[8] calldata proof, uint256[] calldata publicInputs) external {
        if (depositor == address(0)) revert ZeroDepositor();
        if (publicInputs.length < 4) revert BadPublicInputLength();
        uint256 encoded = publicInputs[3];
        address bound = address(uint160(encoded));
        if (bound != depositor) revert DepositorMismatch(depositor, encoded);

        TOKEN.shield(proof, publicInputs);
        unchecked {
            ++shieldRelayCount;
        }
    }

    /**
     * @notice Relayer forwards **transparent exit** (`TOKEN.unshield`; `transfer-unshield` verifier layout).
     * @param proof Groth16 proof for the transparent-exit verifier slot.
     * @param publicInputs Four values: `[nullifier, recipient, amount, inputCommitment]`.
     */
    function relayUnshield(uint256[8] calldata proof, uint256[] calldata publicInputs) external {
        TOKEN.unshield(proof, publicInputs);
        unchecked {
            ++unshieldRelayCount;
        }
    }

    /**
     * @notice Relayer forwards `shieldedTransfer` (commitment-to-commitment transfer proof).
     * @param proof Groth16 proof for transfer circuit.
     * @param publicInputs Eleven values: join-split layout for `PrivateTokenContract.shieldedTransfer` (see token NatSpec).
     */
    function relayShieldedTransfer(uint256[8] calldata proof, uint256[] calldata publicInputs) external {
        TOKEN.shieldedTransfer(proof, publicInputs);
        unchecked {
            ++shieldedTransferRelayCount;
        }
    }
}

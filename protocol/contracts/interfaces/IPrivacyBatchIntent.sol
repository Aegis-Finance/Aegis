// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/**
 * @title IPrivacyBatchIntent
 * @notice **Design surface only** (§3.2 R&D — not wired to production `PrivacyEntryRouter`).
 *         Future **unified privacy-entry batch** routers can standardize how relayers carry
 *         multiple user intents behind one `msg.sender` / one verification boundary.
 * @dev This does **not** implement verification, nonces, or token calls — see
 *      `docs/specs/PRIVACY_ADVANCED_ROUTERS_RND.md` for backlog and audit gates.
 */
interface IPrivacyBatchIntent {
    /// @notice One principal-bound intent inside a batch (hashed off-chain into `intentsRoot`).
    struct IntentSlice {
        /// @dev e.g. keccak256(abi.encodePacked("SHIELD", publicInputsDigest, depositor))
        bytes32 intentType;
        address principal;
        bytes32 publicInputsDigest;
        uint256 nonce;
        uint256 deadline;
    }

    /// @notice **Relay metadata firewall** — relayer-visible envelope; bind to EIP-712 domain separately.
    struct BatchRelayHeader {
        uint256 version;
        uint256 deadline;
        bytes32 intentsRoot;
        address feePayer;
    }
}

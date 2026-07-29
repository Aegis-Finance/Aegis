// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";

import {PrivateTokenContract} from "../PrivateTokenContract.sol";

/**
 * @title PrivacyEntryRouter
 * @author Aegis Protocol Team
 * @notice Production **privacy entry** router (shield-first): relayers submit **`shield`** (primary),
 *         **`shieldedTransfer`** (private rail), and **`unshield`** (transparent exit / compatibility) on
 *         `PrivateTokenContract` while **gas is paid by `msg.sender`**, as long as the economic principal
 *         (`depositor`, `recipient`, or `authorizedSigner`) has signed an **EIP-712** intent binding the exact
 *         `publicInputs` digest and a monotonic **nonce** (replay protection).
 * @dev Governance must `authorizeContract(address(this))` on `PrivateTokenContract` before `publicEntryEnabled`
 *      can safely be set `false` for end users. This contract does **not** verify ZK soundness—that is the
 *      verifier’s job; it only enforces **who approved this calldata** to be relayed.
 * @dev Optional **native `S` relay fee** (`relayFeeWei` → `feeRecipient`) is collected **only after** a successful
 *      `TOKEN` call; overpayment is refunded to `msg.sender`. Set both to zero to disable.
 */
contract PrivacyEntryRouter is EIP712, Ownable, ReentrancyGuard {
    /// @notice AGS privacy token.
    PrivateTokenContract public immutable TOKEN;

    /// @notice Per-principal replay protection (`principal` = depositor / recipient / authorizedSigner).
    mapping(address => uint256) public nonces;

    bool public paused;

    /// @notice Native token (S) fee per successful relay; zero disables.
    uint256 public relayFeeWei;
    /// @notice Recipient of `relayFeeWei` (required non-zero when fee is non-zero).
    address public feeRecipient;

    bytes32 private constant SHIELD_INTENT_TYPEHASH = keccak256(
        "ShieldIntent(address depositor,bytes32 publicInputsHash,uint256 nonce,uint256 deadline)"
    );
    bytes32 private constant UNSHIELD_INTENT_TYPEHASH = keccak256(
        "UnshieldIntent(address recipient,bytes32 publicInputsHash,uint256 nonce,uint256 deadline)"
    );
    bytes32 private constant SHIELDED_TRANSFER_INTENT_TYPEHASH = keccak256(
        "ShieldedTransferIntent(address authorizedSigner,bytes32 publicInputsHash,uint256 nonce,uint256 deadline)"
    );

    error ExpiredIntent();
    error BadSig();
    error BadNonce();
    error BadPublicInputLength();
    error DepositorMismatch();
    error RecipientMismatch();
    error ZeroAddress();
    error Paused();
    error InsufficientRelayFee();
    error FeeRecipientUnset();

    event RelayFeeSet(uint256 feeWei, address indexed recipient);
    event ShieldRelayed(address indexed relayer, address indexed depositor, bytes32 indexed publicInputsHash);
    event UnshieldRelayed(address indexed relayer, address indexed recipient, bytes32 indexed publicInputsHash);
    event ShieldedTransferRelayed(
        address indexed relayer,
        address indexed authorizedSigner,
        bytes32 indexed publicInputsHash
    );
    event PausedSet(bool paused);

    constructor(PrivateTokenContract token_, address initialOwner) EIP712("AegisPrivacyEntry", "1") Ownable(initialOwner) {
        if (address(token_) == address(0)) revert ZeroAddress();
        if (initialOwner == address(0)) revert ZeroAddress();
        TOKEN = token_;
    }

    function setPaused(bool v) external onlyOwner {
        paused = v;
        emit PausedSet(v);
    }

    /// @notice Configure optional native relay fee. If `feeWei > 0`, `recipient` must be non-zero.
    function setRelayFee(uint256 feeWei, address recipient) external onlyOwner {
        if (feeWei > 0 && recipient == address(0)) revert FeeRecipientUnset();
        relayFeeWei = feeWei;
        feeRecipient = recipient;
        emit RelayFeeSet(feeWei, recipient);
    }

    modifier whenNotPaused() {
        if (paused) revert Paused();
        _;
    }

    /// @dev Matches Solidity `keccak256(abi.encode(publicInputs))` for `uint256[]` calldata.
    function _publicInputsDigest(uint256[] calldata publicInputs) private pure returns (bytes32) {
        return keccak256(abi.encode(publicInputs));
    }

    function _settleRelayFee() private {
        uint256 fee = relayFeeWei;
        if (fee == 0) {
            if (msg.value > 0) {
                Address.sendValue(payable(msg.sender), msg.value);
            }
            return;
        }
        address to = feeRecipient;
        if (to == address(0)) revert FeeRecipientUnset();
        if (msg.value < fee) revert InsufficientRelayFee();
        Address.sendValue(payable(to), fee);
        uint256 excess = msg.value - fee;
        if (excess > 0) {
            Address.sendValue(payable(msg.sender), excess);
        }
    }

    /**
     * @notice Relay `shield` with depositor EIP-712 authorization.
     * @param publicInputs Mint public vector (length 4); `publicInputs[3]` must be `uint256(uint160(depositor))`.
     */
    function relayShield(
        uint256[8] calldata proof,
        uint256[] calldata publicInputs,
        uint256 deadline,
        uint256 nonce,
        bytes calldata signature
    ) external payable nonReentrant whenNotPaused {
        if (block.timestamp > deadline) revert ExpiredIntent();
        if (publicInputs.length != 4) revert BadPublicInputLength();

        address depositor = address(uint160(publicInputs[3]));
        if (depositor == address(0)) revert ZeroAddress();
        if (nonces[depositor] != nonce) revert BadNonce();

        bytes32 pih = _publicInputsDigest(publicInputs);
        bytes32 digest = _hashTypedDataV4(
            keccak256(abi.encode(SHIELD_INTENT_TYPEHASH, depositor, pih, nonce, deadline))
        );
        if (ECDSA.recover(digest, signature) != depositor) revert BadSig();

        unchecked {
            nonces[depositor]++;
        }
        TOKEN.shield(proof, publicInputs);
        _settleRelayFee();
        emit ShieldRelayed(msg.sender, depositor, pih);
    }

    /**
     * @notice Relay **transparent exit** (`PrivateTokenContract.unshield`) with recipient EIP-712 authorization.
     * @dev EIP-712 primary type remains `UnshieldIntent` (hash baked into deployed signatures — do not rename).
     * @param publicInputs Same public vector as direct `unshield` (length 4); `publicInputs[1]` encodes `recipient`.
     */
    function relayUnshield(
        uint256[8] calldata proof,
        uint256[] calldata publicInputs,
        uint256 deadline,
        uint256 nonce,
        bytes calldata signature
    ) external payable nonReentrant whenNotPaused {
        if (block.timestamp > deadline) revert ExpiredIntent();
        if (publicInputs.length != 4) revert BadPublicInputLength();

        address recipient = address(uint160(publicInputs[1]));
        if (recipient == address(0)) revert ZeroAddress();
        if (nonces[recipient] != nonce) revert BadNonce();

        bytes32 pih = _publicInputsDigest(publicInputs);
        bytes32 digest = _hashTypedDataV4(
            keccak256(abi.encode(UNSHIELD_INTENT_TYPEHASH, recipient, pih, nonce, deadline))
        );
        if (ECDSA.recover(digest, signature) != recipient) revert BadSig();

        unchecked {
            nonces[recipient]++;
        }
        TOKEN.unshield(proof, publicInputs);
        _settleRelayFee();
        emit UnshieldRelayed(msg.sender, recipient, pih);
    }

    /**
     * @notice Relay `shieldedTransfer` with an explicit authorizing key (prover / owner wallet).
     * @param proof Groth16 proof (`uint256[8]` packed) for `shielded-transfer` circuit.
     * @param publicInputs Join-split public vector (length **11**); must match `PrivateTokenContract.shieldedTransfer`.
     * @param authorizedSigner Must match `ECDSA.recover` — typically the user EOA that constructed the proof.
     */
    function relayShieldedTransfer(
        uint256[8] calldata proof,
        uint256[] calldata publicInputs,
        uint256 deadline,
        uint256 nonce,
        address authorizedSigner,
        bytes calldata signature
    ) external payable nonReentrant whenNotPaused {
        if (block.timestamp > deadline) revert ExpiredIntent();
        if (publicInputs.length != 11) revert BadPublicInputLength();
        if (authorizedSigner == address(0)) revert ZeroAddress();
        if (nonces[authorizedSigner] != nonce) revert BadNonce();

        bytes32 pih = _publicInputsDigest(publicInputs);
        bytes32 digest = _hashTypedDataV4(
            keccak256(
                abi.encode(SHIELDED_TRANSFER_INTENT_TYPEHASH, authorizedSigner, pih, nonce, deadline)
            )
        );
        if (ECDSA.recover(digest, signature) != authorizedSigner) revert BadSig();

        unchecked {
            nonces[authorizedSigner]++;
        }
        TOKEN.shieldedTransfer(proof, publicInputs);
        _settleRelayFee();
        emit ShieldedTransferRelayed(msg.sender, authorizedSigner, pih);
    }
}

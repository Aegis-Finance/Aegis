// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";

/**
 * @title AegisExecutionRelay
 * @notice Generic EIP-712 meta-transaction hub: relayers submit allowlisted contract calls while gas is paid
 *         by `msg.sender`. Users sign intents binding `{target, data, value, nonce, deadline}`.
 * @dev Complements `PrivacyEntryRouter` (token ZK entry). Use for Swap/LP/staking/lending/insurance calldata
 *      without per-module relay methods. Governance toggles `allowedTargets` and optional `allowedSelectors`.
 */
contract AegisExecutionRelay is EIP712, Ownable, ReentrancyGuard {
    mapping(address => uint256) public nonces;
    mapping(address => bool) public allowedTargets;
    mapping(address => mapping(bytes4 => bool)) public allowedSelectors;

    bool public paused;
    uint256 public relayFeeWei;
    address public feeRecipient;
    uint256 public maxGasPerRelay;

    bytes32 private constant EXECUTION_INTENT_TYPEHASH = keccak256(
        "ExecutionIntent(address user,address target,bytes32 dataHash,uint256 value,uint256 nonce,uint256 deadline)"
    );

    error ExpiredIntent();
    error BadSig();
    error BadNonce();
    error ZeroAddress();
    error Paused();
    error TargetNotAllowed();
    error SelectorNotAllowed();
    error CallFailed(bytes reason);
    error InsufficientRelayFee();
    error FeeRecipientUnset();

    event TargetAllowed(address indexed target, bool allowed);
    event SelectorAllowed(address indexed target, bytes4 indexed selector, bool allowed);
    event ExecutionRelayed(address indexed relayer, address indexed user, address indexed target, bytes32 dataHash);
    event RelayFeeSet(uint256 feeWei, address indexed recipient);
    event PausedSet(bool paused);
    event MaxGasPerRelaySet(uint256 maxGas);

    constructor(address initialOwner) EIP712("AegisExecutionRelay", "1") Ownable(initialOwner) {
        if (initialOwner == address(0)) revert ZeroAddress();
        maxGasPerRelay = 2_500_000;
    }

    function setPaused(bool v) external onlyOwner {
        paused = v;
        emit PausedSet(v);
    }

    function setRelayFee(uint256 feeWei, address recipient) external onlyOwner {
        if (feeWei > 0 && recipient == address(0)) revert FeeRecipientUnset();
        relayFeeWei = feeWei;
        feeRecipient = recipient;
        emit RelayFeeSet(feeWei, recipient);
    }

    function setMaxGasPerRelay(uint256 maxGas) external onlyOwner {
        maxGasPerRelay = maxGas;
        emit MaxGasPerRelaySet(maxGas);
    }

    function setAllowedTarget(address target, bool allowed) external onlyOwner {
        if (target == address(0)) revert ZeroAddress();
        allowedTargets[target] = allowed;
        emit TargetAllowed(target, allowed);
    }

    function setAllowedSelector(address target, bytes4 selector, bool allowed) external onlyOwner {
        if (target == address(0)) revert ZeroAddress();
        allowedSelectors[target][selector] = allowed;
        emit SelectorAllowed(target, selector, allowed);
    }

    function execute(
        address user,
        address target,
        bytes calldata data,
        uint256 value,
        uint256 deadline,
        uint256 nonce,
        bytes calldata signature
    ) external payable nonReentrant whenNotPaused returns (bytes memory result) {
        if (block.timestamp > deadline) revert ExpiredIntent();
        if (user == address(0) || target == address(0)) revert ZeroAddress();
        if (!allowedTargets[target]) revert TargetNotAllowed();
        if (data.length >= 4) {
            bytes4 sel;
            assembly {
                sel := calldataload(data.offset)
            }
            if (!allowedSelectors[target][sel]) revert SelectorNotAllowed();
        }
        if (nonces[user] != nonce) revert BadNonce();
        if (msg.value < value + relayFeeWei) revert InsufficientRelayFee();

        bytes32 dataHash = keccak256(data);
        bytes32 digest = _hashTypedDataV4(
            keccak256(abi.encode(EXECUTION_INTENT_TYPEHASH, user, target, dataHash, value, nonce, deadline))
        );
        if (ECDSA.recover(digest, signature) != user) revert BadSig();

        unchecked {
            nonces[user]++;
        }

        (bool ok, bytes memory ret) = target.call{value: value, gas: maxGasPerRelay}(data);
        if (!ok) revert CallFailed(ret);

        _settleRelayFee(value);
        emit ExecutionRelayed(msg.sender, user, target, dataHash);
        return ret;
    }

    function _settleRelayFee(uint256 userValue) private {
        uint256 fee = relayFeeWei;
        uint256 required = userValue + fee;
        if (fee == 0) {
            if (msg.value > userValue) {
                Address.sendValue(payable(msg.sender), msg.value - userValue);
            }
            return;
        }
        address to = feeRecipient;
        if (to == address(0)) revert FeeRecipientUnset();
        Address.sendValue(payable(to), fee);
        uint256 excess = msg.value - required;
        if (excess > 0) {
            Address.sendValue(payable(msg.sender), excess);
        }
    }

    modifier whenNotPaused() {
        if (paused) revert Paused();
        _;
    }
}

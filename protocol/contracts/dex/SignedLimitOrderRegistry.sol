// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title SignedLimitOrderRegistry
 * @notice M3+: EIP-712 signed resting limit orders (ERC20 ↔ ERC20). Escrows `sellToken` on-chain; filler pays `minBuyAmount` of `buyToken` to maker and receives the escrowed lot. Fully explorer-visible.
 * @dev Not a CLOB matcher — one order id = one full lot. Relayers may submit `place` / `cancel` on behalf of makers using signatures.
 */
contract SignedLimitOrderRegistry is EIP712, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 private constant LIMIT_ORDER_TYPEHASH = keccak256(
        "LimitOrder(address maker,address sellToken,address buyToken,uint256 sellAmount,uint256 minBuyAmount,uint256 expiry,uint256 salt)"
    );

    struct LimitOrder {
        address maker;
        address sellToken;
        address buyToken;
        uint256 sellAmount;
        uint256 minBuyAmount;
        uint256 expiry;
        uint256 salt;
    }

    uint256 public nextOrderId;
    mapping(uint256 => bytes32) public orderDigest;
    mapping(uint256 => bool) public orderActive;
    mapping(bytes32 => bool) public digestUsed;
    bool public paused;

    event LimitOrderPlaced(uint256 indexed id, address indexed maker, bytes32 indexed digest, address sellToken, address buyToken);
    event LimitOrderCancelled(uint256 indexed id, address indexed maker);
    event LimitOrderFilled(uint256 indexed id, address indexed filler, address indexed maker);

    error ZeroAddress();
    error BadAmount();
    error BadExpiry();
    /// @dev Active-window cancel/fill attempted after `order.expiry` — use `reclaimExpired` instead of `cancel`.
    error OrderExpired();
    error BadSig();
    error DuplicateDigest();
    error InactiveOrder();
    error OrderMismatch();
    error Paused();
    error SameToken();
    error NotMaker();
    error NotExpired();

    constructor(address initialOwner) EIP712("AegisSignedLimitOrders", "1") Ownable(initialOwner) {}

    function setPaused(bool v) external onlyOwner {
        paused = v;
    }

    function _hashOrder(LimitOrder calldata order) internal view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    LIMIT_ORDER_TYPEHASH,
                    order.maker,
                    order.sellToken,
                    order.buyToken,
                    order.sellAmount,
                    order.minBuyAmount,
                    order.expiry,
                    order.salt
                )
            )
        );
    }

    /// @notice Validates signature and escrows `sellAmount` of `sellToken` from `maker`.
    function place(LimitOrder calldata order, bytes calldata signature) external nonReentrant returns (uint256 id) {
        if (paused) revert Paused();
        if (order.sellToken == address(0) || order.buyToken == address(0)) revert ZeroAddress();
        if (order.sellToken == order.buyToken) revert SameToken();
        if (order.sellAmount == 0 || order.minBuyAmount == 0) revert BadAmount();
        if (order.expiry <= block.timestamp) revert BadExpiry();

        bytes32 digest = _hashOrder(order);
        if (digestUsed[digest]) revert DuplicateDigest();
        address signer = ECDSA.recover(digest, signature);
        if (signer != order.maker) revert BadSig();

        digestUsed[digest] = true;
        id = nextOrderId++;
        orderDigest[id] = digest;
        orderActive[id] = true;

        IERC20(order.sellToken).safeTransferFrom(order.maker, address(this), order.sellAmount);
        emit LimitOrderPlaced(id, order.maker, digest, order.sellToken, order.buyToken);
    }

    /// @notice Cancels an active order before expiry; returns escrowed sell tokens to maker.
    function cancel(uint256 id, LimitOrder calldata order, bytes calldata signature) external nonReentrant {
        if (paused) revert Paused();
        if (!orderActive[id]) revert InactiveOrder();
        if (block.timestamp >= order.expiry) revert OrderExpired();
        bytes32 digest = _hashOrder(order);
        if (orderDigest[id] != digest) revert OrderMismatch();

        address signer = ECDSA.recover(digest, signature);
        if (signer != order.maker) revert BadSig();

        orderActive[id] = false;
        IERC20(order.sellToken).safeTransfer(order.maker, order.sellAmount);
        emit LimitOrderCancelled(id, order.maker);
    }

    /// @notice After expiry, maker sweeps escrowed sell tokens if unfilled.
    function reclaimExpired(uint256 id, LimitOrder calldata order) external nonReentrant {
        if (paused) revert Paused();
        if (!orderActive[id]) revert InactiveOrder();
        bytes32 digest = _hashOrder(order);
        if (orderDigest[id] != digest) revert OrderMismatch();
        if (msg.sender != order.maker) revert NotMaker();
        if (block.timestamp < order.expiry) revert NotExpired();

        orderActive[id] = false;
        IERC20(order.sellToken).safeTransfer(order.maker, order.sellAmount);
        emit LimitOrderCancelled(id, order.maker);
    }

    /// @notice Fills the full lot: filler pays `minBuyAmount` buyToken to maker, receives `sellAmount` sellToken from escrow.
    function fill(uint256 id, LimitOrder calldata order) external nonReentrant {
        if (paused) revert Paused();
        if (!orderActive[id]) revert InactiveOrder();
        if (block.timestamp >= order.expiry) revert OrderExpired();
        bytes32 digest = _hashOrder(order);
        if (orderDigest[id] != digest) revert OrderMismatch();

        orderActive[id] = false;
        IERC20(order.buyToken).safeTransferFrom(msg.sender, order.maker, order.minBuyAmount);
        IERC20(order.sellToken).safeTransfer(msg.sender, order.sellAmount);
        emit LimitOrderFilled(id, msg.sender, order.maker);
    }
}

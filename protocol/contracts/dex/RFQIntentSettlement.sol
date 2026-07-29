// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title RFQIntentSettlement
 * @notice M4 v1: one-shot EIP-712 RFQ — maker signs a firm quote; first filler atomically delivers `minBuyAmount` of `buyToken` to maker and receives `sellAmount` of `sellToken` from maker (allowance-based). Explorer-visible.
 * @dev Not a solver registry — professional flow can wrap this with off-chain competition. Each digest fills once.
 */
contract RFQIntentSettlement is EIP712, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 private constant RFQ_ORDER_TYPEHASH = keccak256(
        "RFQOrder(address maker,address sellToken,address buyToken,uint256 sellAmount,uint256 minBuyAmount,uint256 deadline,uint256 salt)"
    );

    struct RFQOrder {
        address maker;
        address sellToken;
        address buyToken;
        uint256 sellAmount;
        uint256 minBuyAmount;
        uint256 deadline;
        uint256 salt;
    }

    mapping(bytes32 => bool) public filled;
    bool public paused;

    event RFQFilled(bytes32 indexed digest, address indexed filler, address indexed maker);

    error ZeroAddress();
    error BadAmount();
    error BadDeadline();
    error BadSig();
    error AlreadyFilled();
    error Paused();
    error SameToken();

    constructor(address initialOwner) EIP712("AegisRFQIntent", "1") Ownable(initialOwner) {}

    function setPaused(bool v) external onlyOwner {
        paused = v;
    }

    function _hashOrder(RFQOrder calldata order) internal view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    RFQ_ORDER_TYPEHASH,
                    order.maker,
                    order.sellToken,
                    order.buyToken,
                    order.sellAmount,
                    order.minBuyAmount,
                    order.deadline,
                    order.salt
                )
            )
        );
    }

    /// @notice Atomically settle a signed RFQ. Maker must have approved this contract for `sellToken`.
    function fill(RFQOrder calldata order, bytes calldata signature) external nonReentrant {
        if (paused) revert Paused();
        if (order.sellToken == address(0) || order.buyToken == address(0)) revert ZeroAddress();
        if (order.sellToken == order.buyToken) revert SameToken();
        if (order.sellAmount == 0 || order.minBuyAmount == 0) revert BadAmount();
        if (order.deadline < block.timestamp) revert BadDeadline();

        bytes32 digest = _hashOrder(order);
        if (filled[digest]) revert AlreadyFilled();
        address signer = ECDSA.recover(digest, signature);
        if (signer != order.maker) revert BadSig();

        filled[digest] = true;
        IERC20(order.buyToken).safeTransferFrom(msg.sender, order.maker, order.minBuyAmount);
        IERC20(order.sellToken).safeTransferFrom(order.maker, msg.sender, order.sellAmount);
        emit RFQFilled(digest, msg.sender, order.maker);
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title TransparentEscrowOrders
 * @notice M3 starter: fixed-price P2P sells of AGS for quote (ERC20 or native). Fully explorer-visible.
 * @dev Not an AMM; no price oracle — maker sets a firm `quoteTotal` for the lot. Governance owns `pause` via owner.
 */
contract TransparentEscrowOrders is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable agsToken;

    struct Order {
        address maker;
        uint256 amountAgs;
        uint256 quoteTotal;
        address quoteToken;
        bool quoteIsNative;
        uint256 expiry;
        bool cancelled;
        bool filled;
    }

    uint256 public nextOrderId;
    mapping(uint256 => Order) public orders;
    bool public paused;

    event SellOrderCreated(
        uint256 indexed id, address indexed maker, uint256 amountAgs, uint256 quoteTotal, address quoteToken, bool quoteIsNative, uint256 expiry
    );
    event SellOrderCancelled(uint256 indexed id, address indexed maker);
    event SellOrderFilled(uint256 indexed id, address indexed filler, address indexed maker, uint256 amountAgs, uint256 quoteTotal);

    error ZeroAddress();
    error BadAmount();
    error BadExpiry();
    error Paused();
    error NotMaker();
    error BadState();
    error Expired();
    error NotExpired();
    error WrongNativeValue();

    constructor(address initialOwner, address _agsToken) Ownable(initialOwner) {
        if (_agsToken == address(0)) revert ZeroAddress();
        agsToken = IERC20(_agsToken);
    }

    function setPaused(bool v) external onlyOwner {
        paused = v;
    }

    /// @notice Escrow AGS at a fixed `quoteTotal` price for the full lot.
    function createSellOrder(uint256 amountAgs, uint256 quoteTotal, address quoteTok, bool quoteNative, uint256 expiry)
        external
        nonReentrant
        returns (uint256 id)
    {
        if (paused) revert Paused();
        if (amountAgs == 0 || quoteTotal == 0) revert BadAmount();
        if (expiry <= block.timestamp) revert BadExpiry();
        if (!quoteNative && quoteTok == address(0)) revert ZeroAddress();

        id = nextOrderId++;
        orders[id] = Order({
            maker: msg.sender,
            amountAgs: amountAgs,
            quoteTotal: quoteTotal,
            quoteToken: quoteTok,
            quoteIsNative: quoteNative,
            expiry: expiry,
            cancelled: false,
            filled: false
        });

        agsToken.safeTransferFrom(msg.sender, address(this), amountAgs);
        emit SellOrderCreated(id, msg.sender, amountAgs, quoteTotal, quoteTok, quoteNative, expiry);
    }

    function cancelOrder(uint256 id) external nonReentrant {
        Order storage o = orders[id];
        if (o.maker == address(0)) revert BadState();
        if (o.maker != msg.sender) revert NotMaker();
        if (o.filled || o.cancelled) revert BadState();
        if (block.timestamp >= o.expiry) revert Expired();

        o.cancelled = true;
        agsToken.safeTransfer(o.maker, o.amountAgs);
        emit SellOrderCancelled(id, o.maker);
    }

    /// @notice After expiry, maker sweeps AGS back if unfilled.
    function reclaimExpired(uint256 id) external nonReentrant {
        Order storage o = orders[id];
        if (o.maker == address(0)) revert BadState();
        if (o.maker != msg.sender) revert NotMaker();
        if (o.filled || o.cancelled) revert BadState();
        if (block.timestamp < o.expiry) revert NotExpired();

        o.cancelled = true;
        agsToken.safeTransfer(o.maker, o.amountAgs);
        emit SellOrderCancelled(id, o.maker);
    }

    /// @notice Pay `quoteTotal` to maker; receive escrowed AGS. ERC20 quote pulls from filler; native requires exact `msg.value`.
    function fillSellOrder(uint256 id) external payable nonReentrant {
        if (paused) revert Paused();
        Order storage o = orders[id];
        if (o.maker == address(0)) revert BadState();
        if (o.filled || o.cancelled) revert BadState();
        if (block.timestamp >= o.expiry) revert Expired();

        o.filled = true;

        if (o.quoteIsNative) {
            if (msg.value != o.quoteTotal) revert WrongNativeValue();
            (bool ok,) = o.maker.call{value: o.quoteTotal}("");
            if (!ok) revert();
        } else {
            IERC20(o.quoteToken).safeTransferFrom(msg.sender, o.maker, o.quoteTotal);
        }

        agsToken.safeTransfer(msg.sender, o.amountAgs);
        emit SellOrderFilled(id, msg.sender, o.maker, o.amountAgs, o.quoteTotal);
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {GovernanceAccessLib} from "../libraries/GovernanceAccessLib.sol";
import {AuctionPriceLib} from "../tokendistribution/libs/AuctionPriceLib.sol";

/**
 * @title TreasuryBondAuction
 * @notice Weekly-style **Dutch auction** of fixed-term **AGS notes**: bidders pay `QUOTE_TOKEN` (e.g. wS)
 *         at the running Dutch price (quote per 1e18 AGS, WAD) and receive locked AGS redeemable after
 *         `maturity`. All AGS is **pre-funded** — no mint; aligns with the **21M fixed supply** policy.
 * @dev Governance opens each auction, sets capacity and schedule. `AuctionPriceLib` defines the price path.
 *      v1 is fully transparent; commitments / ZK can wrap this module later.
 *
 *      **Phase-B stealth routing:** `purchaseTo` lets `msg.sender` pay quote while the **note** (redeemable AGS)
 *      is owned by `noteHolder` — useful for separating hot payer from cold / vault holder. Does not hide
 *      quote amount or timing on-chain; full bid privacy requires a later ZK or commit layer.
 */
contract TreasuryBondAuction is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable AGS;
    IERC20 public immutable QUOTE_TOKEN;

    address public governanceContract;
    address public timelockController;

    struct Note {
        uint256 agsFace;
        uint256 maturity;
        bool redeemed;
    }

    uint256 public nextNoteId;
    mapping(uint256 => Note) public notes;
    mapping(uint256 => address) public noteOwner;

    uint256 public auctionId;
    bool public auctionCompleted;
    uint256 public agsCapacity;
    uint256 public agsSold;
    /// @notice Sum of `agsFace` for notes not yet redeemed — must remain backed on balance sheet.
    uint256 public agsLiability;
    uint256 public startPriceQuotePerAgsWad;
    uint256 public reservePriceQuotePerAgsWad;
    uint256 public auctionStart;
    uint256 public auctionEnd;
    uint256 public maturity;

    event TimelockControllerUpdated(address indexed previousTimelock, address indexed newTimelock);
    event GovernanceUpdated(address indexed previousGovernance, address indexed newGovernance);
    event AuctionOpened(
        uint256 indexed id,
        uint256 agsCapacity,
        uint256 startPriceWad,
        uint256 reservePriceWad,
        uint256 start,
        uint256 end,
        uint256 maturity
    );
    event AuctionFilled(uint256 indexed id);
    event NotePurchased(address indexed holder, uint256 indexed noteId, uint256 quotePaid, uint256 agsFace);
    /// @notice When payer != note holder (see `purchaseTo`). `holder` in `NotePurchased` is the redeemable party.
    event BondPurchaseRouted(address indexed payer, address indexed noteHolder, uint256 indexed noteId);
    event NoteRedeemed(address indexed holder, uint256 indexed noteId, uint256 agsOut);

    error ZeroAddress();
    error ZeroAmount();
    error UnauthorizedAccess();
    error AuctionInactive();
    error AuctionClosed();
    error Slippage();
    error NotMature();
    error BadSchedule();
    error AlreadyRedeemed();
    error InsufficientAgsForAuction();

    modifier onlyGovernance() {
        if (!GovernanceAccessLib.isGovernanceTimelockOrCore(governanceContract, timelockController, msg.sender)) {
            revert UnauthorizedAccess();
        }
        _;
    }

    constructor(address initialOwner, address ags_, address quote_) Ownable(initialOwner) {
        if (ags_ == address(0) || quote_ == address(0)) revert ZeroAddress();
        AGS = IERC20(ags_);
        QUOTE_TOKEN = IERC20(quote_);
    }

    function setGovernance(address g) external onlyOwner {
        if (g == address(0)) revert ZeroAddress();
        emit GovernanceUpdated(governanceContract, g);
        governanceContract = g;
    }

    function setTimelockController(address t) external onlyGovernance {
        emit TimelockControllerUpdated(timelockController, t);
        timelockController = t;
    }

    /// @notice Treasury transfers AGS here, then governance opens the auction window.
    function openAuction(
        uint256 agsCapacity_,
        uint256 startPriceQuotePerAgsWad_,
        uint256 reservePriceQuotePerAgsWad_,
        uint256 auctionStart_,
        uint256 auctionEnd_,
        uint256 maturity_
    ) external onlyGovernance {
        if (agsCapacity_ == 0) revert ZeroAmount();
        if (auctionEnd_ <= auctionStart_ || maturity_ < auctionEnd_) revert BadSchedule();
        if (startPriceQuotePerAgsWad_ <= reservePriceQuotePerAgsWad_) revert BadSchedule();
        uint256 bal = AGS.balanceOf(address(this));
        if (bal < agsLiability + agsCapacity_) revert InsufficientAgsForAuction();

        unchecked {
            ++auctionId;
        }
        auctionCompleted = false;
        agsCapacity = agsCapacity_;
        agsSold = 0;
        startPriceQuotePerAgsWad = startPriceQuotePerAgsWad_;
        reservePriceQuotePerAgsWad = reservePriceQuotePerAgsWad_;
        auctionStart = auctionStart_;
        auctionEnd = auctionEnd_;
        maturity = maturity_;

        emit AuctionOpened(
            auctionId, agsCapacity_, startPriceQuotePerAgsWad_, reservePriceQuotePerAgsWad_, auctionStart_, auctionEnd_, maturity_
        );
    }

    function spotPriceQuotePerAgsWad() public view returns (uint256) {
        return AuctionPriceLib.linearDutchPrice(
            startPriceQuotePerAgsWad,
            reservePriceQuotePerAgsWad,
            auctionStart,
            auctionEnd,
            block.timestamp,
            auctionCompleted
        );
    }

    /**
     * @notice Pay quote and receive a note entitling `agsFace` AGS at `maturity` (fixed for this auction).
     * @param quoteMax Maximum quote willing to pay (pulls exact after floor rounding).
     * @param minAgsFace Minimum AGS (1e18 scale) — slippage guard.
     */
    function purchase(uint256 quoteMax, uint256 minAgsFace) external nonReentrant returns (uint256 noteId) {
        return _purchase(msg.sender, msg.sender, quoteMax, minAgsFace);
    }

    /**
     * @notice Same as `purchase` but the redeemable note is assigned to `noteHolder` (payer remains `msg.sender`).
     */
    function purchaseTo(address noteHolder, uint256 quoteMax, uint256 minAgsFace) external nonReentrant returns (uint256 noteId) {
        if (noteHolder == address(0)) revert ZeroAddress();
        return _purchase(msg.sender, noteHolder, quoteMax, minAgsFace);
    }

    function _purchase(address payer, address noteHolder, uint256 quoteMax, uint256 minAgsFace)
        internal
        returns (uint256 noteId)
    {
        if (auctionId == 0) revert AuctionInactive();
        if (auctionCompleted) revert AuctionClosed();
        if (block.timestamp < auctionStart || block.timestamp > auctionEnd) revert AuctionInactive();

        uint256 priceWad = spotPriceQuotePerAgsWad();
        uint256 remaining = agsCapacity - agsSold;
        if (remaining == 0) revert AuctionClosed();

        uint256 agsDesired = Math.mulDiv(quoteMax, AuctionPriceLib.WAD, priceWad, Math.Rounding.Floor);
        if (agsDesired < minAgsFace) revert Slippage();
        uint256 agsFace = agsDesired > remaining ? remaining : agsDesired;
        uint256 quoteNeeded = Math.mulDiv(agsFace, priceWad, AuctionPriceLib.WAD, Math.Rounding.Ceil);
        if (quoteNeeded > quoteMax) revert Slippage();

        agsSold += agsFace;
        agsLiability += agsFace;
        if (agsSold >= agsCapacity) {
            auctionCompleted = true;
            emit AuctionFilled(auctionId);
        }

        QUOTE_TOKEN.safeTransferFrom(payer, address(this), quoteNeeded);

        noteId = nextNoteId++;
        notes[noteId] = Note({agsFace: agsFace, maturity: maturity, redeemed: false});
        noteOwner[noteId] = noteHolder;

        emit NotePurchased(noteHolder, noteId, quoteNeeded, agsFace);
        if (payer != noteHolder) {
            emit BondPurchaseRouted(payer, noteHolder, noteId);
        }
    }

    function redeem(uint256 noteId) external nonReentrant {
        if (noteOwner[noteId] != msg.sender) revert UnauthorizedAccess();
        Note storage n = notes[noteId];
        if (n.agsFace == 0) revert ZeroAmount();
        if (n.redeemed) revert AlreadyRedeemed();
        if (block.timestamp < n.maturity) revert NotMature();
        n.redeemed = true;
        agsLiability -= n.agsFace;
        AGS.safeTransfer(msg.sender, n.agsFace);
        emit NoteRedeemed(msg.sender, noteId, n.agsFace);
    }

    /// @notice Governance sweeps accumulated quote (treasury income) to a sink.
    function sweepQuote(address to, uint256 amount) external onlyGovernance {
        if (to == address(0)) revert ZeroAddress();
        QUOTE_TOKEN.safeTransfer(to, amount);
    }
}

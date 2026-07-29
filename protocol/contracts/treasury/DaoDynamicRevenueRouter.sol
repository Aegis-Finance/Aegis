// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IPrivateGovernance} from "../interfaces/IPrivateGovernance.sol";
import {GovernanceAccessLib} from "../libraries/GovernanceAccessLib.sol";

/**
 * @title DaoDynamicRevenueRouter
 * @author Aegis Protocol Team
 * @notice Pulls a payment token (e.g. AGS) from a payer and routes it across DAO sinks using a
 *         **base split** (basis points) that is **tilted live** using only on-chain signals:
 *         the current `paymentToken` balance of `insuranceSink` vs configurable watermarks.
 * @dev This is not an oracle product: tilts are bounded, deterministic, and governance-controlled.
 *      Typical sinks: governance treasury, insurance pool/vault, ecosystem / flywheel rewards.
 */
contract DaoDynamicRevenueRouter is ReentrancyGuard {
    using SafeERC20 for IERC20;

    IPrivateGovernance public governance;
    address public timelockController;

    IERC20 public paymentToken;

    address public governanceTreasury;
    address public insuranceSink;
    address public ecosystemFlywheel;

    /// @notice Base split; must sum to 10_000.
    uint16 public baseGovBps;
    uint16 public baseInsBps;
    uint16 public baseEcoBps;

    /// @notice When `paymentToken` balance of `insuranceSink` is **below** this, up to `maxTiltBps`
    ///         is moved from the governance slice into the insurance slice (bounded by available gov bps).
    uint256 public insuranceLowWatermark;
    /// @notice When balance is **above** this, up to `maxTiltBps` moves from insurance → ecosystem slice.
    uint256 public insuranceHighWatermark;

    /// @notice Maximum tilt applied in either direction (basis points).
    uint16 public maxTiltBps;

    /// @notice When `payAndRoute(amount)` is called with `amount >= analyticsMinPriceWei` and
    ///         `analyticsSubscriptionDurationSeconds > 0`, extend `analyticsAccessUntil[msg.sender]`.
    uint256 public analyticsMinPriceWei;
    /// @notice Seconds added to subscription end on each qualifying payment (stackable from `max(now, currentUntil)`).
    uint256 public analyticsSubscriptionDurationSeconds;
    /// @notice Unix timestamp until which `msg.sender` may use subscription-gated services (off-chain indexer proxy, etc.).
    mapping(address => uint256) public analyticsAccessUntil;

    error InvalidSplit();
    error ZeroAddress();
    error ZeroAmount();
    error UnauthorizedGovernance();
    error BadTilt();
    error MissingSink();

    event PaymentRouted(
        address indexed payer,
        uint256 amount,
        uint256 toGov,
        uint256 toIns,
        uint256 toEco,
        uint16 effGovBps,
        uint16 effInsBps,
        uint16 effEcoBps
    );
    event GovernanceUpdated(address indexed oldGovernance, address indexed newGovernance);
    event TimelockUpdated(address indexed newTimelock);
    event SinksUpdated(address govTreasury, address insurance, address ecosystem);
    event BaseSplitUpdated(uint16 govBps, uint16 insBps, uint16 ecoBps);
    event WatermarksUpdated(uint256 low, uint256 high);
    event MaxTiltUpdated(uint16 maxTiltBps);
    event AnalyticsAccessParamsUpdated(uint256 minPriceWei, uint256 durationSeconds);
    event AnalyticsAccessExtended(address indexed wallet, uint256 accessUntil);

    modifier onlyGovernance() {
        if (!GovernanceAccessLib.isGovernanceTimelockOrCore(address(governance), timelockController, msg.sender)) {
            revert UnauthorizedGovernance();
        }
        _;
    }

    constructor(
        address governance_,
        address timelock_,
        address paymentToken_,
        address govTreasury_,
        address insuranceSink_,
        address ecoFlywheel_,
        uint16 baseGov_,
        uint16 baseIns_,
        uint16 baseEco_,
        uint256 lowWatermark_,
        uint256 highWatermark_,
        uint16 maxTilt_,
        uint256 analyticsMinPriceWei_,
        uint256 analyticsSubscriptionDurationSeconds_
    ) {
        if (governance_ == address(0) || paymentToken_ == address(0)) revert ZeroAddress();
        _validateSplit(baseGov_, baseIns_, baseEco_);
        if (maxTilt_ > 5000) revert BadTilt();

        governance = IPrivateGovernance(governance_);
        timelockController = timelock_;
        paymentToken = IERC20(paymentToken_);

        governanceTreasury = govTreasury_;
        insuranceSink = insuranceSink_;
        ecosystemFlywheel = ecoFlywheel_;

        baseGovBps = baseGov_;
        baseInsBps = baseIns_;
        baseEcoBps = baseEco_;
        insuranceLowWatermark = lowWatermark_;
        insuranceHighWatermark = highWatermark_;
        maxTiltBps = maxTilt_;
        analyticsMinPriceWei = analyticsMinPriceWei_;
        analyticsSubscriptionDurationSeconds = analyticsSubscriptionDurationSeconds_;
    }

    function setGovernance(address newGovernance, address newTimelock) external onlyGovernance {
        if (newGovernance == address(0)) revert ZeroAddress();
        address old = address(governance);
        governance = IPrivateGovernance(newGovernance);
        timelockController = newTimelock;
        emit GovernanceUpdated(old, newGovernance);
        emit TimelockUpdated(newTimelock);
    }

    function setSinks(address govTreasury_, address insuranceSink_, address ecoFlywheel_) external onlyGovernance {
        governanceTreasury = govTreasury_;
        insuranceSink = insuranceSink_;
        ecosystemFlywheel = ecoFlywheel_;
        emit SinksUpdated(govTreasury_, insuranceSink_, ecoFlywheel_);
    }

    function setBaseSplit(uint16 g, uint16 i, uint16 e) external onlyGovernance {
        _validateSplit(g, i, e);
        baseGovBps = g;
        baseInsBps = i;
        baseEcoBps = e;
        emit BaseSplitUpdated(g, i, e);
    }

    function setWatermarks(uint256 low_, uint256 high_) external onlyGovernance {
        insuranceLowWatermark = low_;
        insuranceHighWatermark = high_;
        emit WatermarksUpdated(low_, high_);
    }

    function setMaxTilt(uint16 v) external onlyGovernance {
        if (v > 5000) revert BadTilt();
        maxTiltBps = v;
        emit MaxTiltUpdated(v);
    }

    function setAnalyticsAccessParams(uint256 minPriceWei, uint256 durationSeconds) external onlyGovernance {
        analyticsMinPriceWei = minPriceWei;
        analyticsSubscriptionDurationSeconds = durationSeconds;
        emit AnalyticsAccessParamsUpdated(minPriceWei, durationSeconds);
    }

    /**
     * @notice Whether `user` has an active analytics / API-proxy subscription (cryptographically verifiable on-chain).
     */
    function hasAnalyticsSubscription(address user) external view returns (bool) {
        return analyticsAccessUntil[user] > block.timestamp;
    }

    /**
     * @notice Effective basis-point split after applying insurance-balance tilts.
     * @dev Sum is always 10_000; uses `insuranceSink` token balance as the only live signal.
     */
    function effectiveSplitBps() public view returns (uint16 g, uint16 i, uint16 e) {
        g = baseGovBps;
        i = baseInsBps;
        e = baseEcoBps;

        if (insuranceSink == address(0)) {
            return (g, i, e);
        }

        uint256 bal = paymentToken.balanceOf(insuranceSink);

        if (insuranceLowWatermark > 0 && bal < insuranceLowWatermark) {
            uint16 t = maxTiltBps;
            if (t > g) t = g;
            g -= t;
            i += t;
        } else if (insuranceHighWatermark > 0 && bal > insuranceHighWatermark) {
            uint16 t = maxTiltBps;
            if (t > i) t = i;
            i -= t;
            e += t;
        }

        if (uint256(g) + uint256(i) + uint256(e) != 10_000) revert InvalidSplit();
    }

    /**
     * @notice Pull `amount` of `paymentToken` from `msg.sender` and forward to sinks using the live split.
     */
    function payAndRoute(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (governanceTreasury == address(0) || insuranceSink == address(0) || ecosystemFlywheel == address(0)) {
            revert MissingSink();
        }

        (uint16 gBps, uint16 iBps, uint16 eBps) = effectiveSplitBps();

        paymentToken.safeTransferFrom(msg.sender, address(this), amount);

        uint256 toGov = (amount * uint256(gBps)) / 10_000;
        uint256 toIns = (amount * uint256(iBps)) / 10_000;
        uint256 toEco = amount - toGov - toIns;

        paymentToken.safeTransfer(governanceTreasury, toGov);
        paymentToken.safeTransfer(insuranceSink, toIns);
        paymentToken.safeTransfer(ecosystemFlywheel, toEco);

        if (analyticsMinPriceWei > 0 && analyticsSubscriptionDurationSeconds > 0 && amount >= analyticsMinPriceWei) {
            uint256 cur = analyticsAccessUntil[msg.sender];
            uint256 baseTs = cur > block.timestamp ? cur : block.timestamp;
            uint256 newUntil = baseTs + analyticsSubscriptionDurationSeconds;
            analyticsAccessUntil[msg.sender] = newUntil;
            emit AnalyticsAccessExtended(msg.sender, newUntil);
        }

        emit PaymentRouted(msg.sender, amount, toGov, toIns, toEco, gBps, iBps, eBps);
    }

    function _validateSplit(uint16 gov_, uint16 ins_, uint16 eco_) internal pure {
        if (uint256(gov_) + uint256(ins_) + uint256(eco_) != 10_000) revert InvalidSplit();
    }
}

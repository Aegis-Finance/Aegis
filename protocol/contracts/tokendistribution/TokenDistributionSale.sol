// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {IVerifierFactory} from "../interfaces/IVerifierFactory.sol";
import {AuctionPriceLib} from "./libs/AuctionPriceLib.sol";
import {TokenDistributionVerifierLib} from "./libraries/TokenDistributionVerifierLib.sol";

/// @notice Mintable sale token (e.g. `MintableTestToken` in tests).
interface IMintableSaleToken {
    function mint(address to, uint256 amount) external;
}

/**
 * @title TokenDistributionSale
 * @author Aegis Protocol Team
 * @notice ZK-gated allowlist distribution: verifies `"tokendistribution"` Groth16 on `VerifierFactory`, binds public signals to sale state, enforces one-shot nullifiers, and mints sale tokens against ETH at the Dutch spot price.
 * @dev Public I/O order must match `circuits/tokendistribution.circom` (`TokenDistributionVerifierLib`). Proofs must use the current `supplyRemaining` snapshot; after each purchase the buyer refreshes the witness.
 */
contract TokenDistributionSale is Ownable, ReentrancyGuard {
    IVerifierFactory public immutable VERIFIER_FACTORY;
    IMintableSaleToken public immutable SALE_TOKEN;
    /// @notice Receives ETH proceeds for each purchase (`cost` wei).
    address payable public immutable ETH_RECIPIENT;

    bytes32 public merkleRoot;
    uint256 public maxPurchaseLimitGlobal;
    uint256 public supplyRemaining;
    uint256 public startPrice;
    uint256 public reservePrice;
    uint256 public startTime;
    uint256 public endTime;
    bool public saleCompleted;

    mapping(bytes32 => bool) public nullifierSpent;

    event SaleWindowUpdated(uint256 startPrice, uint256 reserve, uint256 startTime, uint256 endTime, bool saleCompleted);
    event MerkleRootUpdated(bytes32 root);
    event SaleParametersUpdated(uint256 maxPurchaseLimit, uint256 supplyRemaining);
    event Purchased(address indexed buyer, uint256 purchaseAmount, bytes32 nullifier, bytes32 commitment, uint256 ethPaid);

    error TDSale_NotActive();
    error TDSale_InvalidProof();
    error TDSale_InvalidMerkle();
    error TDSale_InvalidCap();
    error TDSale_InvalidSupplyBinding();
    error TDSale_InvalidAuctionBinding();
    error TDSale_NullifierReplay();
    error TDSale_InsufficientEth();
    error TDSale_ZeroAmount();
    error TDSale_EthRefundFailed();
    error TDSale_EthForwardFailed();
    error TDSale_InvalidEthRecipient();
    error TDSale_InvalidPriceSchedule();

    constructor(
        address initialOwner,
        IVerifierFactory verifierFactory,
        IMintableSaleToken saleToken,
        address payable ethRecipient
    ) Ownable(initialOwner) {
        if (ethRecipient == payable(address(0))) revert TDSale_InvalidEthRecipient();
        VERIFIER_FACTORY = verifierFactory;
        SALE_TOKEN = saleToken;
        ETH_RECIPIENT = ethRecipient;
    }

    /// @notice Updates Dutch window used with `AuctionPriceLib.linearDutchPrice` (must have `startPrice > reserve`).
    function setSaleWindow(uint256 startPrice_, uint256 reserve_, uint256 startTime_, uint256 endTime_, bool completed_)
        external
        onlyOwner
    {
        if (startPrice_ <= reserve_) revert TDSale_InvalidPriceSchedule();
        startPrice = startPrice_;
        reservePrice = reserve_;
        startTime = startTime_;
        endTime = endTime_;
        saleCompleted = completed_;
        emit SaleWindowUpdated(startPrice_, reserve_, startTime_, endTime_, completed_);
    }

    function setMerkleRoot(bytes32 root) external onlyOwner {
        merkleRoot = root;
        emit MerkleRootUpdated(root);
    }

    function setSaleParameters(uint256 maxPurLimit, uint256 supplyRem) external onlyOwner {
        maxPurchaseLimitGlobal = maxPurLimit;
        supplyRemaining = supplyRem;
        emit SaleParametersUpdated(maxPurLimit, supplyRem);
    }

    /// @notice Spot price (wei per 1e18 sale tokens) at `block.timestamp`.
    function spotAuctionPrice() public view returns (uint256) {
        return AuctionPriceLib.linearDutchPrice(startPrice, reservePrice, startTime, endTime, block.timestamp, saleCompleted);
    }

    /// @notice ETH (wei) required to buy `tokenAmount` at `auctionPrice` (ceil).
    function ethForPurchaseAmount(uint256 tokenAmount, uint256 auctionPrice) public pure returns (uint256) {
        return Math.mulDiv(tokenAmount, auctionPrice, AuctionPriceLib.WAD, Math.Rounding.Ceil);
    }

    /**
     * @param zkProof Packed Groth16 proof `[Ax, Ay, Bx0, Bx1, By0, By1, Cx, Cy]` for `IVerifier.verifyProof`.
     * @param publicInputs Eight field elements matching `tokendistribution.circom` public order.
     */
    function purchase(uint256[8] calldata zkProof, uint256[] calldata publicInputs) external payable nonReentrant {
        if (merkleRoot == bytes32(0)) revert TDSale_NotActive();

        // `decode` enforces public input length (matches Circom public signal count).
        TokenDistributionVerifierLib.PublicSignals memory s = TokenDistributionVerifierLib.decode(publicInputs);
        TokenDistributionVerifierLib.requireValidProofFlag(s);

        if (s.merkleRoot != merkleRoot) revert TDSale_InvalidMerkle();
        if (s.maxPurchaseLimit != maxPurchaseLimitGlobal) revert TDSale_InvalidCap();
        if (s.totalSupplyRemaining != supplyRemaining) revert TDSale_InvalidSupplyBinding();
        if (s.auctionPrice != spotAuctionPrice()) revert TDSale_InvalidAuctionBinding();
        if (s.purchaseAmount == 0) revert TDSale_ZeroAmount();
        if (nullifierSpent[s.nullifier]) revert TDSale_NullifierReplay();

        uint256 cost = ethForPurchaseAmount(s.purchaseAmount, s.auctionPrice);
        if (msg.value < cost) revert TDSale_InsufficientEth();

        if (!VERIFIER_FACTORY.verifyProof("tokendistribution", zkProof, publicInputs)) revert TDSale_InvalidProof();

        nullifierSpent[s.nullifier] = true;
        supplyRemaining -= s.purchaseAmount;
        SALE_TOKEN.mint(msg.sender, s.purchaseAmount);

        (bool paid,) = ETH_RECIPIENT.call{value: cost}("");
        if (!paid) revert TDSale_EthForwardFailed();

        uint256 refund = msg.value - cost;
        if (refund != 0) {
            (bool ok,) = payable(msg.sender).call{value: refund}("");
            if (!ok) revert TDSale_EthRefundFailed();
        }

        emit Purchased(msg.sender, s.purchaseAmount, s.nullifier, s.commitment, cost);
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {EcosystemZkBase} from "./libraries/EcosystemZkBase.sol";

/**
 * @title PrivatePredictionMarket
 * @notice Shielded outcome shares: trade on future events without exposing wallet graph.
 */
contract PrivatePredictionMarket is EcosystemZkBase {
    string private constant PREDICTION_CIRCUIT = "prediction-market";

    struct Market {
        bytes32 questionHash;
        uint256 resolveAfter;
        bool resolved;
        uint8 winningOutcome;
    }

    uint256 public nextMarketId;
    mapping(uint256 => Market) public markets;
    mapping(bytes32 => bool) public spentNullifiers;

    event MarketCreated(uint256 indexed marketId, bytes32 questionHash, uint256 resolveAfter);
    event PositionOpened(uint256 indexed marketId, bytes32 indexed commitment, uint8 outcome);
    event MarketResolved(uint256 indexed marketId, uint8 winningOutcome);
    event PositionSettled(uint256 indexed marketId, bytes32 indexed nullifierHash);

    error MarketNotResolved();
    error MarketNotEnded();
    error AlreadyResolved();

    constructor(address token_, address verifierFactory_) EcosystemZkBase(token_, verifierFactory_) {}

    function createMarket(bytes32 questionHash, uint256 resolveAfter) external onlyGovernance returns (uint256 marketId) {
        marketId = nextMarketId++;
        markets[marketId] = Market({questionHash: questionHash, resolveAfter: resolveAfter, resolved: false, winningOutcome: 0});
        emit MarketCreated(marketId, questionHash, resolveAfter);
    }

    function resolveMarket(uint256 marketId, uint8 winningOutcome) external onlyGovernance {
        Market storage m = markets[marketId];
        if (m.resolved) revert AlreadyResolved();
        if (block.timestamp < m.resolveAfter) revert MarketNotEnded();
        m.resolved = true;
        m.winningOutcome = winningOutcome;
        emit MarketResolved(marketId, winningOutcome);
    }

    /**
     * @param publicInputs [marketId, outcome, nullifierHash, commitmentHash]
     */
    function openPosition(
        uint256[8] calldata proof,
        uint256[] calldata publicInputs
    ) external whenNotPaused {
        if (publicInputs.length < 4) revert InvalidPublicInputs();
        _requireValidProof(PREDICTION_CIRCUIT, proof, publicInputs);
        emit PositionOpened(publicInputs[0], bytes32(publicInputs[3]), uint8(publicInputs[1]));
    }

    function settlePosition(
        uint256[8] calldata proof,
        uint256[] calldata publicInputs
    ) external whenNotPaused {
        if (publicInputs.length < 3) revert InvalidPublicInputs();
        uint256 marketId = publicInputs[0];
        if (!markets[marketId].resolved) revert MarketNotResolved();
        bytes32 nullifier = bytes32(publicInputs[1]);
        if (spentNullifiers[nullifier]) revert NullifierAlreadyUsed();
        _requireValidProof(PREDICTION_CIRCUIT, proof, publicInputs);
        spentNullifiers[nullifier] = true;
        emit PositionSettled(marketId, nullifier);
    }
}

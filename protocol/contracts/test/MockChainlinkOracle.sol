// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {AggregatorV3Interface} from "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

/**
 * @title MockChainlinkOracle
 * @notice Mock Chainlink oracle for testing price validation contracts
 * @dev Implements AggregatorV3Interface with settable price for testing
 */
contract MockChainlinkOracle is AggregatorV3Interface {
    uint8 public override decimals = 8;
    string public override description = "Mock Chainlink Oracle";
    uint256 public override version = 1;

    int256 private _latestAnswer;
    uint256 private _updatedAt;
    uint80 private _roundId;
    uint256 private _startedAt;

    event AnswerUpdated(int256 indexed current, uint256 indexed roundId, uint256 updatedAt);

    constructor(int256 initialPrice) {
        _latestAnswer = initialPrice;
        _updatedAt = block.timestamp;
        _roundId = 1;
        _startedAt = block.timestamp;
    }

    function updateAnswer(int256 newAnswer) external {
        _latestAnswer = newAnswer;
        _updatedAt = block.timestamp;
        _roundId++;
        _startedAt = block.timestamp;
        emit AnswerUpdated(_latestAnswer, _roundId, _updatedAt);
    }

    function updateAnswerWithDelay(int256 newAnswer, uint256 delay) external {
        _latestAnswer = newAnswer;
        _updatedAt = block.timestamp - delay;
        _roundId++;
        _startedAt = block.timestamp - delay;
        emit AnswerUpdated(_latestAnswer, _roundId, _updatedAt);
    }

    /// @notice Set price and arbitrary `updatedAt` (used to simulate stale or future oracle timestamps).
    function setAnswerWithUpdatedAt(int256 newAnswer, uint256 updatedAt) external {
        _latestAnswer = newAnswer;
        _updatedAt = updatedAt;
        _roundId++;
        _startedAt = updatedAt;
        emit AnswerUpdated(_latestAnswer, _roundId, _updatedAt);
    }

    function latestRoundData()
        external
        view
        override
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
    {
        return (_roundId, _latestAnswer, _startedAt, _updatedAt, _roundId);
    }

    function getRoundData(uint80 /* _roundId */)
        external
        pure
        override
        returns (uint80 /* roundId */, int256 /* answer */, uint256 /* startedAt */, uint256 /* updatedAt */, uint80 /* answeredInRound */)
    {
        revert("Not implemented");
    }

    function latestRound() external view returns (uint256) {
        return uint256(_roundId);
    }
}


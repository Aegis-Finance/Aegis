// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "../oracles/interfaces/IOracleAdapter.sol";

/**
 * @title MockOracleAggregator
 * @notice Mock oracle aggregator for testing
 */
contract MockOracleAggregator {
    mapping(bytes32 => uint256) public prices;
    mapping(bytes32 => bool) public isValid;
    mapping(bytes32 => uint256) public timestamps;
    
    function setPrice(bytes32 assetId, uint256 price, bool _isValid) external {
        prices[assetId] = price;
        isValid[assetId] = _isValid;
        timestamps[assetId] = block.timestamp;
    }
    
    function getPrice(bytes32 assetId) external view returns (
        uint256 medianPrice,
        uint256 timestamp,
        uint256 validOracles,
        bool _isValid
    ) {
        return (prices[assetId], timestamps[assetId], 1, isValid[assetId]);
    }
    
    function updatePrice(bytes32 assetId) external view returns (
        uint256 medianPrice,
        uint256 timestamp,
        uint256 validOracles,
        bool _isValid
    ) {
        return (prices[assetId], timestamps[assetId], 1, isValid[assetId]);
    }
}

/**
 * @title MockChainlinkAdapter
 * @notice Mock Chainlink adapter for testing
 */
contract MockChainlinkAdapter is IOracleAdapter {
    uint256 public price;
    uint256 public timestamp;
    bool public _isValid = true;
    string public _description = "Mock Chainlink Adapter";
    uint8 public _decimals = 8;
    
    function setPrice(uint256 _price, bool _valid) external {
        price = _price;
        timestamp = block.timestamp;
        _isValid = _valid;
    }
    
    function setPriceWithTimestamp(uint256 _price, uint256 _timestamp, bool _valid) external {
        price = _price;
        timestamp = _timestamp;
        _isValid = _valid;
    }
    
    function getLatestPrice() external view returns (
        uint256,
        uint256,
        uint256,
        bool
    ) {
        return (price, timestamp, 1, _isValid);
    }
    
    function description() external view returns (string memory) {
        return _description;
    }
    
    function decimals() external view returns (uint8) {
        return _decimals;
    }
    
    function isAvailable() external view returns (bool) {
        return _isValid;
    }
}

/**
 * @title MockPythAdapter
 * @notice Mock Pyth adapter for testing
 */
contract MockPythAdapter is IOracleAdapter {
    uint256 public price;
    uint256 public timestamp;
    bool public _isValid = true;
    string public _description = "Mock Pyth Adapter";
    uint8 public _decimals = 18;
    
    function setPrice(uint256 _price, bool _valid) external {
        price = _price;
        timestamp = block.timestamp;
        _isValid = _valid;
    }
    
    function setPriceWithTimestamp(uint256 _price, uint256 _timestamp, bool _valid) external {
        price = _price;
        timestamp = _timestamp;
        _isValid = _valid;
    }
    
    function getLatestPrice() external view returns (
        uint256,
        uint256,
        uint256,
        bool
    ) {
        return (price, timestamp, 1, _isValid);
    }
    
    function description() external view returns (string memory) {
        return _description;
    }
    
    function decimals() external view returns (uint8) {
        return _decimals;
    }
    
    function isAvailable() external view returns (bool) {
        return _isValid;
    }
}


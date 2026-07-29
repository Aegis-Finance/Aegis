// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "../tokendistribution/AutomatedDutchAuction.sol";

/**
 * @title AutomatedDutchAuctionHarness
 * @notice Harness for Certora formal verification
 * @dev Exposes state getters for CVL2 compatibility
 * @author Sentinel Security Team
 */
contract AutomatedDutchAuctionHarness is AutomatedDutchAuction {
    /**
     * @notice Constructor for harness contract
     */
    constructor(
        address _agsToken,
        address _verifierFactory,
        address _liquidityDeployer,
        address _ecosystemProceedsSink,
        uint256 _startPrice,
        uint256 _reservePrice,
        uint256 _totalTokens,
        uint256 _maxPerAddress,
        uint256 _minPurchase,
        uint256 _duration,
        address _payWs,
        address _payWeth,
        address _payUsdc,
        address _payUsdt,
        address _payEurc,
        address _swapRouter02
    )
        AutomatedDutchAuction(
            _agsToken,
            _verifierFactory,
            _liquidityDeployer,
            _ecosystemProceedsSink,
            _startPrice,
            _reservePrice,
            _totalTokens,
            _maxPerAddress,
            _minPurchase,
            _duration,
            _payWs,
            _payWeth,
            _payUsdc,
            _payUsdt,
            _payEurc,
            _swapRouter02
        )
    {}

    /**
     * @notice Get current price (wrapper for Certora)
     */
    function getCurrentPriceHarness() external view returns (uint256) {
        return getCurrentPrice();
    }

    /**
     * @notice Get tokens sold
     */
    function getTokensSold() external view returns (uint256) {
        return tokensSold;
    }

    /**
     * @notice Get total ETH collected
     */
    function getTotalEthCollected() external view returns (uint256) {
        return totalEthCollected;
    }

    /**
     * @notice Get sale completed status
     */
    function getSaleCompleted() external view returns (bool) {
        return saleCompleted;
    }

    /**
     * @notice Get sale completion time
     */
    function getSaleCompletionTime() external view returns (uint256) {
        return saleCompletionTime;
    }

    /**
     * @notice Get isActive status
     */
    function getIsActive() external view returns (bool) {
        return isActive;
    }

    /**
     * @notice Get liquidity funds sent status
     */
    function getLiquidityFundsSent() external view returns (bool) {
        return liquidityFundsSent;
    }

    /**
     * @notice Get purchase amount for address
     */
    function getPurchaseAmount(address user) external view returns (uint256) {
        return purchaseAmounts[user];
    }

    /**
     * @notice Get last purchase time for address
     */
    function getLastPurchaseTime(address user) external view returns (uint256) {
        return lastPurchaseTime[user];
    }

    /**
     * @notice Get used nullifier status
     */
    function getUsedNullifier(bytes32 nullifier) external view returns (bool) {
        return usedNullifiers[nullifier];
    }

    /**
     * @notice Get address commitment
     */
    function getAddressCommitment(address user) external view returns (bytes32) {
        return addressCommitments[user];
    }

    /**
     * @notice Get remaining tokens
     */
    function getRemainingTokensHarness() external view returns (uint256) {
        return getRemainingTokens();
    }

    /**
     * @notice Get mean price
     */
    function getMeanPriceHarness() external view returns (uint256) {
        return getMeanPrice();
    }
}


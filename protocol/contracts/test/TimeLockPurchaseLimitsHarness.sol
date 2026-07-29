// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "../tokendistribution/TimeLockPurchaseLimits.sol";

/**
 * @title TimeLockPurchaseLimitsHarness
 * @notice Harness for Certora formal verification
 * @dev Exposes state getters for CVL2 compatibility
 * @author Sentinel Security Team
 */
contract TimeLockPurchaseLimitsHarness is TimeLockPurchaseLimits {
    /**
     * @notice Constructor for harness contract
     */
    constructor(
        address _verifierFactory,
        uint256 _maxPurchasePerAddress,
        uint256 _maxPurchasePerPeriod,
        uint256 _limitResetPeriod,
        uint256 _saleStartTime,
        uint256 _emergencyUnlockTime
    ) TimeLockPurchaseLimits(
        _verifierFactory,
        _maxPurchasePerAddress,
        _maxPurchasePerPeriod,
        _limitResetPeriod,
        _saleStartTime,
        _emergencyUnlockTime
    ) {}

    /**
     * @notice Get total purchased for address
     */
    function getTotalPurchased(address buyer) external view returns (uint256) {
        return totalPurchased[buyer];
    }

    /**
     * @notice Get period purchased for address
     */
    function getPeriodPurchased(address buyer) external view returns (uint256) {
        return periodPurchased[buyer];
    }

    /**
     * @notice Get last purchase time for address
     */
    function getLastPurchaseTime(address buyer) external view returns (uint256) {
        return lastPurchaseTime[buyer];
    }

    /**
     * @notice Get current period start for address
     */
    function getCurrentPeriodStart(address buyer) external view returns (uint256) {
        return currentPeriodStart[buyer];
    }

    /**
     * @notice Get used identity nullifier status
     */
    function getUsedIdentityNullifier(uint256 nullifier) external view returns (bool) {
        return usedIdentityNullifiers[nullifier];
    }

    /**
     * @notice Get identity commitment for address
     */
    function getIdentityCommitment(address buyer) external view returns (uint256) {
        return identityCommitments[buyer];
    }

    /**
     * @notice Get identity purchase count
     */
    function getIdentityPurchaseCount(uint256 commitment) external view returns (uint256) {
        return identityPurchaseCounts[commitment];
    }

    /**
     * @notice Get limits active status
     */
    function getLimitsActive() external view returns (bool) {
        return limitsActive;
    }

    /**
     * @notice Get limits expired status
     */
    function getLimitsExpired() external view returns (bool) {
        return limitsExpired;
    }

    /**
     * @notice Get expiration time
     */
    function getExpirationTime() external view returns (uint256) {
        return expirationTime;
    }

    /**
     * @notice Get remaining allowance for address
     */
    function getRemainingAllowanceHarness(address buyer) external view returns (
        uint256 totalRemaining,
        uint256 periodRemaining,
        uint256 timeUntilReset
    ) {
        return this.getRemainingAllowance(buyer);
    }
}


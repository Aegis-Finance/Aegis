// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "../PrivateAMMContract.sol";

/**
 * @title PrivateAMMContractHarness
 * @notice Harness for Certora formal verification
 * @dev Exposes struct fields as individual functions for CVL2 compatibility
 * @author Sentinel Security Team
 */
contract PrivateAMMContractHarness is PrivateAMMContract {
    /**
     * @notice Constructor for harness contract
     * @param _aegisToken Address of the Aegis token contract
     * @param _verifierFactory Address of the VerifierFactory contract
     */
    constructor(
        address _aegisToken,
        address _verifierFactory
    ) PrivateAMMContract(_aegisToken, _verifierFactory) {}

    /**
     * @notice Get pool reserve A
     * @param poolId The pool identifier
     * @return The reserve A value
     */
    function getPoolReserveA(bytes32 poolId) external view returns (uint256) {
        return pools[poolId].reserveA;
    }

    /**
     * @notice Get pool reserve B
     * @param poolId The pool identifier
     * @return The reserve B value
     */
    function getPoolReserveB(bytes32 poolId) external view returns (uint256) {
        return pools[poolId].reserveB;
    }

    /**
     * @notice Get pool total liquidity
     * @param poolId The pool identifier
     * @return The total liquidity value
     */
    function getPoolTotalLiquidity(bytes32 poolId) external view returns (uint256) {
        return pools[poolId].totalLiquidity;
    }

    /**
     * @notice Get pool kLast
     * @param poolId The pool identifier
     * @return The kLast value
     */
    function getPoolKLast(bytes32 poolId) external view returns (uint256) {
        return pools[poolId].kLast;
    }

    /**
     * @notice Get pool tokenB
     * @param poolId The pool identifier
     * @return The tokenB address
     */
    function getPoolTokenB(bytes32 poolId) external view returns (address) {
        return pools[poolId].tokenB;
    }

    /**
     * @notice Get pool initialized status
     * @param poolId The pool identifier
     * @return Whether the pool is initialized
     */
    function getPoolInitialized(bytes32 poolId) external view returns (bool) {
        return pools[poolId].initialized;
    }

    /**
     * @notice Get flash loan data previous reserve A
     * @param poolId The pool identifier
     * @return The previous reserve A
     */
    function getFlashLoanPreviousReserveA(bytes32 poolId) external view returns (uint256) {
        return flashLoanData[poolId].previousReserveA;
    }

    /**
     * @notice Get flash loan data previous reserve B
     * @param poolId The pool identifier
     * @return The previous reserve B
     */
    function getFlashLoanPreviousReserveB(bytes32 poolId) external view returns (uint256) {
        return flashLoanData[poolId].previousReserveB;
    }

    /**
     * @notice Get flash loan data last block checked
     * @param poolId The pool identifier
     * @return The last block checked
     */
    function getFlashLoanLastBlockChecked(bytes32 poolId) external view returns (uint32) {
        return flashLoanData[poolId].lastBlockChecked;
    }
}


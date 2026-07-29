// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/**
 * @title IPublicLiquidityPool
 * @notice Interface for PublicLiquidityPool contract
 * @dev Interface for pool operations required by price validator and TreasuryLiquidityAllocator
 */
interface IPublicLiquidityPool {
    /**
     * @notice Get current reserves of the pool
     * @return reserveAGS Amount of AGS tokens in pool
     * @return reserveQuote Amount of quote tokens in pool
     */
    function getReserves() external view returns (uint256 reserveAGS, uint256 reserveQuote);

    /**
     * @notice Check if quote token is native
     * @return true if quote token is native SONIC
     */
    function quoteIsNative() external view returns (bool);

    /**
     * @notice Get quote token address
     * @return address of the quote token
     */
    function quoteToken() external view returns (address);

    /**
     * @notice Add liquidity to the pool
     * @param agsAmount Amount of AGS tokens
     * @param quoteAmount Amount of quote tokens
     * @param minShares Minimum LP shares expected
     * @param recipient Address receiving LP shares
     * @return sharesMinted LP shares minted
     * @return agsUsed AGS tokens actually used
     * @return quoteUsed Quote tokens actually used
     */
    function addLiquidity(
        uint256 agsAmount,
        uint256 quoteAmount,
        uint256 minShares,
        address recipient
    ) external payable returns (uint256 sharesMinted, uint256 agsUsed, uint256 quoteUsed);
}


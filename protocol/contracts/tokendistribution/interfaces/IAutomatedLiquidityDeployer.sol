// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/**
 * @title IAutomatedLiquidityDeployer
 * @notice Callback surface used by `AutomatedDutchAuction` for permissionless post-sale seeding.
 */
interface IAutomatedLiquidityDeployer {
    function liquiditySeeded() external view returns (bool);

    /**
     * @notice Receives AGS + native quote from the trusted auction, wraps native, and mints the canonical v3 position.
     * @param meanPriceWad Auction mean price (wei quote per 1e18 AGS wei).
     * @param agsAmount AGS wei the auction already transferred to this contract in the same transaction.
     */
    function seedFromAuction(uint256 meanPriceWad, uint256 agsAmount) external payable;
}

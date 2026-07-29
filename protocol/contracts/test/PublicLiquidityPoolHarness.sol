// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "../liquidity/PublicLiquidityPool.sol";

/**
 * @title PublicLiquidityPoolHarness
 * @notice Harness for Certora formal verification
 * @dev Exposes additional functions for verification
 * @author Sentinel Security Team
 */
contract PublicLiquidityPoolHarness is PublicLiquidityPool {
    /**
     * @notice Constructor for harness contract
     * @param _agsToken Address of the AGS token
     * @param _quoteToken Address of the quote token
     * @param _quoteIsNative Whether quote token is native
     * @param _name LP token name
     * @param _symbol LP token symbol
     * @param _feeBps Trading fee in basis points
     */
    constructor(
        address _agsToken,
        address _quoteToken,
        bool _quoteIsNative,
        string memory _name,
        string memory _symbol,
        uint256 _feeBps
    ) PublicLiquidityPool(_agsToken, _quoteToken, _quoteIsNative, _name, _symbol, _feeBps) {}

    // Additional helper functions if needed for verification
}


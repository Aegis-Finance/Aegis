// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/**
 * @title IAegisLiquidityConnectorV1
 * @notice Optional **v1** discovery surface for liquidity partners (see `docs/ADR-001-liquidity-connector-v1.md`).
 * @dev Implementations are **not** required on existing core pools; wrappers may adopt this for indexers.
 *      Canonical discriminator: `bytes4(keccak256(bytes("IAegisLiquidityConnectorV1"))) == 0x68f70203`.
 */
interface IAegisLiquidityConnectorV1 {
    /// @notice Must return `0x68f70203` (see ADR-001).
    function AEGIS_CONNECTOR_INTERFACE_ID() external pure returns (bytes4);

    /**
     * @return stakeOrRouter Main LP staking target (e.g. gauge) **or** swap router for this connector context.
     * @return quoteToken Quote asset paired with protocol token (wrapped native where applicable).
     */
    function primarySurface() external view returns (address stakeOrRouter, address quoteToken);

    /// @notice Emitted when a deployment advertises itself for discovery (optional).
    event LiquidityConnectorAnnounced(address indexed emitter, address stakeOrRouter, address quoteToken);

    error ZeroAddress();
}

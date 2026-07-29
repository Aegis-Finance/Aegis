// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/**
 * @title MockGovernanceCallTarget
 * @author Sentinel
 * @notice Deterministic execution target used to validate governance execution flows.
 */
contract MockGovernanceCallTarget {
    /**
     * @notice Accumulated counter updated via governance-controlled calls.
     */
    uint256 public counter;

    /**
     * @notice Flag signalling whether the next call should revert.
     */
    bool public shouldRevert;

    /**
     * @notice Emitted when the counter is incremented successfully.
     * @param newCounter The counter value after increment.
     * @param amount The amount added during the increment.
     */
    event Incremented(uint256 indexed newCounter, uint256 indexed amount);

    /**
     * @notice Emitted when the revert behaviour is toggled.
     * @param enabled Whether reverts are enabled.
     */
    event RevertToggle(bool indexed enabled);

    error MockTargetRevert();

    /**
     * @notice Increment the counter by a specified amount, reverting if reverts are enabled.
     * @param amount The value to add to the counter.
     * @return newCounter The updated counter value.
     */
    function increment(uint256 amount) external returns (uint256 newCounter) {
        if (shouldRevert) {
            revert MockTargetRevert();
        }
        counter += amount;
        emit Incremented(counter, amount);
        return counter;
    }

    /**
     * @notice Toggle whether the contract should revert on the next increment.
     * @param enabled Set true to force reverts, false to allow increments.
     */
    function setShouldRevert(bool enabled) external {
        shouldRevert = enabled;
        emit RevertToggle(enabled);
    }
}


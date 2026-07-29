// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/**
 * @title BridgeGovernanceExecutor
 * @notice Minimal governance execution contract used in tests to simulate DAO-controlled calls.
 *         Acts as the governance address for CrossChainPrivacyBridge by forwarding arbitrary calls.
 */
contract BridgeGovernanceExecutor {
    address public immutable target;

    constructor(address target_) {
        require(target_ != address(0), "governance executor: invalid target");
        target = target_;
    }

    /**
     * @notice Forwards a call to the configured target contract.
     * @param data Encoded function call for the target.
     * @return result Raw returndata from the target call.
     */
    function execute(bytes calldata data) external payable returns (bytes memory result) {
        (bool success, bytes memory returndata) = target.call{value: msg.value}(data);
        if (!success) {
            _revertWithReason(returndata);
        }
        return returndata;
    }

    function _revertWithReason(bytes memory returndata) private pure {
        if (returndata.length == 0) {
            revert("governance executor: call failed");
        }
        assembly {
            let returndata_size := mload(returndata)
            revert(add(32, returndata), returndata_size)
        }
    }
}


// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/**
 * @title GovernanceAccessLib
 * @author Aegis Protocol Team
 * @notice Shared view helper for governance-gated admin: `PrivateGovernance` facade,
 *         `GovernanceCore` (via `GOVERNANCE_CORE()` on the facade), and optional
 *         `AegisTimelockController` may invoke functions after `TimelockController.execute`.
 */
library GovernanceAccessLib {
    /**
     * @param governanceFacade Address of `PrivateGovernance` (or compatible) implementing `GOVERNANCE_CORE()`.
     * @param timelockController Optional timelock; ignored if `address(0)`.
     * @param caller Typically `msg.sender`.
     */
    function isGovernanceTimelockOrCore(
        address governanceFacade,
        address timelockController,
        address caller
    ) internal view returns (bool) {
        if (governanceFacade == address(0)) return false;
        if (caller == governanceFacade) return true;
        if (timelockController != address(0) && caller == timelockController) return true;
        (bool ok, bytes memory data) = governanceFacade.staticcall(abi.encodeWithSignature("GOVERNANCE_CORE()"));
        if (ok && data.length == 32) {
            address coreAddr = abi.decode(data, (address));
            if (caller == coreAddr) return true;
        }
        return false;
    }
}

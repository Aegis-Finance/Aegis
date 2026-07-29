// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {AegisCrowdShield} from "../crowdfunding/AegisCrowdShield.sol";

/// @notice Minimal governance contract address used as `governanceContract` in tests (`pause` sees `msg.sender == this`).
contract CrowdTestGovernance {
    function pauseCrowd(AegisCrowdShield s) external {
        s.pause();
    }

    function unpauseCrowd(AegisCrowdShield s) external {
        s.unpause();
    }
}

/// @notice Stub verifier factory so `AegisCrowdShield` can deploy without full `VerifierFactory`.
contract CrowdTestVerifierFactory {
    function getVerifier(string calldata) external pure returns (address) {
        return address(0);
    }

    function verifyProof(
        string calldata,
        uint256[8] calldata,
        uint256[] calldata
    ) external pure returns (bool) {
        return true;
    }
}

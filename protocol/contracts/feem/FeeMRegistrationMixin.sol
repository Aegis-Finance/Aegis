// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

abstract contract FeeMRegistrationMixin is ReentrancyGuard {
    event FeeMRegistered(uint256 projectId, address registry);

    bool public feeMRegistered;

    function registerMe(uint256 projectId) external nonReentrant {
        require(!feeMRegistered, "already registered");
        address registry = _feeMRegistryAddress();
        require(registry != address(0), "registry=0");
        (bool ok, ) = _callFeeMRegistry(abi.encodeWithSignature("selfRegister(uint256)", projectId));
        require(ok, "registry call failed");
        feeMRegistered = true;
        emit FeeMRegistered(projectId, registry);
    }

    function _feeMRegistryAddress() internal view virtual returns (address);
    function _callFeeMRegistry(bytes memory data) internal virtual returns (bool, bytes memory);
}
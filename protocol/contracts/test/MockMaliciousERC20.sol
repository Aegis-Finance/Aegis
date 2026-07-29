// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title MockMaliciousERC20
 * @notice Malicious ERC20 token for testing security vulnerabilities
 * @dev Implements various attack patterns: reentrancy, approval exploits, flash loans
 */
contract MockMaliciousERC20 is ERC20 {
    address public targetPool;
    bool public shouldReenter;
    bool public shouldCallPoolOnTransfer;
    uint256 public reenterAmount;
    
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}
    
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
    
    /**
     * @notice Enable reentrancy attack mode
     */
    function setReentrancyMode(address _targetPool, bool _shouldReenter, uint256 _amount) external {
        targetPool = _targetPool;
        shouldReenter = _shouldReenter;
        reenterAmount = _amount;
        shouldCallPoolOnTransfer = _shouldReenter;
    }
    
    /**
     * @notice Override transfer to enable reentrancy attack
     */
    function transfer(address to, uint256 amount) public override returns (bool) {
        bool result = super.transfer(to, amount);
        if (shouldReenter && targetPool != address(0) && to == targetPool) {
            // Try to call pool function during transfer (reentrancy attempt)
            (bool success, ) = targetPool.call(abi.encodeWithSignature("swapExactInput(bool,uint256,uint256,address)", true, reenterAmount, 0, msg.sender));
            success; // Silence compiler warning
        }
        return result;
    }
    
    /**
     * @notice Override transferFrom to enable reentrancy attack
     */
    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        bool result = super.transferFrom(from, to, amount);
        if (shouldReenter && targetPool != address(0) && to == targetPool) {
            // Try to call pool function during transfer (reentrancy attempt)
            // Try addLiquidity first (for addLiquidity tests), then fallback to swapExactInput
            (bool success1, ) = targetPool.call(abi.encodeWithSignature("addLiquidity(uint256,uint256,uint256,address)", reenterAmount, reenterAmount, 0, msg.sender));
            if (!success1) {
                // Fallback to swapExactInput for swap tests
                (bool success2, bytes memory returnData2) = targetPool.call(abi.encodeWithSignature("swapExactInput(bool,uint256,uint256,address)", true, reenterAmount, 0, msg.sender));
                if (!success2) {
                    // If both fail, revert with the error data to propagate reentrancy protection
                    if (returnData2.length > 0) {
                        assembly {
                            let returndata_size := mload(returnData2)
                            revert(add(32, returnData2), returndata_size)
                        }
                    }
                }
            } else {
                // If addLiquidity succeeds, that's unexpected - reentrancy should have been blocked
                // But we'll let it through for testing edge cases
            }
        }
        return result;
    }
    
    /**
     * @notice Flash loan simulation - mint tokens temporarily
     */
    function flashMint(address to, uint256 amount) external {
        _mint(to, amount);
    }
    
    /**
     * @notice Flash loan burn - remove tokens after use
     */
    function flashBurn(address from, uint256 amount) external {
        _burn(from, amount);
    }
}


// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IUniswapV3Factory} from "../dex/interfaces/IUniswapV3Factory.sol";
import {IUniswapV3Pool} from "../dex/interfaces/IUniswapV3Pool.sol";

contract MockUniswapV3Factory is IUniswapV3Factory {
    mapping(bytes32 => address) public pools;

    function poolKey(address a, address b, uint24 fee) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(a, b, fee));
    }

    function setPool(address a, address b, uint24 fee, address pool) external {
        pools[poolKey(a, b, fee)] = pool;
        pools[poolKey(b, a, fee)] = pool;
    }

    function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool) {
        return pools[poolKey(tokenA, tokenB, fee)];
    }
}

contract MockUniswapV3Pool is IUniswapV3Pool {
    address public token0_;
    address public token1_;
    uint160 public sqrtPriceX96_;

    constructor(address t0, address t1) {
        token0_ = t0;
        token1_ = t1;
    }

    function setSlot0(uint160 sqrtPriceX96) external {
        sqrtPriceX96_ = sqrtPriceX96;
    }

    function token0() external view returns (address) {
        return token0_;
    }

    function token1() external view returns (address) {
        return token1_;
    }

    function slot0()
        external
        view
        returns (
            uint160 sqrtPriceX96,
            int24,
            uint16,
            uint16,
            uint16,
            uint8,
            bool
        )
    {
        return (sqrtPriceX96_, 0, 0, 0, 0, 0, true);
    }
}

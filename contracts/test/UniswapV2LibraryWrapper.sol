// SPDX-License-Identifier: MIT
pragma solidity >=0.5.0;

import "../uniswap/UniswapV2Library.sol";

contract UniswapV2LibraryWrapper {
    // Original function that uses the library's pairFor
    function pairFor(address factory, address tokenA, address tokenB) external pure returns (address) {
        return UniswapV2Library.pairFor(factory, tokenA, tokenB);
    }

    // Custom function that uses a hardcoded init code hash for this specific project
    function pairForWithCustomInitCodeHash(address factory, address tokenA, address tokenB) external pure returns (address pair) {
        (address token0, address token1) = UniswapV2Library.sortTokens(tokenA, tokenB);
        pair = address(uint(keccak256(abi.encodePacked(
                hex'ff',
                factory,
                keccak256(abi.encodePacked(token0, token1)),
                hex'f6bc787c18b1f3cca477db6995b73f27aeb7cdf3847d3ee0fac3fb5da6135130' // custom init code hash
            ))));
    }
}

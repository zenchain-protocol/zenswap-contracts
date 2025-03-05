// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import "@uniswap/v2-core/contracts/UniswapV2Factory.sol";
import "@uniswap/v2-periphery/contracts/UniswapV2Router02.sol";

contract UniswapV2Deployment {
    UniswapV2Factory public factory;
    UniswapV2Router02 public router;
    address public WETH;

    constructor(address _WETH) public {
        WETH = _WETH;
        factory = new UniswapV2Factory(msg.sender);
        router = new UniswapV2Router02(address(factory), _WETH);
    }
}

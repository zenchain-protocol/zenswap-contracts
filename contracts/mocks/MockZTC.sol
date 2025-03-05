// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import "./MockERC20.sol";

contract MockZTC is MockERC20 {
    constructor(
        string memory name,
        string memory symbol,
        uint8 decimals
    ) MockERC20(name, symbol, decimals) {}
}

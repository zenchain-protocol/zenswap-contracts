//SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import '@openzeppelin/contracts/token/ERC20/ERC20.sol';
import "@openzeppelin/contracts/access/Ownable.sol";

contract MockUSDC is ERC20, Ownable {
  constructor() ERC20('MockUSDC', 'USDC') Ownable(msg.sender) {}

  function mint(address to, uint256 amount) public onlyOwner {
    _mint(to, amount);
  }
}
// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";

contract MockToken is ERC20, ERC20Permit {
    uint8 internal immutable _decimals;

    constructor(
        string memory name,
        string memory symbol,
        uint8 __decimals
    ) ERC20(name, symbol) ERC20Permit(name) {
        _decimals = __decimals;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external {
        _burn(from, amount);
    }

    function nonces(
        address owner
    ) public view override(ERC20Permit) returns (uint256) {
        return ERC20Permit.nonces(owner);
    }

    function decimals() public view virtual override returns (uint8) {
        return _decimals;
    }
}
pragma solidity ^0.8.0;

import '@uniswap/v2-core/contracts/interfaces/IUniswapV2Pair.sol';

interface IZenVault is IUniswapV2Pair {

    // TODO: add events

    function stake(uint256 amount) external;

    function unstake(uint256 amount) external;

    function withdrawUnlocked() external;

    function recordEraStake(uint32 era) external;

    function doSlash(uint256 slash_amount, uint32 era) external;

    function setIsStakingEnabled(bool isEnabled) external;
}

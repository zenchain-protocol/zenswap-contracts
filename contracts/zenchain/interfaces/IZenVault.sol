pragma solidity ^0.8.0;

import '@uniswap/v2-core/contracts/interfaces/IUniswapV2Pair.sol';

interface IZenVault is IUniswapV2Pair {

    // TODO: add events

    function stake(uint256 _amount) external;

    function unstake(uint256 _amount) external;

    function withdrawUnlocked() external;

    function updateStakingLock(uint32 era) external;

    function unlockAllStake() external;

    function doSlash(uint256 slash_amount) external;

    function enableStaking() external;

    function disableStaking() external;
}

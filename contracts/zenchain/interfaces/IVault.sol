pragma solidity ^0.8.0;

interface IVault {

    // TODO: add events

    function updateStakingLock(uint32 era) external;

    function unlockAllStake(uint32 era) external;

    function doSlash(uint256 slash_amount) external;

    function totalStake() external returns (uint256);

    function totalStakeAtEra(uint32 era) external returns (uint256);
}

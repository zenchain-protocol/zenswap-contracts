pragma solidity ^0.8.0;
import "@uniswap/v2-core/contracts/UniswapV2Pair.sol";
import "./interfaces/IZenVault.sol";

contract ZenVault is IZenVault, UniswapV2Pair {

    function updateStakingLock(uint32 era) external {

    }

    function unlockAllStake(uint32 era) external {

    }

    function doSlash(uint256 slash_amount) external {

    }

    function totalStake() external returns (uint256) {
        return 0;
    }

    function totalStakeAtEra(uint32 era) external returns (uint256) {
        return 0;
    }
}
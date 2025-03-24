pragma solidity ^0.8.0;
import "@uniswap/v2-core/contracts/UniswapV2Pair.sol";
import "./interfaces/IZenVault.sol";

import "@uniswap/v2-core/contracts/libraries/SafeMath.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "/Users/kris/RustroverProjects/zenchain-protocol/zenchain-node/precompiles/vault-staking/IVaultStaking.sol";

contract ZenVault is IZenVault, UniswapV2Pair, ReentrancyGuard {
    using SafeMath for uint256;

    event Staked(address indexed user, uint256 amount);
    event Unstaked(address indexed user, uint256 amount);

    // A chunk of tokens that were staked but are now in the process of unlocking
    struct UnlockChunk {
        // The amount of token that will become unlocked
        uint256 value;
        // The era when the chunk will be unlocked
        uint32 era;
    }

    // Mapping of user addresses to their unlocking balances.
    mapping(address => UnlockChunk[]) public unlocking;

    // Mapping of user addresses to their staked amounts.
    mapping(address => uint256) public stakedBalances;

    // Mapping of era index to total stake;
    mapping(uint32 => uint256) public totalStakeAtEra;

    // The total amount staked
    uint256 public totalStake;

    /**
     * @dev Stake tokens.  Users transfer staking tokens to this contract, and their stake is recorded.
     * @param _amount The amount of tokens to stake.
     */
    function stake(uint256 _amount) external nonReentrant {
        require(_amount > 0, "Amount must be greater than zero.");
        // Transfer the staking tokens from the user to this contract.
        this.transferFrom(msg.sender, address(this), _amount);

        // Update the user's staked balance.
        stakedBalances[msg.sender] = stakedBalances[msg.sender].add(_amount);
        totalStake = totalStake.add(_amount);

        emit Staked(msg.sender, _amount);
    }

    /**
     * @dev Unstake tokens. Users can withdraw their staked tokens when they become fully unlocked.
     * @param _amount The amount of tokens to unstake.
     */
    function unstake(uint256 _amount) external nonReentrant {
        require(_amount > 0, "Amount must be greater than zero.");
        require(stakedBalances[msg.sender] >= _amount, "Insufficient staked balance.");

        // Update the user's staked balance.
        stakedBalances[msg.sender] = stakedBalances[msg.sender].sub(_amount);
        totalStake = totalStake.sub(_amount);

        // Transfer the staking tokens from stakedBalances to unlocking
        uint32 memory currentEra = VAULT_STAKING_CONTRACT.currentEra();
        uint32 memory bondingDuration = VAULT_STAKING_CONTRACT.bondingDuration();
        UnlockChunk memory chunk = UnlockChunk(_amount, currentEra + bondingDuration);
        unlocking[msg.sender] = unlocking[msg.sender].push(chunk);

        emit Unstaked(msg.sender, _amount);
    }

    // transfer caller's unlocked tokens to caller
    function withdrawUnlocked() external {
        uint32 memory currentEra = VAULT_STAKING_CONTRACT.currentEra();
        UnlockChunk[] storage chunks = unlocking[msg.sender];
        uint256 writeIndex = 0;
        uint256 totalToTransfer = 0;

        // Iterate over all chunks
        for (uint256 i = 0; i < chunks.length; i++) {
            UnlockChunk chunk = chunks[i];
            if (chunk.era <= currentEra) {
                // Chunk is unlocked: add its value to the total to transfer
                totalToTransfer += chunk.value;
            } else {
                // Chunk is still locked: keep it by moving it to writeIndex
                if (writeIndex != i) {
                    chunks[writeIndex] = chunk;
                }
                writeIndex++;
            }
        }

        // Resize the array to remove unlocked chunks
        chunks.length = writeIndex;

        // Transfer unlocked tokens to the caller, if any
        if (totalToTransfer > 0) {
            this.transfer(msg.sender, totalToTransfer);
        }
        // TODO: emit event
    }

    // Update the staking lock so that
    function updateStakingLock(uint32 era) external {
        // TODO
    }

    function enableStaking() external {
        // TODO
    }

    // disable staking, so that
    function disableStaking() external {
        // TODO
    }

    // unlock all stake and disable staking so that no new stake can be added
    function unlockAllStake() internal {
        // TODO
    }

    // apply slash amount to stake balance and also to unlocking balances that are within bonding_duration
    function doSlash(uint256 slash_amount) external {
        // TODO
    }
}
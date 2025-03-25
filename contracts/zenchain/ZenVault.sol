pragma solidity ^0.8.0;
import "@uniswap/v2-core/contracts/UniswapV2Pair.sol";
import "./interfaces/IZenVault.sol";

import "@uniswap/v2-core/contracts/libraries/SafeMath.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "/Users/kris/RustroverProjects/zenchain-protocol/zenchain-node/precompiles/vault-staking/IVaultStaking.sol";

// TODO: handle reward distribution

contract ZenVault is IZenVault, UniswapV2Pair, ReentrancyGuard {
    using SafeMath for uint256;

    event StakingEnabled(uint32 era);
    event Staked(address indexed user, uint256 amount);
    event Unstaked(address indexed user, uint256 amount);
    event Withdrawal(address indexed user, uint256 amount);
    event EraExposureRecorded(uint32 indexed era, uint256 totalStake);
    event VaultSlashed(uint32 indexed era, uint256 slash_amount);
    event UserSlashed(address indexed user, uint32 indexed era, uint256 slash_amount);

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

    // A list of stakers; roughly corresponds to keys of stakedBalances, but can be outdated.
    address[] private stakers;

    // A user's staking exposure for the era
    struct EraExposure {
        // User address
        address staker;
        // The amount of token the user staked in the era
        uint256 value;
    }

    // Mapping of era index to total stake;
    mapping(uint32 => uint256) public totalStakeAtEra;

    // Mapping of era index to list of staker exposures;
    mapping(uint32 => EraExposure[]) public eraExposures;

    // The total amount staked
    uint256 public totalStake;

    // The last era in which this vault was updated
    uint32 public lastEraUpdate;

    // If false, new staking is not permitted.
    bool public isStakingEnabled = false;

    /**
     * @dev Stake tokens.  Users transfer staking tokens to this contract, and their stake is recorded.
     * @param _amount The amount of tokens to stake.
     */
    function stake(uint256 amount) external nonReentrant {
        require(amount > 0, "Amount must be greater than zero.");
        require(isStakingEnabled, "Staking is not currently permitted in this ZenVault.");
        // Transfer the staking tokens from the user to this contract.
        this.transferFrom(msg.sender, address(this), amount);

        // Update the user's staked balance.
        if (stakedBalances[msg.sender] == 0) {
            stakers.push(msg.sender);
        }
        stakedBalances[msg.sender] = stakedBalances[msg.sender].add(amount);
        totalStake = totalStake.add(amount);

        emit Staked(msg.sender, amount);
    }

    /**
     * @notice Unstake tokens.
     * @dev This function:
     *      1. Reduces the user's staked balance
     *      2. Reduces the total stake in the ZenVault
     *      3. Creates an unlock chunk that will become available after the bonding period
     *      4. Does not immediately return tokens to the user - they must call withdrawUnlocked() after the bonding period
     *
     * @param user Address of the user who is unstaking tokens
     * @param _amount Amount of tokens to unstake (must be > 0 and <= user's staked balance)
     *
     * @custom:throws "Amount must be greater than zero." - If the amount is 0 or negative
     * @custom:throws "Insufficient staked balance." - If the user's staked balance is less than the requested amount
     *
     * @custom:emits Unstaked - When tokens are successfully unstaked
     *
     * @custom:security non-reentrant - Protected by the nonReentrant modifier on the public unstake function
     * @custom:security-note This function moves tokens to an unlocking state rather than transferring them immediately
     */
    function unstake(uint256 amount) external nonReentrant {
        require(amount > 0, "Amount must be greater than zero.");
        require(stakedBalances[msg.sender] >= amount, "Insufficient staked balance.");

        // Update the user's staked balance.
        stakedBalances[msg.sender] = stakedBalances[msg.sender].sub(amount);
        totalStake = totalStake.sub(amount);

        // Transfer the staking tokens from stakedBalances to unlocking
        uint32 memory currentEra = VAULT_STAKING_CONTRACT.currentEra();
        uint32 memory bondingDuration = VAULT_STAKING_CONTRACT.bondingDuration();
        UnlockChunk memory chunk = UnlockChunk(amount, currentEra + bondingDuration);
        unlocking[msg.sender] = unlocking[msg.sender].push(chunk);

        emit Unstaked(msg.sender, amount);
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

        emit Withdrawal(msg.sender, totalToTransfer);
    }

    // Record the stake amount used for the current era
    function recordEraStake(uint32 era) external {
        require(era >= lastEraUpdate, "Era exposures have been finalized for the given era.");
        delete eraExposures[era];

        // set total stake
        totalStakeAtEra[era] = totalStake;

        // Update era exposures
        uint256 writeIndex = 0;
        for (uint256 i = 0; i < stakers.length; i++) {
            address staker = stakers[i];
            if (stakedBalances[staker] > 0) {
                // Add user to record their share of the era exposure
                EraExposure memory exposure = EraExposure(staker, stakedBalances[staker]);
                eraExposures[era].push(exposure);
                // User is still staking
                if (writeIndex != i) {
                    stakers[writeIndex] = staker;
                }
                writeIndex++;
            }
        }

        // Resize the array to remove users who are no longer staking
        stakers.length = writeIndex;
        lastEraUpdate = era;

        emit EraExposureRecorded(era, totalStake);
    }

    // Distribute vault slash among users in proportion to their share of the total exposure in the slash era
    function doSlash(uint256 slash_amount, uint32 era) external {
        uint256 _totalStakeAtEra = totalStakeAtEra[era];
        EraExposure[] memory exposures = eraExposures[era];
        for (uint256 i = 0; i < exposures.length; i++) {
            EraExposure memory exposure = exposures[i];
            uint256 user_slash = exposure.value.mul(slash_amount).div(_totalStakeAtEra);
            _applySlashToUser(user_slash, exposure.staker);
        }

        emit VaultSlashed(era, era, slash_amount);
    }

    // Apply slash to individual user
    function _applySlashToUser(uint256 slash_amount, uint32 era, address user) internal {
        // Case 1: We can slash directly from user balance
        if (stakedBalances[user] >= slash_amount) {
            stakedBalances[user] = stakedBalances[user] - slash_amount;
        // Case 2: User's balance is in the process of unlocking
        } else {
            // slash from stake balance first
            uint256 remaining_slash = slash_amount - stakedBalances[user];
            stakedBalances[user] = 0;
            // slash from unlocking chunks
            UnlockChunk[] storage chunks = unlocking[user];
            for (uint256 i = chunks.length - 1; i >= 0; i--) {
                UnlockChunk chunk = chunks[i];
                if (chunk.value >= remaining_slash) {
                    chunk.value = chunk.value - remaining_slash;
                    remaining_slash = 0;
                    break;
                } else {
                    remaining_slash = remaining_slash - chunk.value;
                    chunk.value = 0;
                }
            }
            // TODO: remaining slash should never be positive here, but should I check if it is and handle it somehow?
        }

        emit UserSlashed(user, era, slash_amount);
    }

    /**
     * @dev Enable or disable staking in the ZenVault. This function can be used to pause or resume staking.
     */
    function setIsStakingEnabled(bool isEnabled) external {
        isStakingEnabled = isEnabled;
    }
}
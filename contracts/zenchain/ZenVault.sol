// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./interfaces/IZenVault.sol";
import "@uniswap/v2-core/contracts/interfaces/IUniswapV2Pair.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./Ownable.sol";
import "../../precompile-interfaces/INativeStaking.sol";

contract ZenVault is IZenVault, ReentrancyGuard, Ownable {
    // The liquidity pool token that can be staked in this vault.
    IUniswapV2Pair public pool;

    // Mapping of user addresses to their unlocking balances.
    mapping(address => UnlockChunk[]) public unlocking;

    // Mapping of user addresses to their staked amounts.
    mapping(address => uint256) public stakedBalances;

    // A list of stakers; roughly corresponds to keys of stakedBalances, but can be outdated.
    address[] private stakers;

    // Mapping to track the last era a staker's address was processed in recordEraStake
    mapping(address => uint32) private lastProcessedEraForStaker;

    // Mapping of era index to total stake;
    mapping(uint32 => uint256) public totalStakeAtEra;

    // Mapping of era index to list of staker exposures;
    mapping(uint32 => EraExposure[]) public eraExposures;

    // The total amount staked
    uint256 public totalStake;

    // The last era in which this vault was updated
    uint32 public lastEraUpdate;

    // If false, new staking is not permitted.
    bool public isStakingEnabled;

    // If false, withdrawals are not permitted. This can be used in the case of an emergency.
    bool public isWithdrawEnabled;

    // The account that receives awards from consensus staking, on behalf of the vault, and distributes the rewards among the vault stakers.
    address public rewardAccount;

    /**
     * @notice Initializes the ZenVault contract with a Uniswap V2 pair address
     * @dev Sets up the contract by:
     *      1. Inheriting from Ownable with a null initial owner (address(0))
     *      2. Initializing the Uniswap V2 pair interface that represents the pool tokens managed by this vault
     *
     * @param pairAddress The address of the Uniswap V2 pair contract to be used as the staking token
     *                    This should be a valid IUniswapV2Pair compatible contract address
     *
     * @custom:security-note The contract intentionally starts with the zero address as its owner.
     */
    constructor(address pairAddress) Ownable(address(0)) {
        pool = IUniswapV2Pair(pairAddress);
    }

    /**
     * @notice Stakes tokens in the ZenVault
     * @dev Allows users to stake tokens in the ZenVault contract. This function:
     *      1. Transfers staking tokens from the user to this contract
     *      2. Records the user's staked balance
     *      3. Adds the user to the stakers array if this is their first stake
     *      4. Updates the total stake in the ZenVault
     *
     * @param amount The amount of tokens to stake (must be > 0)
     *
     * @custom:throws "Amount must be greater than zero." - If the amount is 0 or negative
     * @custom:throws "Staking is not currently permitted in this ZenVault." - If staking is disabled
     * @custom:throws Various errors may be thrown by the transferFrom function
     *
     * @custom:emits Staked - When tokens are successfully staked, with the staker's address and amount
     *
     * @custom:security non-reentrant - Protected against reentrancy attacks
     * @custom:security-note Requires approval of tokens to this contract before staking
     */
    function stake(uint256 amount) external nonReentrant {
        require(amount > 0, "Amount must be greater than zero.");
        require(isStakingEnabled, "Staking is not currently permitted in this ZenVault.");
        // Transfer the staking tokens from the user to this contract.
        pool.transferFrom(msg.sender, address(this), amount);

        // Update the user's staked balance.
        if (stakedBalances[msg.sender] == 0) {
            stakers.push(msg.sender);
        }
        stakedBalances[msg.sender] = stakedBalances[msg.sender] + amount;
        totalStake = totalStake + amount;

        emit Staked(msg.sender, amount);
    }

    /**
     * @notice Unstake tokens.
     * @dev This function:
     *      1. Reduces the caller's staked balance
     *      2. Reduces the total stake in the ZenVault
     *      3. Creates an unlock chunk that will become available after the bonding period
     *      4. Does not immediately return tokens to the caller - they must call withdrawUnlocked() after the bonding period
     *
     * @param amount Amount of tokens to unstake (must be > 0 and <= user's staked balance)
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
        stakedBalances[msg.sender] = stakedBalances[msg.sender] - amount;
        totalStake = totalStake - amount;

        // Transfer the staking tokens from stakedBalances to unlocking
        uint32 currentEra = STAKING_CONTRACT.currentEra();
        uint32 bondingDuration = STAKING_CONTRACT.bondingDuration();
        UnlockChunk memory chunk = UnlockChunk(amount, currentEra + bondingDuration);
        unlocking[msg.sender].push(chunk);

        emit Unstaked(msg.sender, amount);
    }

    /**
     * @notice Withdraws all unlocked tokens to the caller's address
     * @dev This function:
     *      1. Retrieves the current era from the STAKING_CONTRACT
     *      2. Processes all unlock chunks for the caller
     *      3. Transfers any unlocked tokens to the caller
     *      4. Removes processed chunks from storage while preserving locked chunks
     *      5. Uses an optimized in-place array filtering technique to minimize gas costs
     *
     * Tokens are considered unlocked when the current era is greater than or equal to
     * the era specified in the unlock chunk.
     *
     * If no tokens are eligible for withdrawal, the function completes without transferring
     * any tokens but still emits an event with a zero amount.
     *
     * @custom:emits Withdrawal - When the function completes, with the caller's address and
     *                            the total amount withdrawn (may be zero)
     *
     * @custom:security-note No reentrancy protection is applied, as the state is fully updated
     *                       before any external calls
     * @custom:gas-optimization Uses in-place array filtering to avoid creating new arrays
     */
    function withdrawUnlocked() external nonReentrant {
        require(isWithdrawEnabled, "Withdrawals are temporarily disabled.");
        uint32 currentEra = STAKING_CONTRACT.currentEra();
        UnlockChunk[] storage chunks = unlocking[msg.sender];
        uint256 writeIndex = 0;
        uint256 totalToTransfer = 0;

        // Iterate over all chunks
        for (uint256 i = 0; i < chunks.length; i++) {
            UnlockChunk memory chunk = chunks[i];
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

        // Remove unlocked chunks by popping excess elements
        while (chunks.length > writeIndex) {
            chunks.pop();
        }

        // Transfer unlocked tokens to the caller, if any
        if (totalToTransfer > 0) {
            pool.transfer(msg.sender, totalToTransfer);
        }

        emit Withdrawal(msg.sender, totalToTransfer);
    }

    /**
     * @notice Records the total stake and individual staker exposures for the current era
     * @dev Updates the stake record for the era, capturing the current state of all active stakers.
     *      This function performs the following operations:
     *      1. Validates that the era is not already finalized
     *      2. Records the total stake amount for the era
     *      3. Updates the list of staker exposures for the era, capturing each staker's balance
     *      4. Cleans up the stakers array by removing users with zero balance
     *      5. Updates the lastEraUpdate value to mark this era as processed
     *
     * @custom:throws "Era exposures have been finalized for the current era." - If trying to call this function twice in the same era
     *
     * @custom:emits EraExposureRecorded - When era stake is successfully recorded, with era number and total stake amount
     *
     * @custom:security non-reentrant - Protected against reentrancy attacks
     * @custom:security-note This function manages critical staker exposure data used for reward calculations
     */
    function recordEraStake() external {
        uint32 era = STAKING_CONTRACT.currentEra();
        require(era > lastEraUpdate, "Era exposures have been finalized for the current era.");

        // set total stake
        totalStakeAtEra[era] = totalStake;
        // set lastUpdate era
        lastEraUpdate = era;

        // Update era exposures
        uint256 writeIndex = 0;
        uint256 currentStakersLength = stakers.length;
        for (uint256 i = 0; i < currentStakersLength; i++) {
            address staker = stakers[i];
            if (stakedBalances[staker] > 0 && lastProcessedEraForStaker[staker] < era) {
                lastProcessedEraForStaker[staker] = era;
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
        while (stakers.length > writeIndex) {
            stakers.pop();
        }

        emit EraExposureRecorded(era, totalStake);
    }

    /**
     * @notice Distributes rewards to stakers for a specific era
     * @dev This function allows the contract owner to distribute rewards proportionally to stakers based on their
     *      exposure during a specific era. The process involves:
     *      1. Transferring reward tokens from the owner to the contract
     *      2. Calculating each staker's share based on their exposure in the specified era
     *      3. Adding rewards to stakers' balances without requiring them to claim separately
     *      4. Incrementing the total stake with the reward amount
     *
     * The reward distribution uses a precision factor (1e12) to ensure accurate calculation of proportional rewards
     * even when dealing with small amounts.
     *
     * @param reward_amount Amount of tokens to distribute as rewards (must be > 0)
     * @param era The specific era for which to distribute rewards
     *
     * @custom:throws "Amount must be greater than zero." - If the reward amount is 0 or negative
     * @custom:throws "Staking is not currently permitted in this ZenVault." - If staking is disabled
     * @custom:throws "No stake for this era" - If there are no stakers recorded for the specified era
     * @custom:throws Various errors may be thrown by the transferFrom function
     *
     * @custom:emits UserRewardsDistributed - For each user receiving rewards, including their address, era, and reward amount
     * @custom:emits VaultRewardsDistributed - After all rewards are distributed, with the era and total reward amount
     *
     * @custom:security onlyOwner - Can only be called by the contract owner
     * @custom:security-note Requires the reward tokens to be approved to this contract before distribution
     */
    function distributeRewards(uint256 reward_amount, uint32 era) external onlyOwner {
        require(isStakingEnabled, "Staking is not currently permitted in this ZenVault.");
        require(reward_amount > 0, "Amount must be greater than zero.");
        require(pool.allowance(rewardAccount, address(this)) >= reward_amount, "Not enough allowance to transfer rewards from the vault's reward account to the vault.");

        // Transfer the staking tokens from the reward account to this contract.
        pool.transferFrom(rewardAccount, address(this), reward_amount);

        uint256 _totalStakeAtEra = totalStakeAtEra[era];
        require(_totalStakeAtEra > 0, "No stake for this era");

        uint256 PRECISION_FACTOR = 1e12;
        uint256 rewardRatio = reward_amount * PRECISION_FACTOR / _totalStakeAtEra;

        // Distribute rewards proportionally to stakers based on their era exposure
        EraExposure[] memory exposures = eraExposures[era];
        uint256 exposuresLength = exposures.length;
        for (uint256 i = 0; i < exposuresLength; i++) {
            EraExposure memory exposure = exposures[i];
            uint256 user_reward = exposure.value * rewardRatio / PRECISION_FACTOR;
            address user = exposure.staker;
            // Update the user's staked balance.
            if (stakedBalances[user] == 0) {
                stakers.push(user);
            }
            stakedBalances[user] = stakedBalances[user] + user_reward;
            emit UserRewardsDistributed(user, era, user_reward);
        }

        totalStake = totalStake + reward_amount;
        emit VaultRewardsDistributed(era, reward_amount);
    }

    /**
     * @notice Applies a slashing penalty to stakers proportional to their stake in a specific era
     * @dev This function implements the vault slashing mechanism where penalties are distributed
     *      proportionally among all stakers based on their exposure in the specified era.
     *      The function:
     *      1. Retrieves total stake amount for the specified era
     *      2. Iterates through all staker exposures for that era
     *      3. Calculates each user's slash amount proportionally to their stake
     *      4. Applies the slash to each user via the internal _applySlashToUser function
     *      5. Emits a VaultSlashed event when complete
     *
     * @param slash_amount The total amount to be slashed from the vault
     * @param era The era identifier for which the slash should be applied
     *
     * @custom:security onlyOwner - Can only be called by the contract owner
     * @custom:emits VaultSlashed - When the slashing process is complete, with the era and amount
     *
     * @notice The slashing is implemented using the formula:
     *         user_slash = (user_stake / total_stake) * slash_amount
     *         This ensures proportional distribution of the penalty among all stakers
     */
    function doSlash(uint256 slash_amount, uint32 era) external onlyOwner {
        uint256 _totalStakeAtEra = totalStakeAtEra[era];
        require(_totalStakeAtEra > 0, "No stake for this era");

        uint256 PRECISION_FACTOR = 1e12;
        uint256 slashRatio = slash_amount * PRECISION_FACTOR / _totalStakeAtEra;

        EraExposure[] memory exposures = eraExposures[era];
        uint256 exposuresLength = exposures.length;
        for (uint256 i = 0; i < exposuresLength; i++) {
            EraExposure memory exposure = exposures[i];
            uint256 user_slash = exposure.value * slashRatio / PRECISION_FACTOR;
            _applySlashToUser(user_slash, era,exposure.staker);
        }

        emit VaultSlashed(era, slash_amount);
    }

    /**
     * @notice Applies a slashing penalty to a specific user
     * @dev Implements the slashing logic for an individual user by reducing their staked balance
     *      and/or unlocking chunks when needed. The function handles two cases:
     *      1. If the user's staked balance covers the slash amount, it simply deducts from there
     *      2. If the staked balance is insufficient, it first depletes the staked balance,
     *         then continues slashing from unlocking chunks in reverse order (newest first)
     *
     * @param slash_amount The amount to be slashed from the user
     * @param era The era identifier for which the slash is occurring
     * @param user The address of the user to apply the slash to
     *
     * @custom:emits UserSlashed - When the slashing process is complete for this user
     *
     * @custom:security internal - Only callable from within the contract
     */
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
                UnlockChunk storage chunk = chunks[i];
                if (chunk.value >= remaining_slash) {
                    chunk.value = chunk.value - remaining_slash;
                    remaining_slash = 0;
                    break;
                } else {
                    remaining_slash = remaining_slash - chunk.value;
                    chunk.value = 0;
                }
            }
            // TODO: remaining slash should never be positive here. It should not be possible. But should I check if it is positive and handle it somehow?
        }
        emit UserSlashed(user, era, slash_amount);
    }

    /**
     * @notice Controls whether staking is enabled in the ZenVault
     * @dev Allows the contract owner to toggle the staking functionality on or off.
     *      When disabled, new stake() calls will be rejected.
     *      This function is restricted to the contract owner via the onlyOwner modifier.
     *      The state change is stored in the public isStakingEnabled boolean variable.
     *
     * @param isEnabled True to enable staking, false to disable it
     *
     * @custom:emits StakingEnabled - Emitted when the staking status changes, with the new status value
     * @custom:security Only callable by the contract owner
     * @custom:usage This function is primarily used for emergency situations or
     *               maintenance periods where staking needs to be temporarily paused
     */
    function setIsStakingEnabled(bool isEnabled) external onlyOwner {
        isStakingEnabled = isEnabled;
        emit StakingEnabled(isStakingEnabled);
    }

    /**
     * @notice Controls whether withdrawals are permitted in the ZenVault
     * @dev Allows the contract owner to enable or disable the withdrawal functionality.
     *      This function provides an emergency switch to prevent withdrawals in case
     *      of detected vulnerabilities or other critical issues.
     *
     *      The state variable `isWithdrawEnabled` is used as a check in withdrawal-related
     *      functions to determine if withdrawals are currently permitted.
     *
     * @param isEnabled If true, withdrawals will be permitted; if false, withdrawals will be blocked
     *
     * @custom:security onlyOwner - This function can only be called by the contract owner
     * @custom:emits WithdrawEnabled - Emitted when withdrawal status changes, with the new status as parameter
     */
    function setIsWithdrawEnabled(bool isEnabled) external onlyOwner {
        isWithdrawEnabled = isEnabled;
        emit WithdrawEnabled(isWithdrawEnabled);
    }

    /**
     * @notice Updates the reward account address
     * @dev Sets a new address for the reward account which receives and distributes staking rewards.
     *      Can only be called by the contract owner.
     *
     * @param _rewardAccount The new reward account address
     *
     * @custom:emits RewardAccountSet - When the reward account is successfully updated
     *
     * @custom:security onlyOwner - Restricted to the contract owner
     */
    function setRewardAccount(address _rewardAccount) external onlyOwner {
        rewardAccount = _rewardAccount;
        emit RewardAccountSet(rewardAccount);
    }
}

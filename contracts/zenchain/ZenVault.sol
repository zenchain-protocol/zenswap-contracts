// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./interfaces/IZenVault.sol";
import "@uniswap/v2-core/contracts/interfaces/IUniswapV2Pair.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./Ownable.sol";
import "../../precompile-interfaces/INativeStaking.sol";

// TODO: clear old data periodically to save storage space

contract ZenVault is IZenVault, ReentrancyGuard, Ownable {
    uint256 constant public PRECISION_FACTOR = 1e18;

    // The liquidity pool token that can be staked in this vault.
    IUniswapV2Pair public pool;

    // The account that receives awards from consensus staking, on behalf of the vault, and distributes the rewards among the vault stakers.
    address public rewardAccount;

    // Mapping of user addresses to their unlocking balances.
    mapping(address => UnlockChunk[]) public unlocking;

    // Mapping of user addresses to their staked amounts.
    mapping(address => uint256) public stakedBalances;

    // A list of stakers; corresponds to keys of stakedBalances.
    address[] public stakers;

    // Mapping of era index to total stake
    mapping(uint32 => uint256) public totalStakeAtEra;

    // Mapping of era index to list of exposed stakers
    mapping(uint32 => address[]) public eraStakers;

    // Mapping of era to staker to exposure.
    // This is used to track whether a staker was already processed in recordEraStake.
    mapping(uint32 => mapping(address => uint256)) public stakerEraExposures;

    // The total amount staked
    uint256 public totalStake;

    // The last era in which this vault was updated
    uint32 public lastEraUpdate;

    // If false, new staking is not permitted.
    bool public isStakingEnabled;

    // If false, withdrawals are not permitted. This can be used in the case of an emergency.
    bool public isWithdrawEnabled = true;

    // A user cannot stake an amount less than minStake.
    uint256 public minStake = 1e18;

    /**
     * @notice Initializes the ZenVault contract with a Uniswap V2 pair address
     * @dev Sets up the contract by:
     *      1. Inheriting from Ownable with an initial owner
     *      2. Initializing the Uniswap V2 pair interface that represents the pool tokens managed by this vault
     *
     * @param owner The address of the contract admin. This must be set to address(0) in production.
     * @param pairAddress The address of the Uniswap V2 pair contract to be used as the staking token
     *                    This should be a valid IUniswapV2Pair compatible contract address
     *
     * @custom:security-note The contract should intentionally start with the zero address as its owner in production.
     *                       The owner can be set to any address for testing and development.
     */
    constructor(address owner, address pairAddress) Ownable(owner) {
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
     * @param amount The amount of tokens to stake (must be > minStake)
     *
     * @custom:throws "Staking is not currently permitted in this ZenVault." - If staking is disabled
     * @custom:throws "Amount must be greater than minStake." - If the amount is less than minStake
     * @custom:throws "Not enough allowance to transfer tokens from the user to the vault." - If allowance is insufficient
     * @custom:throws Various errors may be thrown by the transferFrom function
     *
     * @custom:emits Staked - When tokens are successfully staked, with the staker's address and amount
     *
     * @custom:security non-reentrant - Protected against reentrancy attacks
     * @custom:security-note Requires approval of tokens to this contract before staking
     */
    function stake(uint256 amount) external nonReentrant {
        require(isStakingEnabled, "Staking is not currently permitted in this ZenVault.");
        require(amount >= minStake, "Amount must be at least minStake.");
        uint256 poolAllowance = pool.allowance(msg.sender, address(this));
        require(poolAllowance >= amount, "Not enough allowance to transfer tokens from the user to the vault.");

        // Transfer the staking tokens from the user to this contract.
        pool.transferFrom(msg.sender, address(this), amount);

        // Update the user's staked balance.
        uint256 initialBalance = stakedBalances[msg.sender];
        if (initialBalance < minStake) {
            stakers.push(msg.sender);
        }
        stakedBalances[msg.sender] = initialBalance + amount;
        totalStake += amount;

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
     * @custom:throws "Amount must be greater than zero." - If the amount is 0
     * @custom:throws "Insufficient staked balance." - If the user's staked balance is less than the requested amount
     * @custom:throws "Remaining staked balance must either be zero or at least minStake" - If remaining staked balance would fall below minStake but exceed zero
     *
     * @custom:emits Unstaked - When tokens are successfully unstaked
     *
     * @custom:security non-reentrant - Protected by the nonReentrant modifier on the public unstake function
     * @custom:security-note This function moves tokens to an unlocking state rather than transferring them immediately
     */
    function unstake(uint256 amount) external nonReentrant {
        require(amount > 0, "Amount must be greater than zero.");
        uint256 initialUserBalance = stakedBalances[msg.sender];
        require(initialUserBalance >= amount, "Insufficient staked balance.");
        uint256 remainingBalance = initialUserBalance - amount;
        require(remainingBalance >= minStake || remainingBalance == 0, "Remaining staked balance must either be zero or at least minStake");

        // Update the user's staked balance.
        stakedBalances[msg.sender] = remainingBalance;
        totalStake = totalStake - amount;

        // Transfer the staking tokens from stakedBalances to unlocking
        uint32 currentEra = STAKING_CONTRACT.currentEra();
        uint32 bondingDuration = STAKING_CONTRACT.bondingDuration();
        UnlockChunk memory chunk = UnlockChunk(amount, currentEra + bondingDuration);
        unlocking[msg.sender].push(chunk);

        // remove staker if fully unstaked
        if (remainingBalance < minStake) {
            removeFromStakers(msg.sender);
        }

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
     * @custom:emits Withdrawal - If tokens are withdrawn, with the caller's address and
     *                            the total amount withdrawn (may be zero)
     *
     * @custom:security-note No reentrancy protection is applied, as the state is fully updated
     *                       before any external calls
     * @custom:gas-optimization Uses in-place array filtering to avoid creating new arrays
     */
    function withdrawUnlocked() external nonReentrant {
        require(isWithdrawEnabled, "Withdrawals are temporarily disabled.");

        UnlockChunk[] storage chunks = unlocking[msg.sender];
        require(chunks.length > 0, "No unlocking chunks found for caller.");

        uint32 currentEra = STAKING_CONTRACT.currentEra();
        uint256 writeIndex = 0;
        uint256 totalToTransfer = 0;

        // Iterate over all chunks
        uint256 len = chunks.length;
        for (uint256 i = 0; i < len; i++) {
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
        uint256 toPop = chunks.length - writeIndex;
        for (uint256 i = 0; i < toPop; i++) {
            chunks.pop();
        }

        // Transfer unlocked tokens to the caller, if any
        if (totalToTransfer > 0) {
            pool.transfer(msg.sender, totalToTransfer);
            emit Withdrawal(msg.sender, totalToTransfer);
        }
    }

    /**
     * @notice Records the total stake and individual staker exposures for the current era
     * @dev Updates the stake record for the era, capturing the current state of all active stakers.
     *      This function performs the following operations:
     *      1. Validates that the era is not already finalized
     *      2. Records the total stake amount for the era
     *      3. Updates the list of staker exposures for the era, capturing each staker's balance
     *      5. Updates the lastEraUpdate value to mark this era as processed
     *
     * @custom:throws "Era exposures have been finalized for the current era." - If trying to call this function twice in the same era
     *
     * @custom:emits EraExposureRecorded - When era stake is successfully recorded, with era number and total stake amount
     *
     * @custom:security non-reentrant - Protected against reentrancy attacks
     * @custom:security-note This function manages critical staker exposure data used for reward calculations
     */
    function recordEraStake() external onlyOwner {
        uint32 era = STAKING_CONTRACT.currentEra();
        require(era > lastEraUpdate, "Era exposures have been finalized for the current era.");

        // set total stake
        uint256 currentTotalStake = totalStake;
        totalStakeAtEra[era] = currentTotalStake;
        // set lastUpdate era
        lastEraUpdate = era;
        // set era stakers
        address[] memory stakersInMemory = stakers;
        eraStakers[era] = stakersInMemory;

        // Update era exposures
        mapping(address => uint256) storage currentEraExposures = stakerEraExposures[era];
        uint256 len = stakersInMemory.length;
        for (uint256 i = 0; i < len; i++) {
            address staker = stakersInMemory[i];
            currentEraExposures[staker] = stakedBalances[staker];
        }

        emit EraExposureRecorded(era, currentTotalStake);
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
     * The reward distribution uses a precision factor (1e18) to ensure accurate calculation of proportional rewards
     * even when dealing with small amounts.
     *
     * @param rewardAmount Amount of tokens to distribute as rewards (must be > 0)
     * @param era The specific era for which to distribute rewards
     *
     * @custom:throws "Amount must be greater than zero." - If the reward amount is 0 or negative
     * @custom:throws "Not enough allowance to transfer rewards from the vault's reward account to the vault." - If insufficient allowance
     * @custom:throws "No stake for this era" - If there are no stakers recorded for the specified era
     * @custom:throws Various errors may be thrown by the transferFrom function
     *
     * @custom:emits VaultRewardsDistributed - After all rewards are distributed, with the era and total reward amount
     *
     * @custom:security onlyOwner - Can only be called by the contract owner
     * @custom:security-note Requires the reward tokens to be approved to this contract before distribution
     */
    function distributeRewards(uint256 rewardAmount, uint32 era) external onlyOwner {
        require(rewardAmount > 0, "Amount must be greater than zero.");

        uint256 poolAllowance = pool.allowance(rewardAccount, address(this));
        require(poolAllowance >= rewardAmount, "Not enough allowance to transfer rewards from the vault's reward account to the vault.");

        uint256 _totalStakeAtEra = totalStakeAtEra[era];
        require(_totalStakeAtEra > 0, "No stake for this era");

        // Transfer the staking tokens from the reward account to this contract.
        pool.transferFrom(rewardAccount, address(this), rewardAmount);

        uint256 rewardRatio = rewardAmount * PRECISION_FACTOR / _totalStakeAtEra;

        // Distribute rewards proportionally to stakers based on their era exposure
        mapping(address => uint256) storage currentEraExposures = stakerEraExposures[era];
        uint256 totalRewarded = 0;
        address[] memory exposedStakers = eraStakers[era];
        uint256 len = exposedStakers.length;
        UserReward[] memory allUserRewards = new UserReward[](len);
        for (uint256 i = 0; i < len; i++) {
            address user = exposedStakers[i];
            uint256 exposure = currentEraExposures[user];
            uint256 userReward = exposure * rewardRatio / PRECISION_FACTOR;
            uint256 userBalanceBeforeReward = stakedBalances[user];
            uint256 userBalanceAfterReward = userBalanceBeforeReward + userReward;
            // Update the stakers array.
            if (userBalanceBeforeReward < minStake && userBalanceAfterReward >= minStake) {
                stakers.push(user);
            }
            // Update the user's staked balance.
            stakedBalances[user] = userBalanceAfterReward;

            allUserRewards[i] = UserReward(user, userReward);
            totalRewarded = totalRewarded + userReward;
        }

        // totalRewarded may slightly differ from rewardAmount due to precision, but that's okay.
        totalStake = totalStake + totalRewarded;
        emit VaultRewardsDistributed(era, totalRewarded, allUserRewards);
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
     * @param slashAmount The total amount to be slashed from the vault
     * @param era The era identifier for which the slash should be applied
     *
     * @custom:security onlyOwner - Can only be called by the contract owner
     * @custom:emits VaultSlashed - When the slashing process is complete, with the era and amount
     *
     * @notice The slashing is implemented using the formula:
     *         userSlash = (userStake / totalStake) * slashAmount
     *         This ensures proportional distribution of the penalty among all stakers
     */
    function doSlash(uint256 slashAmount, uint32 era) external onlyOwner {
        uint256 _totalStakeAtEra = totalStakeAtEra[era];
        require(_totalStakeAtEra > 0, "No stake for this era");

        uint256 slashRatio = slashAmount * PRECISION_FACTOR / _totalStakeAtEra;

        mapping(address => uint256) storage currentEraExposures = stakerEraExposures[era];
        uint256 totalSlashed = 0;
        address[] memory exposedStakers = eraStakers[era];
        uint256 len = exposedStakers.length;
        UserSlash[] memory allUserSlashes = new UserSlash[](len);
        for (uint256 i = 0; i < len; i++) {
            address user = exposedStakers[i];
            uint256 exposure = currentEraExposures[user];
            uint256 intendedUserSlash = exposure * slashRatio / PRECISION_FACTOR;
            uint256 actualUserSlash = _applySlashToUser(intendedUserSlash, user);
            totalSlashed = totalSlashed + actualUserSlash;
            allUserSlashes[i] = UserSlash(user, actualUserSlash);
        }

        // totalSlashed may slightly differ from slashAmount due to precision, but that's okay.
        emit VaultSlashed(era, totalSlashed, allUserSlashes);
    }

    /**
     * @notice Applies a slashing penalty to a specific user
     * @dev Implements the slashing logic for an individual user by reducing their staked balance
     *      and/or unlocking chunks when needed. The function handles two cases:
     *      1. If the user's staked balance covers the slash amount, it simply deducts from there
     *      2. If the staked balance is insufficient, it first depletes the staked balance,
     *         then continues slashing from unlocking chunks in reverse order (newest first)
     *
     * @param slashAmount The amount to be slashed from the user
     * @param user The address of the user to apply the slash to
     *
     * @custom:security internal - Only callable from within the contract
     */
    function _applySlashToUser(uint256 slashAmount, address user) internal returns(uint256) {
        uint256 remainingSlash = slashAmount;
        uint256 intialStakedBalance = stakedBalances[user];
        // Case 1: We can slash directly from user balance
        if (intialStakedBalance >= slashAmount) {
            uint256 remainingBalance = intialStakedBalance - slashAmount;
            stakedBalances[user] = remainingBalance;
            remainingSlash = 0;
            // cleanup: remove staker if fully unstaked
            if (remainingBalance < minStake) {
                removeFromStakers(user);
            }
        // Case 2: User's balance is in the process of unlocking
        } else {
            // slash from stake balance first
            remainingSlash = remainingSlash - intialStakedBalance;
            stakedBalances[user] = 0;
            // cleanup: remove fully unstaked user from stakers list
            removeFromStakers(user);
            // slash from unlocking chunks
            UnlockChunk[] storage chunks = unlocking[user];
            while (chunks.length > 0 && remainingSlash > 0) {
                UnlockChunk storage chunk = chunks[chunks.length - 1];
                if (chunk.value > remainingSlash) {
                    chunk.value -= remainingSlash;
                    remainingSlash = 0;
                } else {
                    remainingSlash -= chunk.value;
                    chunks.pop();
                }
            }
        }
        return slashAmount - remainingSlash;
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

    /**
     * @notice Updates the minimum staking amount required for the vault
     * @dev Can only be called by the contract owner
     * @param _minStake The new minimum amount of tokens that users must stake
     * @custom:emits MinStakeSet when the minimum stake value is updated
     */
    function setMinStake(uint256 _minStake) external onlyOwner {
        require(_minStake > 0, "The minimum stake must be greater than 0.");
        uint256 oldMinStake = minStake;
        minStake = _minStake;
        emit MinStakeSet(_minStake);

        // ensure invariant
        if (oldMinStake < minStake) {
            address[] memory stakersInMemory = stakers;
            uint256 len = stakersInMemory.length;
            for (uint256 i = 0; i < len; i++) {
                if (stakedBalances[stakersInMemory[i]] < minStake) {
                    stakers[i] = stakersInMemory[len - 1];
                    stakers.pop();
                    len -= 1;
                }
            }
        }
    }

    /**
     * @notice Returns the complete list of current stakers in the vault
     * @dev Provides read-only access to the entire stakers array
     * @return An array of addresses that have active stakes in the vault
     */
    function getCurrentStakers() external view returns (address[] memory) {
        return stakers;
    }

    /**
     * @notice Retrieves a staker's exposure values for multiple eras
     * @dev Returns an array containing the staker's exposure for each requested era.
     *      The function accesses the stakerEraExposures mapping which tracks a staker's
     *      stake exposure for specific eras. If a staker has no exposure for a particular
     *      era, the default value of 0 will be returned for that era.
     *
     * @param staker The address of the staker whose exposures are being queried
     * @param eras An array of era indices for which to retrieve the staker's exposures
     *
     * @return uint256[] An array of exposure values corresponding to each requested era,
     *                   with the same order as the input eras array
     */
    function getStakerExposuresForEras(address staker, uint32[] calldata eras) external view returns (uint256[] memory) {
        uint256[] memory exposures = new uint256[](eras.length);
        uint256 len = eras.length;
        for (uint i = 0; i < len; i++) {
            exposures[i] = stakerEraExposures[eras[i]][staker];
        }
        return exposures;
    }

    /**
     * @notice Retrieves all staker exposures for a specific era
     * @dev Returns the complete array of EraExposure elements for the given era
     * @param era The era index to retrieve exposures for
     * @return An array of EraExposure structs containing staker addresses and their exposure values
     */
    function getEraExposures(uint32 era) external view returns (EraExposure[] memory) {
        address[] memory users = eraStakers[era];
        EraExposure[] memory exposures = new EraExposure[](users.length);
        uint256 len = users.length;
        for (uint i = 0; i < len; i++) {
            exposures[i] = EraExposure(users[i], stakerEraExposures[era][users[i]]);
        }
        return exposures;
    }

    /**
     * @notice Retrieves all unlocking chunks for a specific user
     * @dev Returns the complete array of UnlockChunk elements for the given user address
     * @param user The address of the user to retrieve unlocking chunks for
     * @return An array of UnlockChunk structs containing the user's unlocking balances
     */
    function getUserUnlockingChunks(address user) external view returns (UnlockChunk[] memory) {
        return unlocking[user];
    }

    // Remove a staker from the stakers list. Only use if stake < minStake!
    function removeFromStakers(address user) internal {
        address[] memory stakersInMemory = stakers;
        uint256 len = stakersInMemory.length;
        for (uint256 i = 0; i < len; i++) {
            if (stakersInMemory[i] == user) {
                stakers[i] = stakersInMemory[len - 1];
                stakers.pop();
                return;
            }
        }
    }
}

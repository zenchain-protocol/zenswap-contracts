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
    // The account that receives awards from consensus staking, on behalf of the vault, and distributes the rewards among the vault stakers.
    address public rewardAccount;
    // Affects precision of calculations. Used to prevent integer overflow.
    uint256 constant public PRECISION_FACTOR = 1e18;
    // The ZenChain NativeStaking precompile
    NativeStaking public nativeStaking = STAKING_CONTRACT;

    // --- STAKE RELATED ---
    // The total amount staked (does not including pending rewards/slashes)
    uint256 public totalStake;
    // The total amount of slashable stake (includes value of unlocking chunks)
    uint256 public totalSlashableStake;
    // Mapping of user addresses to their staked amounts (excluding pending rewards/slashes).
    mapping(address => uint256) public stakedBalances;
    // Mapping of user addresses to their unlocking balances.
    mapping(address => UnlockChunk[]) public unlocking;

    // --- REWARD RELATED ---
    // Tracks cumulative rewards
    uint256 public cumulativeRewardPerShare;
    // Tracks reward value applied to each user (i.e., whether the user's rewards are up to date)
    mapping(address => uint256) public userRewardPerSharePaid;

    // --- SLASH RELATED ---
    // Tracks cumulative slashing
    uint256 public cumulativeSlashPerShare;
    // Tracks slash value applied to each user (i.e., whether the user's slash is up to date)
    mapping(address => uint256) public userSlashPerShareApplied;

    // --- CONFIGURATION RELATED ---
    // If false, new staking is not permitted.
    bool public isStakingEnabled;
    // If false, withdrawals are not permitted. This can be used in the case of an emergency.
    bool public isWithdrawEnabled = true;
    // A user cannot stake an amount less than minStake.
    uint256 public minStake = 1e18;
    // The length limit of a user's `unlocking` array.
    uint8 public maxUnlockChunks = 10;

    constructor(address owner, address pairAddress) Ownable(owner) {
        pool = IUniswapV2Pair(pairAddress);
    }

    /**
     * @notice Allows users to stake liquidity pool tokens in the ZenVault
     * @dev This function handles the entire staking process, including:
     *      - Validating stake requirements
     *      - Updating user states (pending rewards and slashes)
     *      - Transferring tokens from user to vault
     *      - Updating contract state
     *      - Emitting relevant events
     *
     * The function uses nonReentrant modifier to prevent reentrancy attacks.
     * New users (with no previous stake) will have their reward and slash trackers
     * initialized to current global values to prevent retroactive rewards/slashes.
     *
     * @param amount The amount of liquidity pool tokens to stake (must be >= minStake)
     *
     * @custom:requirements
     *   - Staking must be enabled in the vault
     *   - Staked amount must be >= minStake
     *   - User must have approved sufficient allowance for token transfer
     *
     * @custom:modifies
     *   - stakedBalances[user] - Increases by amount
     *   - totalStake - Increases by amount
     *   - For new stakers: userRewardPerSharePaid and userSlashPerShareApplied are initialized
     *
     * @custom:emits Staked(address indexed user, uint256 amount)
     */
    function stake(uint256 amount) external nonReentrant {
        require(isStakingEnabled, "Staking is not currently permitted in this ZenVault.");
        require(amount >= minStake, "Amount must be at least minStake.");
        address user = msg.sender;
        uint256 poolAllowance = pool.allowance(user, address(this));
        require(poolAllowance >= amount, "Not enough allowance to transfer tokens from the user to the vault.");

        // Calculate pending slashes & rewards
        _updateUserState(user);

        uint256 initialBalance = stakedBalances[user];

        // Initialize paid values to current global; prevents retroactive rewards/slashes
        if (initialBalance == 0) {
            userRewardPerSharePaid[user] = cumulativeRewardPerShare;
            userSlashPerShareApplied[user] = cumulativeSlashPerShare;
        }

        // Transfer tokens
        pool.transferFrom(user, address(this), amount);

        // Update balance and total stake
        stakedBalances[user] = initialBalance + amount;
        totalStake += amount;
        totalSlashableStake += amount;

        emit Staked(user, amount);
    }

    /**
     * @notice Allows users to initiate the unstaking process for their liquidity pool tokens
     * @dev This function handles the entire unstaking initiation process, including:
     *      - Updating user state (pending rewards and slashes)
     *      - Validating unstake requirements
     *      - Moving tokens from staked balance to the unlocking queue
     *      - Creating an unlock chunk with appropriate unlock era
     *
     * The function uses nonReentrant modifier to prevent reentrancy attacks.
     * Unstaked tokens are not immediately available and must go through an unlocking period
     * determined by the native staking protocol's bonding duration.
     *
     * @param amount The amount of liquidity pool tokens to unstake
     *
     * @custom:requirements
     *   - Amount must be greater than zero
     *   - User must have sufficient staked balance
     *   - Remaining staked balance must either be zero or at least minStake
     *   - User's unlocking array must not have reached maxUnlockChunks limit
     *
     * @custom:modifies
     *   - stakedBalances[user] - Decreased by amount
     *   - totalStake - Decreased by amount
     *   - unlocking[user] - New UnlockChunk added
     *
     * @custom:emits Unstaked(address indexed user, uint256 amount)
     */
    function unstake(uint256 amount) external nonReentrant {
        require(amount > 0, "Amount must be greater than zero.");
        address user = msg.sender;

        // update state
        _updateUserState(user);

        // additional checks
        uint256 initialUserBalance = stakedBalances[user];
        require(initialUserBalance >= amount, "Insufficient staked balance.");
        uint256 remainingBalance = initialUserBalance - amount;
        require(remainingBalance >= minStake || remainingBalance == 0, "Remaining staked balance must either be zero or at least minStake");
        require(unlocking[user].length < maxUnlockChunks, "Unlocking array length limit reached. Withdraw unlocked tokens before unstaking.");

        // Update the user's staked balance.
        stakedBalances[user] = remainingBalance;
        totalStake -= amount;

        // Transfer the staking tokens from stakedBalances to unlocking
        uint32 currentEra = nativeStaking.currentEra();
        uint32 bondingDuration = nativeStaking.bondingDuration();
        UnlockChunk memory chunk = UnlockChunk(amount, currentEra + bondingDuration);
        unlocking[user].push(chunk);

        emit Unstaked(user, amount);
    }

    /**
     * @notice Allows users to withdraw their liquidity tokens that have completed the unlocking period
     * @dev This function processes all unlocking chunks for a user and transfers any tokens that have
     *      completed their unlocking period (where chunk.era < currentEra). The function:
     *      1. Updates the user's state to apply any pending slashes
     *      2. Identifies which chunks are fully unlocked based on the current era
     *      3. Compresses the remaining locked chunks by removing the unlocked ones
     *      4. Transfers the total unlocked amount to the user
     *
     * The function uses the nonReentrant modifier to prevent reentrancy attacks and optimizes
     * array operations by using a write index pattern to avoid excessive gas costs when
     * reorganizing the unlocking array.
     *
     * @custom:requirements
     *   - Withdrawals must be enabled in the vault
     *   - User must have at least one unlocking chunk
     *
     * @custom:modifies
     *   - unlocking[user] - Removes chunks that have completed the unlock period
     *   - pool balance - Transfers unlocked tokens to the user
     *
     * @custom:emits Withdrawal(address indexed user, uint256 amount)
     */
    function withdrawUnlocked() external nonReentrant {
        require(isWithdrawEnabled, "Withdrawals are temporarily disabled.");
        address user = msg.sender;

        // Ensure slashes are applied before withdrawal
        _updateUserState(user);

        UnlockChunk[] storage chunks = unlocking[user];
        require(chunks.length > 0, "Nothing to withdraw.");

        uint32 currentEra = nativeStaking.currentEra();
        uint256 writeIndex = 0;
        uint256 totalToTransfer = 0;

        // Iterate over all chunks
        uint256 len = chunks.length;
        for (uint256 i = 0; i < len; i++) {
            UnlockChunk memory chunk = chunks[i];
            if (chunk.era < currentEra) {
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
        uint256 numToPop = chunks.length - writeIndex;
        for (uint256 i = 0; i < numToPop; i++) {
            chunks.pop();
        }

        // Transfer unlocked tokens to the caller, if any
        if (totalToTransfer > 0) {
            totalSlashableStake -= totalToTransfer;
            pool.transfer(user, totalToTransfer);
            emit Withdrawal(user, totalToTransfer);
        }
    }

    /**
     * @notice Public function to update the caller's pending rewards and slashes
     * @dev Provides an external interface to the internal _updateUserState function,
     *      allowing users to manually sync their account state. This applies any pending
     *      slashes first, then calculates and auto-restakes any earned rewards.
     *      Protected against reentrancy attacks.
     *
     * @custom:emits RewardsRestaked - If there are pending rewards to apply
     * @custom:emits UserSlashApplied - If there are pending slashes to apply
     */
    function updateUserState() external nonReentrant {
        _updateUserState(msg.sender);
    }

    /**
     * @notice Distributes reward tokens to the vault for all stakers
     * @dev This function allows the contract owner to distribute rewards to all stakers proportionally
     *      based on their stake in the vault. The rewards are not directly sent to stakers but rather
     *      update the global reward metrics that will be used when stakers claim their rewards.
     *
     * The function performs the following operations:
     *      - Validates reward amount and reward account configuration
     *      - Checks sufficient allowance from reward account
     *      - Transfers tokens from reward account to the vault
     *      - Updates the cumulative reward per share metric if there are stakers
     *      - Emits an event with reward distribution details
     *
     * If there are no stakers (totalStake == 0), the tokens are still transferred to the vault,
     * but the cumulativeRewardPerShare is not updated since there's no one to distribute to.
     *
     * @param rewardAmount The amount of liquidity pool tokens to distribute as rewards
     *
     * @custom:requirements
     *   - Can only be called by the contract owner
     *   - rewardAmount must be greater than zero
     *   - rewardAccount must be set (not zero address)
     *   - rewardAccount must have approved sufficient allowance for the vault
     *
     * @custom:modifies
     *   - cumulativeRewardPerShare - Increases by (rewardAmount * PRECISION_FACTOR / totalStake) if totalStake > 0
     *
     * @custom:emits VaultRewardsAdded(uint256 amount, uint256 newCumulativeRewardPerShare, uint256 rewardRatio)
     */
    function distributeRewards(uint256 rewardAmount) external onlyOwner {
        require(rewardAmount > 0, "Amount must be greater than zero.");
        require(rewardAccount != address(0), "Reward account not set.");
        require(totalStake > 0, "There are no stakers to receive rewards.");
        // check allowance
        uint256 poolAllowance = pool.allowance(rewardAccount, address(this));
        require(poolAllowance >= rewardAmount, "Not enough allowance to transfer rewards from the vault's reward account to the vault.");

        // Transfer the staking tokens from the reward account to this contract.
        pool.transferFrom(rewardAccount, address(this), rewardAmount);

        uint256 rewardRatio;
        if (totalStake > 0) {
            // Add reward proportionally based on current total stake
            rewardRatio = rewardAmount * PRECISION_FACTOR / totalStake;
            cumulativeRewardPerShare += rewardRatio;
        }

        emit VaultRewardsAdded(rewardAmount, cumulativeRewardPerShare, rewardRatio);
    }

    /**
     * @notice Allows the owner to slash a portion of the total *slashable* stake as a penalty.
     * @dev This function implements the slashing mechanism for the ZenVault:
     * - Verifies there is slashable stake available.
     * - Caps the slash amount to the available total *slashable* stake.
     * - Calculates the slash ratio proportionally across all *slashable* stake.
     * - Updates the cumulative slash tracker used to apply penalties.
     * - Note: This function does NOT directly decrease totalStake or totalSlashableStake;
     * those are updated when the slash is applied to individual users via _applySlashToUser.
     *
     * @param slashAmount The amount to slash from the total *slashable* stake.
     *
     * @custom:requirements
     * - Can only be called by the contract owner.
     * - Total slashable stake must be greater than zero.
     *
     * @custom:modifies
     * - cumulativeSlashPerShare - Increases by the slash ratio based on totalSlashableStake.
     *
     * @custom:emits VaultSlashed(uint256 actualSlashAmount, uint256 cumulativeSlashPerShare, uint256 slashRatio)
     */
    function doSlash(uint256 slashAmount) external onlyOwner {
        require(totalSlashableStake > 0, "No stake to slash.");

        // Ensure slashAmount doesn't exceed totalStake to avoid totalStake underflow
        uint256 actualSlashAmount = slashAmount > totalSlashableStake ? totalSlashableStake : slashAmount;

        if (actualSlashAmount > 0) {
            // Increase cumulative slash proportionally based on current total stake
            uint256 slashRatio = actualSlashAmount * PRECISION_FACTOR / totalSlashableStake;
            cumulativeSlashPerShare += slashRatio;
            emit VaultSlashed(actualSlashAmount, cumulativeSlashPerShare, slashRatio);
        }
    }

    /**
     * @notice Applies a calculated slash penalty to a user's tokens
     * @dev Applies slashing in a specific order:
     *      1. Calculates slash amount proportional to user's staked balance
     *      2. Reduces user's active staked balance first
     *      3. If more slashing needed, reduces unlocking chunks starting from newest
     *      4. Emits event with detailed slash breakdown
     *
     * The slash amount is calculated as: userStake * slashOutstanding / PRECISION_FACTOR
     *
     * @param user Address of the user to apply the slash to
     * @param slashOutstanding The normalized slash factor (scaled by PRECISION_FACTOR)
     * @param userStakeBeforeSlash The user's initial staked balance, before any slash is applied
     *
     * @custom:modifies
     *   - stakedBalances[user] - May be reduced by slashed amount
     *   - totalStake - Reduced by amount slashed from staked balance
     *   - unlocking[user] - Chunks may be reduced or removed if staked balance is insufficient
     *
     * @custom:emits UserSlashApplied(address user, uint256 totalSlashed, uint256 slashedFromStake, uint256 slashedFromUnlocking)
     */
    function _applySlashToUser(address user, uint256 slashOutstanding, uint256 userStakeBeforeSlash) internal {
        uint256 userSlashableStake = _getSlashableStake(user, userStakeBeforeSlash);
        if (userSlashableStake > 0) {
            uint256 pendingSlash = userSlashableStake * slashOutstanding / PRECISION_FACTOR;
            if (pendingSlash > 0) {
                uint256 remainingSlash = pendingSlash;

                // Slash staked balance first
                uint256 slashedFromStake = 0;
                if (remainingSlash > 0 && userStakeBeforeSlash > 0) {
                    if (userStakeBeforeSlash >= remainingSlash) {
                        slashedFromStake = remainingSlash;
                        stakedBalances[user] = userStakeBeforeSlash - remainingSlash;
                        remainingSlash = 0;
                    } else {
                        slashedFromStake = userStakeBeforeSlash;
                        remainingSlash -= userStakeBeforeSlash;
                        stakedBalances[user] = 0;
                    }
                    // update total stake
                    totalStake -= slashedFromStake;
                }

                // Slash unlocking chunks if necessary
                uint256 slashedFromUnlocking = 0;
                if (remainingSlash > 0) {
                    UnlockChunk[] storage chunks = unlocking[user];
                    // slash newest first because they will become unlocked last
                    while (chunks.length > 0 && remainingSlash > 0) {
                        UnlockChunk storage chunk = chunks[chunks.length - 1];
                        uint256 chunkSlash = 0;
                        if (chunk.value > remainingSlash) {
                            chunkSlash = remainingSlash;
                            chunk.value -= remainingSlash;
                            remainingSlash = 0;
                        } else {
                            chunkSlash = chunk.value;
                            remainingSlash -= chunk.value;
                            chunks.pop();
                        }
                        slashedFromUnlocking += chunkSlash;
                    }
                }

                // update slashable stake
                totalSlashableStake = totalSlashableStake - slashedFromStake - slashedFromUnlocking;

                emit UserSlashApplied(user, pendingSlash, slashedFromStake, slashedFromUnlocking);
            }
        }
    }

    /**
     * @notice Calculates the total slashable stake for a user
     * @dev Combines the user's current staked balance with all values in their unlocking chunks
     * to determine the total amount of tokens that can be subject to slashing
     *
     * @param user The address of the user to calculate slashable stake for
     * @param userStake The user's current staked balance (passed as parameter to avoid duplicate storage reads)
     * @return The total slashable stake amount (current stake + all unlocking chunks)
     */
    function _getSlashableStake(address user, uint256 userStake) internal view returns (uint256) {
        uint256 slashableStake = userStake;
        UnlockChunk[] memory chunks = unlocking[user];
        uint256 len = chunks.length;
        for (uint256 i = 0; i < len; i++) {
            slashableStake += chunks[i].value;
        }
        return slashableStake;
    }

    /**
     * @dev Calculates and applies pending rewards for a user by auto-restaking them
     * @param user The address of the user receiving rewards
     * @param rewardOutstanding The accumulated reward rate that hasn't been processed for this user
     * @param userStakeBeforeReward The user's initial staked balance, before any reward is applied
     *
     * @custom:modifies
     *   - stakedBalances[user] - Increases by the calculated reward amount
     *   - totalStake - Increases by the calculated reward amount
     *
     * @custom:emits RewardsRestaked(address indexed user, uint256 amount)
     *
     * @notice This internal function:
     *   - Only processes rewards for users with existing stakes
     *   - Calculates rewards proportional to user's stake using the precision factor
     *   - Automatically compounds rewards by adding them to the user's stake
     */
    function _applyRewardToUser(address user, uint256 rewardOutstanding, uint256 userStakeBeforeReward) internal {
        if (userStakeBeforeReward > 0) {
            uint256 pendingReward = userStakeBeforeReward * rewardOutstanding / PRECISION_FACTOR;
            if (pendingReward > 0) {
                stakedBalances[user] += pendingReward;
                totalStake += pendingReward;
                totalSlashableStake += pendingReward;
                emit RewardsRestaked(user, pendingReward);
            }
        }
    }

    /**
     * @notice Updates a user's pending slashes and rewards based on global cumulative values
     * @dev Critical internal function that must be called before any action that modifies a user's
     *      staked balance or initiates withdrawals. Ensures state consistency by:
     *      1. First applying any outstanding slashes to prevent rewarding slashed stake
     *      2. Then applying any pending rewards based on current stake
     *
     * @param user The address of the user whose state needs updating
     *
     * @custom:sequence The function deliberately processes slashes before rewards to maintain
     *                 fairness in token distribution
     *
     * @custom:modifies
     *   - userSlashPerShareApplied[user] - Updated to current cumulativeSlashPerShare
     *   - userRewardPerSharePaid[user] - Updated to current cumulativeRewardPerShare
     *   - User's effective balance (via _applySlashToUser if applicable)
     *   - User's reward balance (via _applyRewardToUser if applicable)
     */
    function _updateUserState(address user) internal {
        uint256 userStakeBeforeUpdate = stakedBalances[user];
        // Apply pending slash first, if any, to ensure user cannot be rewarded for stake that should have been slashed
        uint256 slashOutstanding = cumulativeSlashPerShare - userSlashPerShareApplied[user];
        if (slashOutstanding > 0) {
            _applySlashToUser(user, slashOutstanding, userStakeBeforeUpdate);
            // Update user's applied slash level regardless of whether they had stake
            userSlashPerShareApplied[user] = cumulativeSlashPerShare;
        }
        // Apply pending rewards
        uint256 rewardOutstanding = cumulativeRewardPerShare - userRewardPerSharePaid[user];
        if (rewardOutstanding > 0) {
            _applyRewardToUser(user, rewardOutstanding, userStakeBeforeUpdate);
            // Update user's paid reward level regardless of whether they had stake
            userRewardPerSharePaid[user] = cumulativeRewardPerShare;
        }
    }

    /**
     * @notice Controls whether staking is enabled in the ZenVault
     * @dev Allows the contract owner to toggle the staking functionality on or off.
     *      When disabled, new stake() calls will be rejected.
     *      This function is restricted to the contract owner via the onlyOwner modifier.
     *      The state change is stored in the public isStakingEnabled boolean variable.
     *
     * @param _isStakingEnabled True to enable staking, false to disable it
     *
     * @custom:emits StakingEnabled - Emitted when the staking status changes, with the new status value
     * @custom:security Only callable by the contract owner
     * @custom:usage This function is intended for emergency situations or
     *               maintenance periods where staking needs to be temporarily paused
     */
    function setIsStakingEnabled(bool _isStakingEnabled) external onlyOwner {
        isStakingEnabled = _isStakingEnabled;
        emit StakingEnabled(_isStakingEnabled);
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
     * @param _isWithdrawEnabled If true, withdrawals will be permitted; if false, withdrawals will be blocked
     *
     * @custom:security onlyOwner - This function can only be called by the contract owner
     * @custom:emits WithdrawEnabled - Emitted when withdrawal status changes, with the new status as parameter
     */
    function setIsWithdrawEnabled(bool _isWithdrawEnabled) external onlyOwner {
        isWithdrawEnabled = _isWithdrawEnabled;
        emit WithdrawEnabled(_isWithdrawEnabled);
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
        emit RewardAccountSet(_rewardAccount);
    }

    /**
     * @notice Updates the minimum staking amount required for the vault
     * @dev Can only be called by the contract owner
     * @param _minStake The new minimum amount of tokens that users must stake
     * @custom:emits MinStakeSet when the minimum stake value is updated
     */
    function setMinStake(uint256 _minStake) external onlyOwner {
        require(_minStake > 0, "The minimum stake must be greater than 0.");
        minStake = _minStake;
        emit MinStakeSet(_minStake);
    }

    /**
     * @notice Updates the maximum number of unlock chunks allowed per user
     * @dev Only callable by the contract owner
     * @param _maxUnlockChunks The new maximum number of unlock chunks (must be > 0)
     * @custom:emits MaxUnlockChunksSet(uint8 _maxUnlockChunks)
     */
    function setMaxUnlockChunks(uint8 _maxUnlockChunks) external onlyOwner {
        require(_maxUnlockChunks > 0, "The maximum unlocking array length must be greater than 0.");
        maxUnlockChunks = _maxUnlockChunks;
        emit MaxUnlockChunksSet(_maxUnlockChunks);
    }

    /**
     * @notice Updates the address of the native staking precompile contract
     * @dev This function is reserved for emergency situations only, such as if the
     *      staking precompile address changes in the underlying protocol. It should
     *      not be used under normal circumstances.
     *
     * @param _nativeStakingPrecompile The new address of the native staking precompile
     *
     * @custom:access Restricted to contract owner
     * @custom:emits NativeStakingAddressSet(address _nativeStakingPrecompile)
     */
    function setNativeStakingAddress(address _nativeStakingPrecompile) external onlyOwner {
        nativeStaking = NativeStaking(_nativeStakingPrecompile);
        emit NativeStakingAddressSet(_nativeStakingPrecompile);
    }

    /**
     * @notice Calculates the total slashable stake for a given user.
     * This includes their active staked balance plus the value of all unlocking chunks.
     * @param user The address of the user.
     * @return The total slashable stake for the user.
     */
    function getSlashableStake(address user) external view returns (uint256) {
        return _getSlashableStake(user, stakedBalances[user]);
    }

    /**
     * @notice Retrieves all unlocking chunks for a specific user
     * @dev Returns the complete array of UnlockChunk elements for the given user address
     * @param user The address of the user to retrieve unlocking chunks for
     * @return An array of UnlockChunk structs containing the user's unlocking balances
     */
    function getUnlockingChunks(address user) external view returns (UnlockChunk[] memory) {
        return unlocking[user];
    }

    /**
     * @notice Calculates the pending rewards for a specific user, without applying it.
     * This represents the slash amount that would be applied if updateUserState were called now.
     * @dev Determines rewards by:
     *      1. Multiplying user stake by outstanding rewards per share
     *      2. Applying precision factor to maintain calculation accuracy
     * @param user The address of the user to check pending rewards for
     * @return The amount of pending rewards available to the user, or 0 if none
     */
    function getPendingRewards(address user) external view returns (uint256) {
        uint256 userStake = stakedBalances[user];
        if (userStake > 0) {
            uint256 rewardOutstanding = cumulativeRewardPerShare - userRewardPerSharePaid[user];
            if (rewardOutstanding > 0) {
                return userStake * rewardOutstanding / PRECISION_FACTOR;
            }
        }
        return 0;
    }

    /**
     * @notice Calculates the total pending slash amount for a user based on their slashable stake, without applying it.
     * This represents the slash amount that would be applied if updateUserState were called now.
     * @dev Calculation is based on user's active stake + bonded unlocking chunks.
     * @param user The address of the user to query.
     * @return totalPendingSlash The total amount of tokens that would be slashed from the user's slashable assets.
     */
    function getPendingSlash(address user) external view returns (uint256) {
        uint256 userSlashableStake = this.getSlashableStake(user);
        if (userSlashableStake > 0) {
            uint256 slashOutstanding = cumulativeSlashPerShare - userSlashPerShareApplied[user];
            if (slashOutstanding > 0) {
                return userSlashableStake * slashOutstanding / PRECISION_FACTOR;
            }
        }
        return 0;
    }

    /**
     * @notice Calculates an estimated value of the total stake including all pending rewards and slashes
     * @dev Returns an approximation of what the total stake will be once all pending rewards and
     *      slashes are applied. The actual totalStake state variable is only updated when rewards
     *      and slashes are explicitly applied through distributeRewards or doSlash functions.
     *
     * The calculation uses the formula:
     *     (totalStake * (PRECISION_FACTOR + cumulativeRewardPerShare) - totalSlashableStake * cumulativeSlashPerShare) / PRECISION_FACTOR
     *
     * This formula accounts for:
     * - The base stake (`totalStake`)
     * - Accumulated rewards based on `totalStake` (tracked in cumulativeRewardPerShare)
     * - Accumulated slashes based on `totalSlashableStake` (tracked in cumulativeSlashPerShare)
     * - The precision factor to maintain calculation accuracy
     *
     * Note: If pending slashes exceed the base stake plus pending rewards, this calculation may revert due to underflow.
     *
     * @return uint256 The estimated total stake after applying all pending rewards and slashes
     *
     * @custom:accuracy This estimate is most accurate immediately following calls to distributeRewards
     *                  or doSlash, as these functions update the cumulative trackers.
     *
     * @custom:usage This function is useful for external systems that need the most up-to-date
     *               view of the vault's stake without waiting for reward/slash applications.
     */
    function getApproximatePendingTotalStake() external view returns (uint256) {
        uint256 scaledBasePlusRewards = totalStake * (PRECISION_FACTOR + cumulativeRewardPerShare);
        uint256 scaledPendingSlashes = totalSlashableStake * cumulativeSlashPerShare;
        return (scaledBasePlusRewards - scaledPendingSlashes) / PRECISION_FACTOR;
    }
}

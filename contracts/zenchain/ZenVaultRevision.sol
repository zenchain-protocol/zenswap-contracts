// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./interfaces/IZenVaultRevision.sol";
import "@uniswap/v2-core/contracts/interfaces/IUniswapV2Pair.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./Ownable.sol";
import "../../precompile-interfaces/INativeStaking.sol";

contract ZenVault is IZenVaultRevision, ReentrancyGuard, Ownable {
    // The liquidity pool token that can be staked in this vault.
    IUniswapV2Pair public pool;
    // The account that receives awards from consensus staking, on behalf of the vault, and distributes the rewards among the vault stakers.
    address public rewardAccount;
    // Affects precision of calculations. Used to prevent integer overflow.
    uint256 constant public PRECISION_FACTOR = 1e18;
    // The ZenChain NativeStaking precompile
    NativeStaking private nativeStaking = STAKING_CONTRACT;

    // --- STAKE RELATED ---
    // The total amount staked
    uint256 public totalStake;
    // Mapping of user addresses to their staked amounts.
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

        emit Staked(user, amount);
    }

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
            pool.transfer(user, totalToTransfer);
            emit Withdrawal(user, totalToTransfer);
        }
    }

    function updateUserState() external nonReentrant {
        _updateUserState(msg.sender);
    }

    function distributeRewards(uint256 rewardAmount) external onlyOwner {
        require(rewardAmount > 0, "Amount must be greater than zero.");
        require(rewardAccount != address(0), "Reward account not set.");
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

    function doSlash(uint256 slashAmount) external onlyOwner {
        require(totalStake > 0, "No stake to slash.");

        // Ensure slashAmount doesn't exceed totalStake to avoid totalStake underflow
        uint256 actualSlashAmount = slashAmount > totalStake ? totalStake : slashAmount;

        if (actualSlashAmount > 0) {
            // Increase cumulative slash proportionally based on current total stake
            uint256 slashRatio = actualSlashAmount * PRECISION_FACTOR / totalStake;
            cumulativeSlashPerShare += slashRatio;
            emit VaultSlashed(actualSlashAmount, cumulativeSlashPerShare, slashRatio);
        }
    }

    function _applySlashToUser(address user, uint256 slashOutstanding) internal {
        // Slash is proportional to current staked balance
        uint256 userStakeBeforeSlash = stakedBalances[user];
        uint256 pendingSlash = userStakeBeforeSlash * slashOutstanding / PRECISION_FACTOR;
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

            emit UserSlashApplied(user, pendingSlash, slashedFromStake, slashedFromUnlocking);
        }
    }

    function _applyRewardToUser(address user, uint256 rewardOutstanding) internal {
        uint256 userStakeBeforeReward = stakedBalances[user];
        if (userStakeBeforeReward > 0) {
            uint256 pendingReward = userStakeBeforeReward * rewardOutstanding / PRECISION_FACTOR;
            if (pendingReward > 0) {
                stakedBalances[user] += pendingReward;
                totalStake += pendingReward;
                emit RewardsRestaked(user, pendingReward);
            }
        }
    }

    /**
     * @notice Updates user's pending slashes and rewards based on global cumulative values.
     * @dev Should be called before any action that modifies stakedBalance or withdraws.
     */
    function _updateUserState(address user) internal {
        // Apply pending slash first, if any, to ensure user cannot be rewarded for stake that should have been slashed
        uint256 slashOutstanding = cumulativeSlashPerShare - userSlashPerShareApplied[user];
        if (slashOutstanding > 0) {
            _applySlashToUser(user, slashOutstanding);
            // Update user's applied slash level regardless of whether they had stake
            userSlashPerShareApplied[user] = cumulativeSlashPerShare;
        }
        // Apply pending rewards
        uint256 rewardOutstanding = cumulativeRewardPerShare - userRewardPerSharePaid[user];
        if (rewardOutstanding > 0) {
            _applyRewardToUser(user, rewardOutstanding);
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
     * @custom:usage This function is primarily used for emergency situations or
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


    function setMaxUnlockChunks(uint8 _maxUnlockChunks) external onlyOwner {
        require(_maxUnlockChunks > 0, "The maximum unlocking array length must be greater than 0.");
        maxUnlockChunks = _maxUnlockChunks;
        emit MaxUnlockChunksSet(_maxUnlockChunks);
    }

    // This should never be used, but is being added in case of emergency
    function setNativeStakingAddress(address _nativeStakingPrecompile) external onlyOwner {
        nativeStaking = NativeStaking(_nativeStakingPrecompile);
        emit NativeStakingAddressSet(_nativeStakingPrecompile);
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

    function getPendingRewards(address user) external view returns (uint256) {
        uint256 pendingSlash = this.getPendingSlash(user);
        uint256 currentUserStake = stakedBalances[user];
        uint256 eligibleUserStake = currentUserStake > pendingSlash ? currentUserStake - pendingSlash : 0;
        if (eligibleUserStake > 0) {
            uint256 rewardOutstanding = cumulativeRewardPerShare - userRewardPerSharePaid[user];
            if (rewardOutstanding > 0) {
                return eligibleUserStake * rewardOutstanding / PRECISION_FACTOR;
            }
        }
        return 0;
    }

    /**
     * @notice Calculates the total pending slash amount for a user without applying it.
     * @dev This represents the slash amount that would be applied if _updateUserState were called now.
     * @param user The address of the user to query.
     * @return totalPendingSlash The total amount of tokens that would be slashed.
     */
    function getPendingSlash(address user) external view returns (uint256) {
        // Calculate outstanding slash per share for the user
        uint256 slashOutstanding = cumulativeSlashPerShare - userSlashPerShareApplied[user];
        if (slashOutstanding == 0) {
            return 0;
        }

        uint256 userStake = stakedBalances[user];
        if (userStake == 0) {
            return 0;
        }

        return userStake * slashOutstanding / PRECISION_FACTOR;
    }

    // Returns an estimated value of totalStake after all pending slashes and pending rewards are applied.
    // This is useful because totalStake is only updated when rewards and slashes are actually applied.
    // This is only accurate immediately after a call to distributeRewards or doSlash.
    function getApproximatePendingTotalStake() external view returns (uint256) {
        return totalStake * (PRECISION_FACTOR + cumulativeRewardPerShare - cumulativeSlashPerShare) / PRECISION_FACTOR;
    }
}

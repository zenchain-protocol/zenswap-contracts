// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import '@uniswap/v2-core/contracts/interfaces/IUniswapV2Pair.sol';
import "../../../precompile-interfaces/INativeStaking.sol";

interface IZenVault {

// ------------------------------------------------------------
// Events
// ------------------------------------------------------------

    /**
     * @notice Emitted when a user stakes tokens in the vault
     * @dev This event is triggered when the stake() function successfully processes a deposit
     * @param user The address of the user who staked tokens (indexed for efficient filtering)
     * @param amount The quantity of tokens that were staked
     */
    event Staked(address indexed user, uint256 amount);

    /**
     * @notice Emitted when a user initiates the unstaking of tokens
     * @dev This event is triggered when tokens are moved from staked to unlocking state
     *      Note that this does not mean tokens are immediately withdrawn - they enter an unlocking queue
     * @param user The address of the user who initiated unstaking (indexed for efficient filtering)
     * @param amount The quantity of tokens that were unstaked
     */
    event Unstaked(address indexed user, uint256 amount);

    /**
     * @notice Emitted when a user withdraws unlocked tokens from the vault
     * @dev This event is triggered when previously unstaked tokens that have completed
     *      their unlocking period are withdrawn to the user's wallet
     * @param user The address of the user who withdrew tokens (indexed for efficient filtering)
     * @param amount The quantity of tokens that were withdrawn
     */
    event Withdrawal(address indexed user, uint256 amount);

    /**
     * @notice Emitted when rewards are added to the vault
     * @dev This event is triggered when new rewards are distributed to the vault,
     *      updating the cumulative reward metrics
     * @param rewardAmount The amount of rewards added to the vault
     * @param cumulativeRewardPerShare The updated cumulative reward per share after this addition
     * @param rewardRatio The ratio at which rewards are distributed for this addition
     */
    event VaultRewardsAdded(uint256 rewardAmount, uint256 cumulativeRewardPerShare, uint256 rewardRatio);

    /**
     * @notice Emitted when the vault is slashed
     * @dev This event is triggered when a slashing penalty is applied to the vault,
     *      updating the cumulative slash metrics
     * @param slashAmount The amount slashed from the vault
     * @param cumulativeSlashPerShare The updated cumulative slash per share after this slashing
     * @param slashRatio The ratio at which the slash is distributed for this penalty
     */
    event VaultSlashed(uint256 slashAmount, uint256 cumulativeSlashPerShare, uint256 slashRatio);

    /**
     * @notice Emitted when a user's rewards are automatically restaked
     * @dev This event is triggered when a user's pending rewards are compounded
     *      by being added back into their staked balance
     * @param user The address of the user whose rewards were restaked (indexed for efficient filtering)
     * @param pendingReward The amount of rewards that were restaked
     */
    event RewardsRestaked(address indexed user, uint256 pendingReward);

    /**
     * @notice Emitted when a slashing penalty is applied to a specific user
     * @dev This event is triggered when a user's stake is reduced due to a slash,
     *      detailing how the slash was distributed between their staked and unlocking balances
     * @param user The address of the user who was slashed (indexed for efficient filtering)
     * @param pendingSlash The total amount of slash pending for the user
     * @param slashedFromStake The amount slashed from the user's active stake
     * @param slashedFromUnlocking The amount slashed from the user's unlocking balance
     */
    event UserSlashApplied(
        address indexed user,
        uint256 pendingSlash,
        uint256 slashedFromStake,
        uint256 slashedFromUnlocking
    );

    /**
     * @notice Emitted when the reward account address is updated
     * @dev This event is triggered when the contract owner sets a new reward account address
     * @param account The address of the new reward account that will receive and distribute staking rewards
     */
    event RewardAccountSet(address account);

    /**
     * @notice Emitted when staking functionality is enabled or disabled on the vault
     * @dev This event is triggered when staking is turned on or off by the contract owner
     * @param _isStakingEnabled True if staking was enabled, false if staking was disabled.
     */
    event StakingEnabled(bool _isStakingEnabled);

    /**
     * @notice Emitted when withdrawal functionality is enabled or disabled on the vault
     * @dev This event is triggered when the contract owner toggles the ability to withdraw tokens
     * @param _isWithdrawEnabled True if withdrawals were enabled, false if withdrawals were disabled
     */
    event WithdrawEnabled(bool _isWithdrawEnabled);

    /**
     * @notice Emitted when the minimum staking requirement is updated
     * @dev This event is triggered when the contract owner changes the minimum amount required for staking
     * @param _minStake The new minimum amount of tokens required to stake
     */
    event MinStakeSet(uint256 _minStake);

    /**
     * @notice Emitted when the maximum number of unlock chunks is updated
     * @dev This event is triggered when the contract owner changes the limit on concurrent unlocking operations
     * @param _maxUnlockChunks The new maximum number of unlock chunks allowed per user
     */
    event MaxUnlockChunksSet(uint8 _maxUnlockChunks);

    /**
     * @notice Emitted when the native staking precompile address is updated
     * @dev This event is triggered when the contract owner sets a new address for the native staking contract
     * @param _nativeStakingPrecompile The new address of the native staking precompile contract
     */
    event NativeStakingAddressSet(address _nativeStakingPrecompile);

// ------------------------------------------------------------
// Structs
// ------------------------------------------------------------

    /**
     * @notice Represents a portion of staked tokens undergoing the unlocking process
     * @dev When users unstake their tokens, they enter an unlocking period before being withdrawable.
     *      Each unstaking action creates a new UnlockChunk that tracks the amount and when it becomes available.
     *      Multiple chunks may exist for a single user if they unstake multiple times.
     */
    struct UnlockChunk {
        /** @dev The quantity of tokens in this unlocking chunk */
        uint256 value;
        /**
         * @dev The era number when these tokens become fully unlocked and withdrawable
         * @notice Tokens cannot be withdrawn until the current era exceeds this value
         */
        uint32 era;
    }

// ------------------------------------------------------------
// Public state variable view methods
// ------------------------------------------------------------

    /**
     * @notice Returns the Uniswap V2 pair contract associated with this vault
     * @dev This pair contract represents the liquidity pool tokens that can be staked in the vault
     * @return The IUniswapV2Pair interface of the associated liquidity pool
     */
    function pool() external view returns (IUniswapV2Pair);

    /**
     * @notice Returns the address that receives staking rewards on behalf of the vault
     * @dev This account is responsible for collecting and distributing rewards to vault stakers
     * @return The address of the reward account
     */
    function rewardAccount() external view returns (address);

    /**
     * @notice Returns the precision factor used in reward and slash calculations
     * @dev This constant (1e18) prevents integer overflow in mathematical operations
     * @return uint256 The precision factor value (1e18)
     */
    function PRECISION_FACTOR() external view returns (uint256);


    /**
     * @notice Returns the NativeStaking precompile contract used by the vault
     * @dev This contract is used for era tracking and managing staking parameters like bonding duration
     * @return The NativeStaking precompile interface that handles the native token staking on ZenChain
     */
    function nativeStaking() external view returns (NativeStaking);

    /**
     * @notice Returns the total amount of tokens staked in the vault
     * @dev This value represents the sum of all user stakes, excluding pending rewards and slashes
     * @return The total staked amount in the vault
     */
    function totalStake() external view returns (uint256);

    /**
     * @notice Returns the total amount of tokens staked in the vault that is eligible for slashing
     * @dev This value represents the sum of all user stakes, plus unlocking chunks within the bonding duration
     * @return The total staked amount in the vault
     */
    function totalSlashableStake() external view returns (uint256);

    /**
     * @notice Returns the current staked balance for a user
     * @dev Retrieves the total amount of tokens actively staked by an account, excluding pending rewards and slashes
     * @param account The address of the staker
     * @return The total amount of tokens staked by the account
     */
    function stakedBalances(address account) external view returns (uint256);

    /**
     * @notice Returns information about a user's unlocking token chunk
     * @dev Retrieves data about tokens in the process of unlocking for withdrawal
     * @param account The address of the staker
     * @param index The index of the unlock chunk in the user's array of unlocking tokens
     * @return value The amount of tokens in the unlocking chunk
     * @return era The era when the unlocking process started
     */
    function unlocking(address account, uint256 index) external view returns (uint256 value, uint32 era);

    /**
     * @notice Returns the total accumulated rewards per share in the vault
     * @dev This value increases each time rewards are distributed to the vault
     *      and is used to calculate individual user rewards
     * @return The current cumulative reward per share value (scaled by PRECISION_FACTOR)
     */
    function cumulativeRewardPerShare() external view returns (uint256);

    /**
     * @notice Returns the last reward-per-share value that was paid to a user
     * @dev Used to track which portion of global rewards have already been accounted for a specific user
     * @param user The address of the staker to check
     * @return The last reward-per-share value applied to the user (scaled by PRECISION_FACTOR)
     */
    function userRewardPerSharePaid(address user) external view returns (uint256);

    /**
     * @notice Returns the total accumulated slashes per share in the vault
     * @dev This value increases each time the vault is slashed and is used
     *      to calculate individual user slash amounts
     * @return The current cumulative slash per share value (scaled by PRECISION_FACTOR)
     */
    function cumulativeSlashPerShare() external view returns (uint256);

    /**
     * @notice Returns the last slash-per-share value that was applied to a user
     * @dev Used to track which portion of global slashes have already been accounted for a specific user
     * @param user The address of the staker to check
     * @return The last slash-per-share value applied to the user (scaled by PRECISION_FACTOR)
     */
    function userSlashPerShareApplied(address user) external view returns (uint256);

    /**
     * @notice Returns whether staking is currently enabled in the vault
     * @dev Indicates if new stake deposits are permitted at the current time
     * @return True if staking is enabled, false otherwise
     */
    function isStakingEnabled() external view returns (bool);

    /**
     * @notice Returns whether token withdrawals are currently enabled
     * @dev This status is controlled by the contract owner and affects the ability of users to withdraw their tokens
     * @return True if withdrawals are enabled, false if withdrawals are disabled
     */
    function isWithdrawEnabled() external view returns (bool);

    /**
     * @notice Returns the minimum amount of tokens required for staking
     * @dev This value enforces a lower bound on stake amounts to prevent dust balances
     * @return The minimum amount of tokens that can be staked in a single transaction
     */
    function minStake() external view returns (uint256);

    /**
     * @notice Returns the maximum number of unlock chunks a user can have simultaneously
     * @dev This value limits the size of a user's unlocking array to prevent DoS attacks
     * @return The maximum number of unstaking operations a user can have in the unlocking state
     */
    function maxUnlockChunks() external view returns (uint8);

// ------------------------------------------------------------
// Transaction (mutation) methods
// ------------------------------------------------------------

    /**
     * @notice Stakes tokens in the vault
     * @dev Transfers tokens from user to vault and records stake position
     * @param amount The quantity of tokens to stake
     */
    function stake(uint256 amount) external;

    /**
     * @notice Initiates token unstaking process
     * @dev Moves tokens from staked to unlocking state with a bonding period
     * @param amount The quantity of tokens to unstake
     */
    function unstake(uint256 amount) external;

    /**
     * @notice Withdraws tokens that have completed the unlocking period
     * @dev Allows users to claim tokens that have finished the required unbonding time
     */
    function withdrawUnlocked() external;

    /**
     * @notice Updates the user's state by applying pending rewards and slashes
     * @dev This function processes any accumulated rewards and slashes for a user,
     *      bringing their account state up to date with the current global state.
     *      It calculates pending rewards based on cumulativeRewardPerShare
     *      and pending slashes based on cumulativeSlashPerShare.
     */
    function updateUserState() external;

    /**
     * @notice Distributes rewards to all stakers in the vault
     * @dev Updates the cumulativeRewardPerShare based on the provided reward amount,
     *      which will be proportionally distributed among stakers.
     *      When a user interacts with the vault after this call, their rewards will be calculated
     *      based on the updated cumulative value.
     * @param rewardAmount The amount of rewards to distribute across all stakers
     */
    function distributeRewards(uint256 rewardAmount) external;

    /**
     * @notice Applies a slashing penalty to all stakers in the vault
     * @dev Updates the cumulativeSlashPerShare based on the provided slash amount,
     *      which will be proportionally applied to all stakers.
     *      The actual reduction in a user's stake happens when they interact with the vault
     *      or when updateUserState is called for their address.
     * @param slashAmount The amount to slash from the total staked value
     */
    function doSlash(uint256 slashAmount) external;

    /**
     * @notice Enables or disables token staking functionality
     * @dev Controls whether new stakes can be accepted by the vault
     * @param isEnabled True to enable staking, false to disable it
     */
    function setIsStakingEnabled(bool isEnabled) external;

    /**
     * @notice Enables or disables stake withdrawals
     * @dev Controls whether new withdrawal requests can be accepted by the vault
     * @param isEnabled True to enable withdrawals, false to disable it
     */
    function setIsWithdrawEnabled(bool isEnabled) external;

    /**
     * @notice Updates the reward account address for the vault
     * @dev This function allows changing the address that receives and distributes staking rewards
     * @param _rewardAccount The new address to be set as the reward account
     */
    function setRewardAccount(address _rewardAccount) external;

    /**
     * @notice Sets the minimum amount required to stake in the vault
     * @dev Updates the minimum staking threshold and emits a MinStakeSet event
     * @param _minStake The new minimum staking amount
     */
    function setMinStake(uint256 _minStake) external;

    /**
     * @notice Sets the maximum number of unlock chunks a user can have
     * @dev Limits the number of concurrent unstaking operations per user
     * @param _maxUnlockChunks The new maximum number of unlock chunks allowed
     */
    function setMaxUnlockChunks(uint8 _maxUnlockChunks) external;

    /**
     * @notice Updates the address of the native staking precompile contract
     * @dev Changes the contract that handles native chain staking operations
     * @param _nativeStakingPrecompile The address of the new native staking contract
     */
    function setNativeStakingAddress(address _nativeStakingPrecompile) external;

// ------------------------------------------------------------
// User-defined view methods
// ------------------------------------------------------------

    /**
     * @notice Retrieves all unlocking chunks for a specific user
     * @dev Returns the full array of UnlockChunk structs that represent tokens in the unlocking process
     * @param user The address of the user to query unlocking chunks for
     * @return An array of UnlockChunk structs containing information about the user's unlocking tokens
     */
    function getUnlockingChunks(address user) external view returns (UnlockChunk[] memory);

    /**
     * @notice Returns the total amount of a user's stake that is eligible for slashing
     * @dev This includes both the user's actively staked balance and any tokens in the unlocking queue.
     * Used for calculating a user's exposure to potential slashing penalties.
     * @param user The address of the user to check
     * @return The total amount of the user's stake subject to slashing penalties
     */
    function getSlashableStake(address user) external view returns (uint256);

    /**
     * @notice Returns the amount of unclaimed rewards for a specific user
     * @dev Calculates rewards based on the user's stake and the current reward metrics
     * @param user The address of the user to check
     * @return The amount of pending rewards that can be claimed or restaked
     */
    function getPendingRewards(address user) external view returns (uint256);

    /**
     * @notice Returns the amount of pending slash for a specific user
     * @dev Calculates the slash amount that will be applied to the user's stake on their next interaction
     * @param user The address of the user to check
     * @return The amount of pending slash to be applied
     */
    function getPendingSlash(address user) external view returns (uint256);

    /**
     * @notice Returns an estimate of the total stake including pending rewards and slashes
     * @dev This is an approximation as it doesn't account for all individual user state updates
     * @return The approximate total value of all stakes in the vault after rewards and slashes
     */
    function getApproximatePendingTotalStake() external view returns (uint256);
}
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import '@uniswap/v2-core/contracts/interfaces/IUniswapV2Pair.sol';

interface IZenVaultRevision {

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
     *      Note that this does not mean tokens are immediately withdrawn - they enter an unlocking period
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

    event VaultRewardsAdded(uint256 rewardAmount, uint256 cumulativeRewardPerShare, uint256 rewardRatio);

    event VaultSlashed(uint256 slashAmount, uint256 cumulativeSlashPerShare, uint256 slashRatio);

    event RewardsRestaked(address user, uint256 pendingReward);

    event UserSlashApplied(
        address user,
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

    event MinStakeSet(uint256 _minStake);

    event MaxUnlockChunksSet(uint8 _maxUnlockChunks);

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
         * @notice Tokens cannot be withdrawn until the current era reaches or exceeds this value
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

    function PRECISION_FACTOR() external view returns (uint256);

    /**
     * @notice Returns the current total amount of tokens staked in the vault
     * @dev Retrieves the aggregate sum of all users' staked balances
     * @return The total amount of tokens currently staked in the vault
     */
    function totalStake() external view returns (uint256);

    /**
     * @notice Returns the current staked balance for a user
     * @dev Retrieves the total amount of tokens actively staked by an account
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

    function cumulativeRewardPerShare() external view returns (uint256);

    function userRewardPerSharePaid(address user) external view returns (uint256);

    function cumulativeSlashPerShare() external view returns (uint256);

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

    function updateUserState() external;

    /**
     * @notice Distributes rewards to stakers for a specific era
     * @dev Called by the contract owner to distribute staking rewards to the vault
     *      Triggers VaultRewardsDistributed event and calculates individual user rewards
     * @param rewardAmount The total amount of rewards to distribute
     */
    function distributeRewards(uint256 rewardAmount) external;

    /**
     * @notice Applies a slashing penalty to the vault
     * @dev Reduces staked tokens proportionally across users due to validator misbehavior
     * @param slashAmount The total amount of tokens to slash from the vault
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

    function setMinStake(uint256 _minStake) external;

    function setMaxUnlockChunks(uint8 _maxUnlockChunks) external;

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
    function getUserUnlockingChunks(address user) external view returns (UnlockChunk[] memory);

    function getPendingRewards(address user) external view returns (uint256);

    function getPendingSlash(address user) external view returns (uint256);
}

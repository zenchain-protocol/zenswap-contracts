// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import '@uniswap/v2-core/contracts/interfaces/IUniswapV2Pair.sol';

interface IZenVault {

// ------------------------------------------------------------
// Events
// ------------------------------------------------------------

    /**
     * @notice Emitted when staking functionality is enabled or disabled on the vault
     * @dev This event is triggered when staking is turned on or off by the contract owner
     * @param isEnabled True if staking was enabled, false if staking was disabled.
     */
    event StakingEnabled(bool isEnabled);

    /**
     * @notice Emitted when withdrawal functionality is enabled or disabled on the vault
     * @dev This event is triggered when the contract owner toggles the ability to withdraw tokens
     * @param isEnabled True if withdrawals were enabled, false if withdrawals were disabled
     */
    event WithdrawEnabled(bool isEnabled);

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

    /**
     * @notice Emitted when exposure data for an era is recorded
     * @dev This event is triggered when the recordEraStake function captures the staking state for an era
     *      This information is crucial for proper reward distribution and slash calculations
     * @param era The era for which exposure was recorded (indexed for efficient filtering)
     * @param totalStake The total amount staked in the vault at the time of recording
     */
    event EraExposureRecorded(uint32 indexed era, uint256 totalStake);

    /**
     * @notice Emitted when rewards are distributed to the vault and its stakers.
     * @dev This event is triggered when the distributeRewards function successfully allocates rewards to the vault
     * @param era The era for which rewards are distributed (indexed for efficient filtering)
     * @param reward_amount The total amount of tokens distributed as rewards
     */
    event VaultRewardsDistributed(uint32 indexed era, uint256 reward_amount);

    /**
     * @notice Emitted when rewards are distributed to an individual user
     * @dev This event is triggered for each user when rewards are calculated and allocated based on their stake
     * @param user The address of the user receiving rewards (indexed for efficient filtering)
     * @param era The era for which the user is receiving rewards (indexed for efficient filtering)
     * @param reward_amount The amount of tokens distributed to the user
     */
    event UserRewardsDistributed(address indexed user, uint32 indexed era, uint256 reward_amount);

    /**
     * @notice Emitted when the vault is slashed
     * @dev This event is triggered when tokens are removed from the vault due to validator misbehavior
     *      or other slashing conditions. The slashing amount is deducted from the total stake.
     * @param era The era in which the slash occurred (indexed for efficient filtering)
     * @param slash_amount The total amount of tokens that were slashed from the vault
     */
    event VaultSlashed(uint32 indexed era, uint256 slash_amount);

    /**
     * @notice Emitted when an individual user's stake is slashed
     * @dev This event is triggered for each user affected when a vault slash is distributed
     *      proportionally among stakers. It provides transparency on how much each user was slashed.
     * @param user The address of the user whose stake was slashed (indexed for efficient filtering)
     * @param era The era in which the slash occurred (indexed for efficient filtering)
     * @param slash_amount The amount of tokens slashed from this specific user's stake
     */
    event UserSlashed(address indexed user, uint32 indexed era, uint256 slash_amount);

    /**
     * @notice Emitted when the reward account address is updated
     * @dev This event is triggered when the contract owner sets a new reward account address
     * @param account The address of the new reward account that will receive and distribute staking rewards
     */
    event RewardAccountUpdated(address account);

    /**
     * @notice Emitted when the vault is initialized with a pool and reward account
     * @dev This event is triggered once when the initialize function is called by the contract owner
     * @param pool The address of the Uniswap V2 pair contract used as the staking token
     * @param rewardAccount The address that will receive and distribute rewards to vault stakers
     */
    event VaultInitialized(address pool, address rewardAccount);

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

    /**
     * @notice Records a user's staking position for a specific era
     * @dev This data structure is used to track historical staking positions which are
     *      essential for proper reward distribution and proportional slashing calculations.
     *      The vault maintains these records for each era to ensure accurate accounting.
     */
    struct EraExposure {
        /**
         * @dev The address of the user who has staked tokens
         * @notice Each unique address represents a distinct staker in the system
         */
        address staker;
        /**
         * @dev The total amount of tokens this user had staked during the specified era
         * @notice This value may differ across eras as users stake or unstake tokens
         */
        uint256 value;
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
     * @notice Returns information about a user's unlocking token chunk
     * @dev Retrieves data about tokens in the process of unlocking for withdrawal
     * @param account The address of the staker
     * @param index The index of the unlock chunk in the user's array of unlocking tokens
     * @return value The amount of tokens in the unlocking chunk
     * @return era The era when the unlocking process started
     */
    function unlocking(address account, uint256 index) external view returns (uint256 value, uint32 era);

    /**
     * @notice Returns the current staked balance for a user
     * @dev Retrieves the total amount of tokens actively staked by an account
     * @param account The address of the staker
     * @return The total amount of tokens staked by the account
     */
    function stakedBalances(address account) external view returns (uint256);

    /**
     * @notice Returns the total amount staked in the vault at a specific era
     * @dev Used for historical tracking of stake amounts across different eras
     * @param era The era number to query
     * @return The total amount staked in the vault during the specified era
     */
    function totalStakeAtEra(uint32 era) external view returns (uint256);

    /**
     * @notice Returns exposure information for a specific era and staker index
     * @dev Provides details about individual stakers' exposures recorded for a particular era
     * @param era The era number to query
     * @param index The index in the era's exposure array
     * @return staker The address of the staker
     * @return value The amount staked by this staker in the specified era
     */
    function eraExposures(uint32 era, uint256 index) external view returns (address staker, uint256 value);

    /**
     * @notice Returns the current total amount of tokens staked in the vault
     * @dev Retrieves the aggregate sum of all users' staked balances
     * @return The total amount of tokens currently staked in the vault
     */
    function totalStake() external view returns (uint256);

    /**
     * @notice Returns the most recent era when the vault was updated
     * @dev Used to track when stake data was last recorded in the vault
     * @return The era number of the last vault update
     */
    function lastEraUpdate() external view returns (uint32);

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
     * @notice Returns the address that receives staking rewards on behalf of the vault
     * @dev This account is responsible for collecting and distributing rewards to vault stakers
     * @return The address of the reward account
     */
    function rewardAccount() external view returns (address);

// ------------------------------------------------------------
// Transaction (mutation) methods
// ------------------------------------------------------------

    /**
     * @notice Initializes the vault with a Uniswap V2 liquidity pair address and reward account
     * @dev Can only be called once by the contract owner to set the LP token and reward account
     * @param _pairAddress The address of the Uniswap V2 pair contract to be used as the staking token
     * @param _rewardAccount The address that receives and distributes consensus staking rewards
     */
    function initialize(address _pairAddress, address _rewardAccount) external;

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
     * @notice Records the vault's total stake for the current era
     * @dev Updates staking snapshots used for rewards and slashing calculations
     */
    function recordEraStake() external;

    /**
     * @notice Distributes rewards to stakers for a specific era
     * @dev Called by the contract owner to distribute staking rewards to the vault
     *      Triggers VaultRewardsDistributed event and calculates individual user rewards
     * @param reward_amount The total amount of rewards to distribute
     * @param era The era for which rewards are being distributed
     */
    function distributeRewards(uint256 reward_amount, uint32 era) external;

    /**
     * @notice Applies a slashing penalty to the vault
     * @dev Reduces staked tokens proportionally across users due to validator misbehavior
     * @param slash_amount The total amount of tokens to slash from the vault
     * @param era The era in which the slashing occurred
     */
    function doSlash(uint256 slash_amount, uint32 era) external;

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
}

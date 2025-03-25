pragma solidity ^0.8.20;

import '@uniswap/v2-core/contracts/interfaces/IUniswapV2Pair.sol';

interface IZenVault is IUniswapV2Pair {

// ------------------------------------------------------------
// Events
// ------------------------------------------------------------

    /**
     * @notice Emitted when staking functionality is enabled on the vault
     * @dev This event is triggered when staking is turned on, typically by the contract owner
     * @param era The current era when staking was enabled
     */
    event StakingEnabled(uint32 era);

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
     * @notice Records the vault's total stake for a specific era
     * @dev Updates staking snapshots used for rewards and slashing calculations
     * @param era The era number for which to record stake data
     */
    function recordEraStake(uint32 era) external;

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
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title MockStakingPrecompile
 * @dev A contract that will be deployed at the STAKING_ADDRESS (0x0000000000000000000000000000000000000800)
 * in the test environment to mock the NativeStaking precompile.
 */
contract MockStakingPrecompile {
    uint32 private _currentEra;
    uint32 private _bondingDuration;

    constructor(uint32 initialEra, uint32 initialBondingDuration) {
        _currentEra = initialEra;
        _bondingDuration = initialBondingDuration;
    }

    /**
     * @notice Returns the current era.
     * @return The current era index.
     */
    function currentEra() external view returns (uint32) {
        return _currentEra;
    }

    /**
     * @notice Returns the bonding duration in number of eras.
     * @return The bonding duration.
     */
    function bondingDuration() external view returns (uint32) {
        return _bondingDuration;
    }

    /**
     * @notice Advances the current era by the specified number of eras.
     * @dev This function is only available in the mock for testing purposes.
     * @param eras Number of eras to advance.
     */
    function advanceEra(uint32 eras) external {
        _currentEra += eras;
    }

    /**
     * @notice Sets the bonding duration to a new value.
     * @dev This function is only available in the mock for testing purposes.
     * @param newBondingDuration The new bonding duration.
     */
    function setBondingDuration(uint32 newBondingDuration) external {
        _bondingDuration = newBondingDuration;
    }
}
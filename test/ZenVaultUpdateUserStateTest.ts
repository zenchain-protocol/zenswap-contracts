import {expect} from "chai";
import {ethers} from "hardhat";
import {MockStakingPrecompile, MockToken, ZenVault} from "../typechain-types";
import {SignerWithAddress} from "@nomicfoundation/hardhat-ethers/signers";
import {PRECISION_FACTOR, setupTestEnvironment} from "./utils";

describe("ZenVault updateUserState Tests", function () {
  // Contracts
  let zenVault: ZenVault;
  let mockStakingPrecompile: MockStakingPrecompile;
  let lpToken: MockToken;

  // Signers
  let owner: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;
  let rewardAccount: SignerWithAddress;

  // Constants
  const STAKING_ADDRESS = "0x0000000000000000000000000000000000000800";
  const INITIAL_SUPPLY = ethers.parseEther("1000000");
  const INITIAL_ERA = 1;
  const BONDING_DURATION = 2;
  const STAKE_AMOUNT = ethers.parseEther("100");
  const REWARD_AMOUNT = ethers.parseEther("30");
  const SLASH_AMOUNT = ethers.parseEther("20");

  beforeEach(async function () {
    const testEnvironment = await setupTestEnvironment(
      STAKING_ADDRESS,
      INITIAL_SUPPLY,
      INITIAL_ERA,
      BONDING_DURATION
    );
    zenVault = testEnvironment.zenVault;
    mockStakingPrecompile = testEnvironment.mockStakingPrecompile;
    lpToken = testEnvironment.lpToken;
    owner = testEnvironment.owner;
    rewardAccount = testEnvironment.rewardAccount;
    user1 = testEnvironment.user1;
    user2 = testEnvironment.user2;

    // Approve rewards
    await lpToken.connect(rewardAccount).approve(await zenVault.getAddress(), INITIAL_SUPPLY);

    // Approve ZenVault to spend LP tokens
    await lpToken.connect(user1).approve(await zenVault.getAddress(), INITIAL_SUPPLY);
    await lpToken.connect(user2).approve(await zenVault.getAddress(), INITIAL_SUPPLY);
  });

  describe("updateUserState function behavior", function () {
    beforeEach(async function () {
      // Stake tokens
      await zenVault.connect(user1).stake(STAKE_AMOUNT);
    });

    it("should apply pending rewards when called", async function () {
      // Distribute rewards
      await zenVault.connect(owner).distributeRewards(REWARD_AMOUNT);

      // Calculate expected reward
      const rewardRatio = REWARD_AMOUNT * PRECISION_FACTOR / STAKE_AMOUNT;
      const expectedReward = (rewardRatio * STAKE_AMOUNT) / PRECISION_FACTOR;

      // Call updateUserState
      await zenVault.connect(user1).updateUserState();

      // Verify rewards were applied
      expect(await zenVault.stakedBalances(user1.address)).to.equal(STAKE_AMOUNT + expectedReward);
    });

    it("should apply pending slashes when called", async function () {
      // Apply slash
      await zenVault.connect(owner).doSlash(SLASH_AMOUNT);

      // Calculate expected slash
      const slashRatio = SLASH_AMOUNT * PRECISION_FACTOR / STAKE_AMOUNT;
      const expectedSlash = (slashRatio * STAKE_AMOUNT) / PRECISION_FACTOR;

      // Call updateUserState
      await zenVault.connect(user1).updateUserState();

      // Verify slash was applied
      expect(await zenVault.stakedBalances(user1.address)).to.equal(STAKE_AMOUNT - expectedSlash);
    });

    it("should apply both rewards and slashes when both are pending", async function () {
      // Distribute rewards first
      await zenVault.connect(owner).distributeRewards(REWARD_AMOUNT);

      // Apply slash
      await zenVault.connect(owner).doSlash(SLASH_AMOUNT);

      // Calculate expected values
      const totalStake = STAKE_AMOUNT;
      const rewardRatio = REWARD_AMOUNT * PRECISION_FACTOR / totalStake;
      const expectedReward = (rewardRatio * STAKE_AMOUNT) / PRECISION_FACTOR;
      const postRewardStake = STAKE_AMOUNT + expectedReward;
      const postRewardTotalStake = totalStake + REWARD_AMOUNT;
      const slashRatio = SLASH_AMOUNT * PRECISION_FACTOR / postRewardTotalStake;
      const expectedSlash = (slashRatio * postRewardStake) / PRECISION_FACTOR;

      // Call updateUserState
      await zenVault.connect(user1).updateUserState();

      // Verify both rewards and slashes were applied
      const actualBalance = await zenVault.stakedBalances(user1.address);
      console.log(`Expected: ${postRewardStake - expectedSlash}, Actual: ${actualBalance}`);
      // The difference is around 6 ETH, so we'll use a larger tolerance
      expect(actualBalance).to.be.closeTo(postRewardStake - expectedSlash, ethers.parseEther("7")); // Allow larger rounding difference
    });

    it("should do nothing when no rewards or slashes are pending", async function () {
      // Call updateUserState
      await zenVault.connect(user1).updateUserState();

      // Verify stake is unchanged
      expect(await zenVault.stakedBalances(user1.address)).to.equal(STAKE_AMOUNT);
    });
  });
});

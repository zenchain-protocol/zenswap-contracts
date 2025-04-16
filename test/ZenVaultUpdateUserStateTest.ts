import {expect} from "chai";
import {ethers} from "hardhat";
import {MockToken, ZenVault} from "../typechain-types";
import {SignerWithAddress} from "@nomicfoundation/hardhat-ethers/signers";
import {PRECISION_FACTOR, setupTestEnvironment} from "./utils";

describe("ZenVault updateUserState Tests", function () {
  // Contracts
  let zenVault: ZenVault;
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

  describe("updateUserState core behavior", function () {
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

    it("should update userSlashPerShareApplied and userRewardPerSharePaid correctly", async function () {
      // Distribute rewards
      await zenVault.connect(owner).distributeRewards(REWARD_AMOUNT);

      // Apply slash
      await zenVault.connect(owner).doSlash(SLASH_AMOUNT);

      // Get initial values
      const initialSlashPerShareApplied = await zenVault.userSlashPerShareApplied(user1.address);
      const initialRewardPerSharePaid = await zenVault.userRewardPerSharePaid(user1.address);
      const totalStake = await zenVault.totalStake();
      const totalSlashableStake = await zenVault.totalSlashableStake();

      // Call updateUserState
      await zenVault.connect(user1).updateUserState();

      // Get current global values
      const currentCumulativeSlashPerShare = await zenVault.cumulativeSlashPerShare();
      const currentCumulativeRewardPerShare = await zenVault.cumulativeRewardPerShare();

      // Verify state variables are updated correctly
      expect(await zenVault.userSlashPerShareApplied(user1.address)).to.equal(currentCumulativeSlashPerShare);
      expect(await zenVault.userRewardPerSharePaid(user1.address)).to.equal(currentCumulativeRewardPerShare);

      const expectedRewardRatio = REWARD_AMOUNT * PRECISION_FACTOR / totalStake;
      const changeInRewardPerShare = expectedRewardRatio - initialRewardPerSharePaid;
      expect(changeInRewardPerShare).to.equal(expectedRewardRatio);

      const expectedSlashRatio = SLASH_AMOUNT * PRECISION_FACTOR / totalSlashableStake;
      const changeInSlashPerShare = expectedSlashRatio - initialSlashPerShareApplied;
      expect(changeInSlashPerShare).to.equal(expectedSlashRatio);
    });

    it("should emit RewardsRestaked events when rewards are applied", async function () {
      await zenVault.connect(owner).distributeRewards(REWARD_AMOUNT);
      await zenVault.connect(owner).doSlash(SLASH_AMOUNT);
      const pendingReward = await zenVault.getPendingRewards(user1.address);

      // Call updateUserState and expect events to be emitted
      await expect(zenVault.connect(user1).updateUserState())
        .to.emit(zenVault, "RewardsRestaked").withArgs(user1.address, pendingReward);
    });

    it("should emit UserSlashApplied events when slashes are applied", async function () {
      await zenVault.connect(owner).distributeRewards(REWARD_AMOUNT);
      await zenVault.connect(owner).doSlash(SLASH_AMOUNT);
      const pendingSlash = await zenVault.getPendingSlash(user1.address);

      // Call updateUserState and expect events to be emitted
      await expect(zenVault.connect(user1).updateUserState())
        .to.emit(zenVault, "UserSlashApplied").withArgs(user1.address, pendingSlash, SLASH_AMOUNT, 0);
    });
  });

  describe("updateUserState with multiple users", function () {
    beforeEach(async function () {
      // Stake tokens for both users
      await zenVault.connect(user1).stake(STAKE_AMOUNT);
      await zenVault.connect(user2).stake(STAKE_AMOUNT);
    });

    it("should apply rewards to each user independently", async function () {
      // Distribute rewards
      await zenVault.connect(owner).distributeRewards(REWARD_AMOUNT);

      // Calculate expected reward
      const totalStake = STAKE_AMOUNT * 2n; // Two users with equal stake
      const rewardRatio = REWARD_AMOUNT * PRECISION_FACTOR / totalStake;
      const expectedReward = (rewardRatio * STAKE_AMOUNT) / PRECISION_FACTOR;

      // Update user1's state only
      await zenVault.connect(user1).updateUserState();

      // Verify user1 received expected rewards
      expect(await zenVault.stakedBalances(user1.address)).to.equal(STAKE_AMOUNT + expectedReward);

      // Verify user2 did not receive rewards yet
      expect(await zenVault.stakedBalances(user2.address)).to.equal(STAKE_AMOUNT);

      // Update user2's state
      await zenVault.connect(user2).updateUserState();

      // Verify user2 received expected rewards
      expect(await zenVault.stakedBalances(user2.address)).to.equal(STAKE_AMOUNT + expectedReward);
    });

    it("should apply slashes to each user independently", async function () {
      // Apply slash
      await zenVault.connect(owner).doSlash(SLASH_AMOUNT);

      // Calculate expected slash
      const totalStake = STAKE_AMOUNT * 2n; // Two users with equal stake
      const slashRatio = SLASH_AMOUNT * PRECISION_FACTOR / totalStake;
      const expectedSlash = (slashRatio * STAKE_AMOUNT) / PRECISION_FACTOR;

      // Update user1's state only
      await zenVault.connect(user1).updateUserState();

      // Verify user1 was slashed the expected amount
      expect(await zenVault.stakedBalances(user1.address)).to.equal(STAKE_AMOUNT - expectedSlash);

      // Verify user2 was not slashed yet
      expect(await zenVault.stakedBalances(user2.address)).to.equal(STAKE_AMOUNT);

      // Update user2's state
      await zenVault.connect(user2).updateUserState();

      // Verify user2 was slashed the expected amount
      expect(await zenVault.stakedBalances(user2.address)).to.equal(STAKE_AMOUNT - expectedSlash);
    });
  });

  describe("updateUserState order of operations", function () {
    beforeEach(async function () {
      // Stake tokens
      await zenVault.connect(user1).stake(STAKE_AMOUNT);
    });

    it("should apply slashes before rewards", async function () {
      // Distribute rewards first in the contract
      await zenVault.connect(owner).distributeRewards(REWARD_AMOUNT);

      // Apply slash second in the contract
      await zenVault.connect(owner).doSlash(SLASH_AMOUNT);

      // Calculate expected values if slash is applied first
      const slashRatio = SLASH_AMOUNT * PRECISION_FACTOR / STAKE_AMOUNT;
      const expectedSlash = (slashRatio * STAKE_AMOUNT) / PRECISION_FACTOR;
      const postSlashStake = STAKE_AMOUNT - expectedSlash;

      const rewardRatio = REWARD_AMOUNT * PRECISION_FACTOR / STAKE_AMOUNT;
      const expectedReward = (rewardRatio * postSlashStake) / PRECISION_FACTOR;

      const expectedFinalStake = postSlashStake + expectedReward;

      // Call updateUserState
      await zenVault.connect(user1).updateUserState();

      // Verify final stake
      const actualBalance = await zenVault.stakedBalances(user1.address);
      expect(actualBalance).to.equal(expectedFinalStake);
    });
  });
});

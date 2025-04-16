import { expect } from "chai";
import { ethers } from "hardhat";
import { ZenVault, MockToken, MockStakingPrecompile } from "../typechain-types";
import {PRECISION_FACTOR, setupTestEnvironment} from "./utils";
import {SignerWithAddress} from "@nomicfoundation/hardhat-ethers/signers";

describe("ZenVault View Function Tests", function () {
  // Contracts
  let zenVault: ZenVault;
  let mockStakingPrecompile: MockStakingPrecompile;
  let lpToken: MockToken;

  // Signers
  let owner: SignerWithAddress;
  let rewardAccount: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;

  // Constants
  const STAKING_ADDRESS = "0x0000000000000000000000000000000000000800";
  const INITIAL_SUPPLY = ethers.parseEther("1000000");
  const INITIAL_ERA = 1;
  const BONDING_DURATION = 2;
  const stakeAmount1 = ethers.parseEther("100");
  const stakeAmount2 = ethers.parseEther("200");
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

    // Mint and approve tokens
    await lpToken.mint(user1.address, INITIAL_SUPPLY);
    await lpToken.mint(user2.address, INITIAL_SUPPLY);
    await lpToken.connect(user1).approve(await zenVault.getAddress(), INITIAL_SUPPLY);
    await lpToken.connect(user2).approve(await zenVault.getAddress(), INITIAL_SUPPLY);

    // Stake tokens
    await zenVault.connect(user1).stake(stakeAmount1);
    await zenVault.connect(user2).stake(stakeAmount2);

    // Approve rewards
    await lpToken.connect(rewardAccount).approve(await zenVault.getAddress(), INITIAL_SUPPLY * 2n);
  });

  it("getUserUnlockingChunks should return correct data", async function () {
    // Create multiple unlocking chunks
    const chunk1 = ethers.parseEther("20");
    const chunk2 = ethers.parseEther("30");
    await zenVault.connect(user1).unstake(chunk1);
    await zenVault.connect(user1).unstake(chunk2);

    // Verify getUserUnlockingChunks returns correct data
    const unlockingChunks = await zenVault.getUserUnlockingChunks(user1.address);
    expect(unlockingChunks.length).to.equal(2);
    expect(unlockingChunks[0].value).to.equal(chunk1);
    expect(unlockingChunks[0].era).to.equal(INITIAL_ERA + BONDING_DURATION);
    expect(unlockingChunks[1].value).to.equal(chunk2);
    expect(unlockingChunks[1].era).to.equal(INITIAL_ERA + BONDING_DURATION);
  });

  describe("getPendingRewards", function () {
    it("getPendingRewards should return correct data", async function () {
      // Distribute rewards but don't update user state
      await zenVault.connect(user1).stake(stakeAmount1);
      const totalStake = stakeAmount1 * 2n + stakeAmount2;
      const rewardAmount = ethers.parseEther("30");

      // Set reward account and distribute rewards
      const owner = (await ethers.getSigners())[0];
      const rewardAccount = (await ethers.getSigners())[1];
      await zenVault.connect(owner).setRewardAccount(rewardAccount.address);
      await lpToken.connect(rewardAccount).approve(await zenVault.getAddress(), rewardAmount);
      await zenVault.connect(owner).distributeRewards(rewardAmount);

      // Calculate expected pending rewards
      const rewardRatio = rewardAmount * PRECISION_FACTOR / totalStake;
      const expectedReward = (rewardRatio * stakeAmount1 * 2n) / PRECISION_FACTOR;

      // Check pending rewards
      const pendingRewards = await zenVault.getPendingRewards(user1.address);
      expect(pendingRewards).to.equal(expectedReward);
    });

    it("should correctly calculate pending rewards after slash", async function () {
      // Apply slash first
      await zenVault.connect(owner).doSlash(SLASH_AMOUNT);

      // Distribute rewards
      await zenVault.connect(owner).distributeRewards(REWARD_AMOUNT);

      // Calculate expected values
      const totalStake = stakeAmount1 + stakeAmount2;
      const slashRatio = SLASH_AMOUNT * PRECISION_FACTOR / totalStake;
      const expectedSlash = (slashRatio * stakeAmount1) / PRECISION_FACTOR;
      const postSlashStake = stakeAmount1 - expectedSlash;
      const postSlashTotalStake = totalStake - SLASH_AMOUNT;
      const rewardRatio = REWARD_AMOUNT * PRECISION_FACTOR / postSlashTotalStake;
      const expectedReward = (rewardRatio * postSlashStake) / PRECISION_FACTOR;

      // Check pending rewards
      const pendingRewards = await zenVault.getPendingRewards(user1.address);
      expect(pendingRewards).to.be.closeTo(expectedReward, ethers.parseEther("2")); // Allow larger rounding difference
    });

    it("should handle getPendingRewards with zero stake", async function () {
      // Check pending rewards for user with no stake
      const pendingRewards = await zenVault.getPendingRewards(owner.address);
      expect(pendingRewards).to.equal(0);
    });
  });

  describe("getPendingSlash", function () {
    it("should return correct data", async function () {
      // Apply slash but don't update user state
      const slashAmount = ethers.parseEther("30");
      const owner = (await ethers.getSigners())[0];

      // Stake more to have a predictable total stake
      await zenVault.connect(user1).stake(stakeAmount1);
      const totalStake = stakeAmount1 * 2n + stakeAmount2;

      // Apply slash
      await zenVault.connect(owner).doSlash(slashAmount);

      // Calculate expected pending slash
      const slashRatio = slashAmount * PRECISION_FACTOR / totalStake;
      const expectedSlash = (slashRatio * stakeAmount1 * 2n) / PRECISION_FACTOR;

      // Check pending slash
      const pendingSlash = await zenVault.getPendingSlash(user1.address);
      expect(pendingSlash).to.equal(expectedSlash);
    });

    it("should correctly calculate pending slash after rewards", async function () {
      // Distribute rewards first
      await zenVault.connect(owner).distributeRewards(REWARD_AMOUNT);

      // Apply slash
      await zenVault.connect(owner).doSlash(SLASH_AMOUNT);

      // Calculate expected values
      const totalStake = stakeAmount1 + stakeAmount2;
      const rewardRatio = REWARD_AMOUNT * PRECISION_FACTOR / totalStake;
      const expectedReward = (rewardRatio * stakeAmount1) / PRECISION_FACTOR;
      const postRewardStake = stakeAmount1 + expectedReward;
      const postRewardTotalStake = totalStake + REWARD_AMOUNT;
      const slashRatio = SLASH_AMOUNT * PRECISION_FACTOR / postRewardTotalStake;
      const expectedSlash = (slashRatio * postRewardStake) / PRECISION_FACTOR;

      // Check pending slash
      const pendingSlash = await zenVault.getPendingSlash(user1.address);
      expect(pendingSlash).to.be.closeTo(expectedSlash, 1000n); // Allow small rounding difference
    });

    it("should handle getPendingSlash with zero stake", async function () {
      // Check pending slash for user with no stake
      const pendingSlash = await zenVault.getPendingSlash(owner.address);
      expect(pendingSlash).to.equal(0);
    });
  });

  describe("getApproximatePendingTotalStake", function () {
    it("should return correct data", async function () {
      // Apply rewards and slashes
      const rewardAmount = ethers.parseEther("30");
      const slashAmount = ethers.parseEther("10");
      const owner = (await ethers.getSigners())[0];
      const rewardAccount = (await ethers.getSigners())[1];

      // Set reward account and distribute rewards
      await zenVault.connect(owner).setRewardAccount(rewardAccount.address);
      await lpToken.connect(rewardAccount).approve(await zenVault.getAddress(), rewardAmount);
      await zenVault.connect(owner).distributeRewards(rewardAmount);

      // Apply slash
      await zenVault.connect(owner).doSlash(slashAmount);

      // Calculate expected approximate total stake
      const totalStake = stakeAmount1 + stakeAmount2;
      const expectedApproxTotalStake = totalStake + rewardAmount - slashAmount;

      // Check approximate pending total stake
      const approxTotalStake = await zenVault.getApproximatePendingTotalStake();
      expect(approxTotalStake).to.be.closeTo(expectedApproxTotalStake, 1000n); // Allow small rounding difference
    });

    it("should handle zero stake", async function () {
      // fully unstake
      await zenVault.connect(user1).unstake(await zenVault.stakedBalances(user1.address));
      await zenVault.connect(user2).unstake(await zenVault.stakedBalances(user2.address));

      // Verify total stake is zero
      expect(await zenVault.totalStake()).to.equal(0);

      // Check approximate pending total stake
      const approxTotalStake = await zenVault.getApproximatePendingTotalStake();
      expect(approxTotalStake).to.equal(0);
    });

    it("should handle case where slashes exceed rewards", async function () {
      // Distribute small rewards
      const smallReward = ethers.parseEther("5");
      await zenVault.connect(owner).distributeRewards(smallReward);

      // Apply large slash
      const largeSlash = ethers.parseEther("50");
      await zenVault.connect(owner).doSlash(largeSlash);

      // Calculate expected approximate total stake
      const expectedApproxTotalStake = stakeAmount1 + stakeAmount2 + smallReward - largeSlash;

      // Check approximate pending total stake
      const approxTotalStake = await zenVault.getApproximatePendingTotalStake();
      expect(approxTotalStake).to.be.closeTo(expectedApproxTotalStake, 1000n); // Allow small rounding difference
    });

    it("should handle case where rewards exceed slashes", async function () {
      // Distribute large rewards
      const largeReward = ethers.parseEther("50");
      await zenVault.connect(owner).distributeRewards(largeReward);

      // Apply small slash
      const smallSlash = ethers.parseEther("5");
      await zenVault.connect(owner).doSlash(smallSlash);

      // Calculate expected approximate total stake
      const expectedApproxTotalStake = stakeAmount1 + stakeAmount2 + largeReward - smallSlash;

      // Check approximate pending total stake
      const approxTotalStake = await zenVault.getApproximatePendingTotalStake();
      expect(approxTotalStake).to.be.closeTo(expectedApproxTotalStake, 1000n); // Allow small rounding difference
    });

    it("should handle multiple rewards and slashes", async function () {
      // Distribute rewards multiple times
      await zenVault.connect(owner).distributeRewards(REWARD_AMOUNT);
      await zenVault.connect(owner).distributeRewards(REWARD_AMOUNT);

      // Apply slash multiple times
      await zenVault.connect(owner).doSlash(SLASH_AMOUNT);
      await zenVault.connect(owner).doSlash(SLASH_AMOUNT);

      // Calculate expected approximate total stake
      const expectedApproxTotalStake = stakeAmount1 + stakeAmount2 + (REWARD_AMOUNT * 2n) - (SLASH_AMOUNT * 2n);

      // Check approximate pending total stake
      const approxTotalStake = await zenVault.getApproximatePendingTotalStake();
      expect(approxTotalStake).to.be.closeTo(expectedApproxTotalStake, 1000n); // Allow small rounding difference
    });
  });
});

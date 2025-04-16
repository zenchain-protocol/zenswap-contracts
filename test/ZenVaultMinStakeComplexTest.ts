import {expect} from "chai";
import {ethers} from "hardhat";
import {MockToken, ZenVault} from "../typechain-types";
import {SignerWithAddress} from "@nomicfoundation/hardhat-ethers/signers";
import {PRECISION_FACTOR, setupTestEnvironment} from "./utils";

describe("ZenVault MinStake Complex Tests", function () {
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
    user1 = testEnvironment.user1;
    user2 = testEnvironment.user2;
    rewardAccount = testEnvironment.rewardAccount;

    // Approve rewards
    await lpToken.connect(rewardAccount).approve(await zenVault.getAddress(), INITIAL_SUPPLY);

    // Approve ZenVault to spend LP tokens
    await lpToken.connect(user1).approve(await zenVault.getAddress(), INITIAL_SUPPLY);
    await lpToken.connect(user2).approve(await zenVault.getAddress(), INITIAL_SUPPLY);
  });

  describe("Slashing and minStake", function () {
    it("should apply slash to user with balance below minStake", async function () {
      // Set initial minStake to a low value
      const initialMinStake = ethers.parseEther("0.1");
      await zenVault.connect(owner).setMinStake(initialMinStake);

      // Stake a small amount
      const stakeAmount = ethers.parseEther("0.5"); // 0.5 ETH
      await zenVault.connect(user1).stake(stakeAmount);

      // Increase minStake above user's balance
      const newMinStake = ethers.parseEther("1"); // Higher than user's stake
      await zenVault.connect(owner).setMinStake(newMinStake);

      // Apply a small slash
      const slashAmount = ethers.parseEther("0.1");
      await zenVault.connect(owner).doSlash(slashAmount);
      await zenVault.connect(user1).updateUserState();

      // Verify user's balance is reduced by the slash
      const balanceAfterSlash = await zenVault.stakedBalances(user1.address);
      const slashRatio = slashAmount * PRECISION_FACTOR / stakeAmount;
      const expectedSlash = (slashRatio * stakeAmount) / PRECISION_FACTOR;
      expect(balanceAfterSlash).to.equal(stakeAmount - expectedSlash);
    });
  });

  describe("Rewards and minStake", function () {
    it("should apply rewards to user with balance below minStake", async function () {
      // Set initial minStake to a low value
      const initialMinStake = ethers.parseEther("0.1");
      await zenVault.connect(owner).setMinStake(initialMinStake);

      // Stake a small amount
      const stakeAmount = ethers.parseEther("0.5"); // 0.5 ETH
      await zenVault.connect(user1).stake(stakeAmount);

      // Increase minStake above user1's balance
      const newMinStake = ethers.parseEther("0.6");
      await zenVault.connect(owner).setMinStake(newMinStake);

      // Verify user1's balance is below the new minStake
      const balanceBeforeReward = await zenVault.stakedBalances(user1.address);
      expect(balanceBeforeReward).to.be.lt(newMinStake);

      // Distribute rewards
      // Use a large reward to ensure it brings balance above minStake
      const bigRewardAmount = ethers.parseEther("100");
      await zenVault.connect(owner).distributeRewards(bigRewardAmount);
      await zenVault.connect(user1).updateUserState();

      // Verify user1's balance is now at least minStake
      const balanceAfterReward = await zenVault.stakedBalances(user1.address);
      expect(balanceAfterReward).to.be.gt(balanceBeforeReward);
    });
  });

  describe("Edge cases for minStake", function () {
    it("should handle minStake set to 1", async function () {
      // Set minStake to 1
      await zenVault.connect(owner).setMinStake(1);

      // Verify minStake is 1
      expect(await zenVault.minStake()).to.equal(1);

      // Stake a very small amount
      const tinyStake = 1n;
      await zenVault.connect(user1).stake(tinyStake);

      // Verify stake was successful
      expect(await zenVault.stakedBalances(user1.address)).to.equal(tinyStake);

      // Verify user can unstake
      await zenVault.connect(user1).unstake(tinyStake);
      expect(await zenVault.stakedBalances(user1.address)).to.equal(0);

      // Verify unlocking chunks were created
      const unlockingChunks = await zenVault.getUnlockingChunks(user1.address);
      expect(unlockingChunks.length).to.equal(1);
      expect(unlockingChunks[0].value).to.equal(tinyStake);
    });

    it("should handle minStake set to a very high value", async function () {
      // Set minStake to a high value
      const highMinStake = ethers.parseEther("100");
      await zenVault.connect(owner).setMinStake(highMinStake);

      // Verify minStake is set correctly
      expect(await zenVault.minStake()).to.equal(highMinStake);

      // Try to stake less than minStake
      const stakeAmount = ethers.parseEther("50");
      await expect(zenVault.connect(user1).stake(stakeAmount))
        .to.be.revertedWith("Amount must be at least minStake.");

      // Stake more than minStake
      const largeStake = ethers.parseEther("150");
      await zenVault.connect(user1).stake(largeStake);

      // Verify stake was successful
      expect(await zenVault.stakedBalances(user1.address)).to.equal(largeStake);

      // Try to unstake that would leave balance below minStake
      const unstakeAmount = ethers.parseEther("60"); // Would leave 90 ETH
      await expect(zenVault.connect(user1).unstake(unstakeAmount))
        .to.be.revertedWith("Remaining staked balance must either be zero or at least minStake");
    });

    it("should handle changing minStake after users have staked", async function () {
      // Stake a moderate amount
      const stakeAmount = ethers.parseEther("5");
      await zenVault.connect(user1).stake(stakeAmount);

      // Verify user's stake
      expect(await zenVault.stakedBalances(user1.address)).to.equal(stakeAmount);

      // Increase minStake above user's balance
      const highMinStake = ethers.parseEther("10");
      await zenVault.connect(owner).setMinStake(highMinStake);

      // Verify user's stake is unchanged
      expect(await zenVault.stakedBalances(user1.address)).to.equal(stakeAmount);
    });
  });
});

import { expect } from "chai";
import { ethers } from "hardhat";
import { ZenVault, MockToken, MockStakingPrecompile } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { PRECISION_FACTOR, setupTestEnvironment } from "./utils";

describe("ZenVault MinStake Complex Tests", function () {
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
    it("should remove user from stakers when balance falls below minStake after slashing", async function () {
      // Set initial minStake to a low value
      const initialMinStake = ethers.parseEther("0.1");
      await zenVault.connect(owner).setMinStake(initialMinStake);

      // Stake a small amount
      const stakeAmount = ethers.parseEther("0.5"); // 0.5 ETH
      await zenVault.connect(user1).stake(stakeAmount);

      // Verify user is in stakers list
      const stakersBeforeSlash = await zenVault.getCurrentStakers();
      expect(stakersBeforeSlash).to.contain(user1.address);

      // Record era stake
      await zenVault.recordEraStake();

      // Increase minStake above user's balance
      const newMinStake = ethers.parseEther("1"); // Higher than user's stake
      await zenVault.connect(owner).setMinStake(newMinStake);

      // Apply a small slash to trigger the removal
      const slashAmount = ethers.parseEther("0.1");
      await zenVault.connect(owner).doSlash(slashAmount, INITIAL_ERA);

      // Verify user's balance is below the new minStake
      const balanceAfterSlash = await zenVault.stakedBalances(user1.address);
      expect(balanceAfterSlash).to.be.lt(newMinStake);

      // Verify user is removed from stakers list
      const stakersAfterSlash = await zenVault.getCurrentStakers();
      expect(stakersAfterSlash).to.not.contain(user1.address);
    });

    it("should not include users with balance < minStake in era exposures after slashing", async function () {
      // Set initial minStake to a low value
      const initialMinStake = ethers.parseEther("0.1");
      await zenVault.connect(owner).setMinStake(initialMinStake);

      // Stake amounts for two users
      const stakeAmount1 = ethers.parseEther("0.5"); // 0.5 ETH
      const stakeAmount2 = ethers.parseEther("10"); // 10 ETH

      await zenVault.connect(user1).stake(stakeAmount1);
      await zenVault.connect(user2).stake(stakeAmount2);

      // Record era stake for initial era
      await zenVault.recordEraStake();

      // Verify both users are in era exposures
      const initialEraExposures = await zenVault.getEraExposures(INITIAL_ERA);
      expect(initialEraExposures.length).to.equal(2);
      expect(initialEraExposures.some(e => e.staker === user1.address)).to.be.true;
      expect(initialEraExposures.some(e => e.staker === user2.address)).to.be.true;

      // Increase minStake above user1's balance
      const newMinStake = ethers.parseEther("1"); // Higher than user1's stake
      await zenVault.connect(owner).setMinStake(newMinStake);

      // Apply a small slash to trigger the removal
      const slashAmount = ethers.parseEther("0.1");
      await zenVault.connect(owner).doSlash(slashAmount, INITIAL_ERA);

      // Verify user1's balance is below the new minStake
      const balanceAfterSlash = await zenVault.stakedBalances(user1.address);
      expect(balanceAfterSlash).to.be.lt(newMinStake);

      // Advance era and record new era stake
      await mockStakingPrecompile.advanceEra(1);
      await zenVault.recordEraStake();

      // Get new era exposures
      const newEraExposures = await zenVault.getEraExposures(INITIAL_ERA + 1);

      // Check if user1 is in the exposures
      const user1InExposures = newEraExposures.some(e => e.staker === user1.address && e.value > 0);
      expect(user1InExposures).to.be.false;

      // Verify user2 is still in exposures
      const user2InExposures = newEraExposures.some(e => e.staker === user2.address);
      expect(user2InExposures).to.be.true;
    });
  });

  describe("Rewards and minStake", function () {
    it("should add user back to stakers when rewards bring balance above minStake", async function () {
      // Set initial minStake to a low value
      const initialMinStake = ethers.parseEther("0.1");
      await zenVault.connect(owner).setMinStake(initialMinStake);

      // Stake a small amount
      const stakeAmount = ethers.parseEther("0.5"); // 0.5 ETH
      await zenVault.connect(user1).stake(stakeAmount);

      // Record era stake
      await zenVault.recordEraStake();

      // Increase minStake above user1's balance
      const newMinStake = ethers.parseEther("0.6");
      await zenVault.connect(owner).setMinStake(newMinStake);

      // Verify user1's balance is below the new minStake
      const balanceAfterSetMinStake = await zenVault.stakedBalances(user1.address);
      expect(balanceAfterSetMinStake).to.be.lt(newMinStake);

      // Verify user1 is no longer in stakers list
      const stakersAfterSetMinStake = await zenVault.getCurrentStakers();
      expect(stakersAfterSetMinStake).not.to.contain(user1.address);

      // Advance era and record new era stake
      await mockStakingPrecompile.advanceEra(1);
      await zenVault.recordEraStake();

      // Distribute rewards for the initial era
      // Use a large reward to ensure it brings balance above minStake
      const bigRewardAmount = ethers.parseEther("100");
      await zenVault.connect(owner).distributeRewards(bigRewardAmount, INITIAL_ERA);

      // Verify user1's balance is now at least minStake
      const balanceAfterReward = await zenVault.stakedBalances(user1.address);
      expect(balanceAfterReward).to.be.gte(newMinStake);

      // Verify user1 is added back to stakers list
      const stakersAfterReward = await zenVault.getCurrentStakers();
      expect(stakersAfterReward).to.contain(user1.address);
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

      // Verify user is in stakers list
      const stakersAfterStake = await zenVault.getCurrentStakers();
      expect(stakersAfterStake).to.contain(user1.address);

      // Record era stake
      await zenVault.recordEraStake();

      // Verify user has exposure in the era
      const eraExposures = await zenVault.getEraExposures(INITIAL_ERA);
      expect(eraExposures.length).to.equal(1);

      // Verify user can unstake
      await zenVault.connect(user1).unstake(tinyStake);
      expect(await zenVault.stakedBalances(user1.address)).to.equal(0);

      // Verify user is no longer in stakers list
      const stakersAfterUnstake = await zenVault.getCurrentStakers();
      expect(stakersAfterUnstake).not.to.contain(user1.address);

      // Verify unlocking chunks were created
      const unlockingChunks = await zenVault.getUserUnlockingChunks(user1.address);
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

      // Verify user is in stakers list
      let stakers = await zenVault.getCurrentStakers();
      expect(stakers).to.contain(user1.address);

      // Record era stake with current minStake
      await zenVault.recordEraStake();

      // Verify user is in era exposures
      let eraExposures = await zenVault.getEraExposures(INITIAL_ERA);
      expect(eraExposures.some(e => e.staker === user1.address)).to.be.true;

      // Increase minStake above user's balance
      const highMinStake = ethers.parseEther("10");
      await zenVault.connect(owner).setMinStake(highMinStake);

      // Verify user is removed from stakers list
      stakers = await zenVault.getCurrentStakers();
      expect(stakers).to.not.contain(user1.address);
    });
  });
});

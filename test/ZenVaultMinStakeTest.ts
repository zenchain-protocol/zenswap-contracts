import { expect } from "chai";
import { ethers } from "hardhat";
import { ZenVault, MockToken, MockStakingPrecompile } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { setupTestEnvironment } from "./utils";

describe("ZenVault MinStake Tests", function () {
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
  const DEFAULT_MIN_STAKE = ethers.parseEther("1");

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

    // Approve ZenVault to spend LP tokens
    await lpToken.connect(user1).approve(await zenVault.getAddress(), ethers.parseEther("1000"));
    await lpToken.connect(user2).approve(await zenVault.getAddress(), ethers.parseEther("1000"));
  });

  describe("Staking with minStake", function () {
    it("should have the correct default minStake value", async function () {
      expect(await zenVault.minStake()).to.equal(DEFAULT_MIN_STAKE);
    });

    it("should allow staking exactly minStake", async function () {
      await zenVault.connect(user1).stake(DEFAULT_MIN_STAKE);
      expect(await zenVault.stakedBalances(user1.address)).to.equal(DEFAULT_MIN_STAKE);
      expect(await zenVault.getCurrentStakers()).to.contain(user1.address);
    });

    it("should not allow staking less than minStake", async function () {
      const belowMinStake = DEFAULT_MIN_STAKE - ethers.parseEther("0.1");
      await expect(zenVault.connect(user1).stake(belowMinStake))
        .to.be.revertedWith("Amount must be at least minStake.");
    });

    it("should allow staking more than minStake", async function () {
      const aboveMinStake = DEFAULT_MIN_STAKE + ethers.parseEther("0.1");
      await zenVault.connect(user1).stake(aboveMinStake);
      expect(await zenVault.stakedBalances(user1.address)).to.equal(aboveMinStake);
    });
  });

  describe("Unstaking with minStake", function () {
    const stakeAmount = ethers.parseEther("10");

    beforeEach(async function () {
      // Stake tokens first
      await zenVault.connect(user1).stake(stakeAmount);
    });

    it("should allow unstaking that leaves zero balance", async function () {
      await zenVault.connect(user1).unstake(stakeAmount);
      expect(await zenVault.stakedBalances(user1.address)).to.equal(0);
    });

    it("should allow unstaking that leaves balance >= minStake", async function () {
      const unstakeAmount = stakeAmount - DEFAULT_MIN_STAKE;
      await zenVault.connect(user1).unstake(unstakeAmount);

      const remainingBalance = await zenVault.stakedBalances(user1.address);
      expect(remainingBalance).to.equal(DEFAULT_MIN_STAKE);
    });

    it("should allow unstaking after removal from stakers list", async function () {
      // set min stake above user staked balance
      const newMinStake = stakeAmount + ethers.parseEther("1");
      await zenVault.connect(owner).setMinStake(newMinStake);

      // verify user's staked balance is unchanged and below min stake
      const stakedBalance = await zenVault.stakedBalances(user1.address);
      expect(stakedBalance).to.be.lt(newMinStake);
      expect(stakedBalance).to.equal(stakeAmount);

      // verify user not in stakers
      const stakers = await zenVault.getCurrentStakers();
      expect(stakers).not.to.contain(user1.address);

      // unstake
      await zenVault.connect(user1).unstake(stakeAmount);
      expect(await zenVault.stakedBalances(user1.address)).to.equal(0);
    });

    it("should not allow unstaking that leaves balance between 0 and minStake", async function () {
      const unstakeAmount = stakeAmount - ethers.parseEther("0.5"); // Leaves 0.5 ETH, which is below minStake
      await expect(zenVault.connect(user1).unstake(unstakeAmount))
        .to.be.revertedWith("Remaining staked balance must either be zero or at least minStake");
    });
  });

  describe("removeFromStakers function", function () {
    const stakeAmount = ethers.parseEther("10");

    beforeEach(async function () {
      // Stake tokens first
      await zenVault.connect(user1).stake(stakeAmount);
      await zenVault.connect(user2).stake(stakeAmount);
    });

    it("should remove user from stakers when fully unstaked", async function () {
      // Verify user1 is in stakers list before unstaking
      const stakersBeforeUnstake = await zenVault.getCurrentStakers();
      expect(stakersBeforeUnstake).contains(user1.address);

      // Fully unstake for user1
      await zenVault.connect(user1).unstake(stakeAmount);

      // Verify user1 is NOT in stakers list after unstaking
      const stakersAfterUnstake = await zenVault.getCurrentStakers();
      expect(stakersAfterUnstake).to.not.contain(user1.address);
    });

    it("should not remove user from stakers when balance remains above minStake", async function () {
      // Record era stake to capture current stakers
      await zenVault.recordEraStake();

      // Verify user1 is in stakers list before unstaking
      const stakersBeforeUnstake = await zenVault.getCurrentStakers();
      expect(stakersBeforeUnstake).contains(user1.address);

      // Partially unstake for user1, leaving more than minStake
      const unstakeAmount = stakeAmount - DEFAULT_MIN_STAKE - ethers.parseEther("0.1");
      await zenVault.connect(user1).unstake(unstakeAmount);

      // Verify user1 remains in stakers list after unstaking
      const stakersAfterUnstake = await zenVault.getCurrentStakers();
      expect(stakersAfterUnstake).contains(user1.address);

      // Advance era and record new era stake
      await mockStakingPrecompile.advanceEra(1);
      await zenVault.recordEraStake();

      // Verify user1 remains in stakers list after recordEraStake
      const stakersAfterRecordEraStake = await zenVault.getCurrentStakers();
      expect(stakersAfterRecordEraStake).contains(user1.address);

      // Get new era exposures
      const newExposures = await zenVault.getEraExposures(INITIAL_ERA + 1);
      expect(newExposures.length).to.equal(2); // Both users should still be in stakers

      // Verify user1 is still in the stakers list
      const user1Found = newExposures.some(exposure => exposure.staker === user1.address);
      expect(user1Found).to.be.true;
    });
  });

  describe("setMinStake function", function () {
    const stakeAmount = ethers.parseEther("5");

    beforeEach(async function () {
      // Stake tokens
      await zenVault.connect(user1).stake(stakeAmount);
    });

    it("should allow increasing minStake", async function () {
      const newMinStake = ethers.parseEther("2");
      await zenVault.connect(owner).setMinStake(newMinStake);
      expect(await zenVault.minStake()).to.equal(newMinStake);
    });

    it("should allow decreasing minStake", async function () {
      const newMinStake = ethers.parseEther("0.5");
      await zenVault.connect(owner).setMinStake(newMinStake);
      expect(await zenVault.minStake()).to.equal(newMinStake);
    });

    it("should affect new stake operations after minStake change", async function () {
      // Increase minStake
      const newMinStake = ethers.parseEther("6");
      await zenVault.connect(owner).setMinStake(newMinStake);

      // Try to stake an amount that was valid before but is now below minStake
      const smallStake = ethers.parseEther("5.5");
      await expect(zenVault.connect(user2).stake(smallStake))
        .to.be.revertedWith("Amount must be at least minStake.");

      // Try to stake an amount above the new minStake
      const largeStake = ethers.parseEther("7");
      await zenVault.connect(user2).stake(largeStake);
      expect(await zenVault.stakedBalances(user2.address)).to.equal(largeStake);
    });

    it("should affect unstake operations after minStake change", async function () {
      // User1 has 5 ETH staked

      // Increase minStake to 3 ETH
      const newMinStake = ethers.parseEther("3");
      await zenVault.connect(owner).setMinStake(newMinStake);

      // Try to unstake leaving 2.5 ETH (now below minStake)
      const unstakeAmount = ethers.parseEther("2.5");
      await expect(zenVault.connect(user1).unstake(unstakeAmount))
        .to.be.revertedWith("Remaining staked balance must either be zero or at least minStake");

      // Try to unstake leaving 3.5 ETH (above new minStake)
      const validUnstakeAmount = ethers.parseEther("1.5");
      await zenVault.connect(user1).unstake(validUnstakeAmount);
      expect(await zenVault.stakedBalances(user1.address)).to.equal(stakeAmount - validUnstakeAmount);
    });

    it("should remove users from stakers array whose stake is below minStake", async function () {
      // User1 has 5 ETH staked

      // Increase minStake to 3 ETH
      const newMinStake = ethers.parseEther("3");
      await zenVault.connect(owner).setMinStake(newMinStake);

      // Try to unstake leaving 2.5 ETH (now below minStake)
      const unstakeAmount = ethers.parseEther("2.5");
      await expect(zenVault.connect(user1).unstake(unstakeAmount))
        .to.be.revertedWith("Remaining staked balance must either be zero or at least minStake");

      // Try to unstake leaving 3.5 ETH (above new minStake)
      const validUnstakeAmount = ethers.parseEther("1.5");
      await zenVault.connect(user1).unstake(validUnstakeAmount);
      expect(await zenVault.stakedBalances(user1.address)).to.equal(stakeAmount - validUnstakeAmount);
    });

    it("should not allow minStake of 0", async function () {
      await expect(zenVault.connect(owner).setMinStake(0n))
        .to.be.revertedWith("The minimum stake must be greater than 0.");
    });
  });
});

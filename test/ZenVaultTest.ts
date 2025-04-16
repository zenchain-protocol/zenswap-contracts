import { expect } from "chai";
import { ethers } from "hardhat";
import { ZenVault, MockToken, MockStakingPrecompile } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import {PRECISION_FACTOR, setupTestEnvironment} from "./utils";

describe("ZenVault", function () {
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
  });

  describe("Deployment", function () {
    it("should set the correct LP token address", async function () {
      expect(await zenVault.pool()).to.equal(await lpToken.getAddress());
    });

    it("should initialize with zero total stake", async function () {
      expect(await zenVault.totalStake()).to.equal(0);
    });

    it("should set the correct owner", async function () {
      expect(await zenVault.owner()).to.equal(owner.address);
    });

    it("should set the correct reward account", async function () {
      expect(await zenVault.rewardAccount()).to.equal(rewardAccount.address);
    });

    it("should enable withdrawals by default", async function () {
      expect(await zenVault.isWithdrawEnabled()).to.equal(true);
    });
  });

  describe("Staking", function () {
    beforeEach(async function () {
      // Approve ZenVault to spend LP tokens
      await lpToken.connect(user1).approve(await zenVault.getAddress(), ethers.parseEther("1000"));
      await lpToken.connect(user2).approve(await zenVault.getAddress(), ethers.parseEther("1000"));
    });

    it("should allow users to stake LP tokens", async function () {
      const stakeAmount = ethers.parseEther("100");
      await zenVault.connect(user1).stake(stakeAmount);

      expect(await zenVault.stakedBalances(user1.address)).to.equal(stakeAmount);
      expect(await zenVault.totalStake()).to.equal(stakeAmount);
    });

    it("should emit Staked event when staking", async function () {
      const stakeAmount = ethers.parseEther("100");
      await expect(zenVault.connect(user1).stake(stakeAmount))
        .to.emit(zenVault, "Staked")
        .withArgs(user1.address, stakeAmount);
    });

    it("should not allow staking when staking is disabled", async function () {
      await zenVault.connect(owner).setIsStakingEnabled(false);
      const stakeAmount = ethers.parseEther("100");

      await expect(zenVault.connect(user1).stake(stakeAmount))
        .to.be.revertedWith("Staking is not currently permitted in this ZenVault.");
    });

    it("should not allow staking zero amount", async function () {
      await expect(zenVault.connect(user1).stake(0))
        .to.be.revertedWith("Amount must be at least minStake.");
    });

    it("should not allow staking below minStake", async function () {
      await expect(zenVault.connect(user1).stake(ethers.parseEther("0.5")))
        .to.be.revertedWith("Amount must be at least minStake.");
    });

    it("should track multiple stakers correctly", async function () {
      const stakeAmount1 = ethers.parseEther("100");
      const stakeAmount2 = ethers.parseEther("200");

      await zenVault.connect(user1).stake(stakeAmount1);
      await zenVault.connect(user2).stake(stakeAmount2);

      expect(await zenVault.stakedBalances(user1.address)).to.equal(stakeAmount1);
      expect(await zenVault.stakedBalances(user2.address)).to.equal(stakeAmount2);
      expect(await zenVault.totalStake()).to.equal(stakeAmount1 + stakeAmount2);
    });
  });

  describe("Unstaking", function () {
    const stakeAmount = ethers.parseEther("100");

    beforeEach(async function () {
      // Approve and stake
      await lpToken.connect(user1).approve(await zenVault.getAddress(), stakeAmount);
      await zenVault.connect(user1).stake(stakeAmount);
    });

    it("should allow users to unstake LP tokens", async function () {
      const unstakeAmount = ethers.parseEther("50");
      await zenVault.connect(user1).unstake(unstakeAmount);

      expect(await zenVault.stakedBalances(user1.address)).to.equal(stakeAmount - unstakeAmount);
      expect(await zenVault.totalStake()).to.equal(stakeAmount - unstakeAmount);

      // Check that the tokens are in the unlocking state
      const unlockingChunks = await zenVault.getUnlockingChunks(user1.address);
      expect(unlockingChunks.length).to.equal(1);
      expect(unlockingChunks[0].value).to.equal(unstakeAmount);
      expect(unlockingChunks[0].era).to.equal(INITIAL_ERA + BONDING_DURATION);
    });

    it("should allow users to unstake full staked balance", async function () {
      await zenVault.connect(user1).unstake(stakeAmount);

      expect(await zenVault.stakedBalances(user1.address)).to.equal(0n);
      expect(await zenVault.totalStake()).to.equal(0n);

      // Check that the tokens are in the unlocking state
      const unlockingChunks = await zenVault.getUnlockingChunks(user1.address);
      expect(unlockingChunks.length).to.equal(1);
      expect(unlockingChunks[0].value).to.equal(stakeAmount);
      expect(unlockingChunks[0].era).to.equal(INITIAL_ERA + BONDING_DURATION);
    });

    it("should emit Unstaked event when unstaking", async function () {
      const unstakeAmount = ethers.parseEther("50");
      await expect(zenVault.connect(user1).unstake(unstakeAmount))
        .to.emit(zenVault, "Unstaked")
        .withArgs(user1.address, unstakeAmount);
    });

    it("should not allow unstaking more than staked balance", async function () {
      const unstakeAmount = ethers.parseEther("150");
      expect(unstakeAmount).to.be.gt(stakeAmount);
      await expect(zenVault.connect(user1).unstake(unstakeAmount))
        .to.be.revertedWith("Insufficient staked balance.");
    });

    it("should not allow unstaking zero amount", async function () {
      await expect(zenVault.connect(user1).unstake(0))
        .to.be.revertedWith("Amount must be greater than zero.");
    });

    it("should not allow withdrawing before unstaking", async function () {
      await expect(zenVault.connect(user1).withdrawUnlocked())
        .to.be.revertedWith("Nothing to withdraw.");
    });

    it("should enforce maxUnlockChunks limit", async function () {
      // Get current maxUnlockChunks
      const maxUnlockChunks = await zenVault.maxUnlockChunks();

      // Create maxUnlockChunks unlocking chunks
      const chunkSize = stakeAmount / (maxUnlockChunks * 2n);
      for (let i = 0; i < maxUnlockChunks; i++) {
        await zenVault.connect(user1).unstake(chunkSize);
      }

      // Verify unlocking chunks length
      const unlockingChunks = await zenVault.getUnlockingChunks(user1.address);
      expect(unlockingChunks.length).to.equal(Number(maxUnlockChunks));

      // Try to create one more chunk (should fail)
      await expect(zenVault.connect(user1).unstake(chunkSize))
        .to.be.revertedWith("Unlocking array length limit reached. Withdraw unlocked tokens before unstaking.");
    });
  });

  describe("Withdrawing Unlocked Tokens", function () {
    const stakeAmount = ethers.parseEther("100");
    const unstakeAmount = ethers.parseEther("50");

    beforeEach(async function () {
      // Approve and stake
      await lpToken.connect(user1).approve(await zenVault.getAddress(), stakeAmount);
      await zenVault.connect(user1).stake(stakeAmount);

      // Unstake
      await zenVault.connect(user1).unstake(unstakeAmount);
    });

    it("should not allow withdrawing before bonding period ends", async function () {
      // Try to withdraw before bonding period ends
      await zenVault.connect(user1).withdrawUnlocked();

      // Check that no tokens were withdrawn
      const unlockingChunks = await zenVault.getUnlockingChunks(user1.address);
      expect(unlockingChunks.length).to.equal(1);
      expect(unlockingChunks[0].value).to.equal(unstakeAmount);
    });

    it("should not emit event if no tokens are withdrawn", async function () {
      await expect(zenVault.connect(user1).withdrawUnlocked()).not.to.emit(zenVault, "Withdrawal");
    });

    it("should allow withdrawing after bonding period ends", async function () {
      // Advance era to after bonding period
      await mockStakingPrecompile.advanceEra(BONDING_DURATION + 1);

      // Initial LP token balance
      const initialBalance = await lpToken.balanceOf(user1.address);

      // Withdraw unlocked tokens
      await zenVault.connect(user1).withdrawUnlocked();

      // Check that tokens were withdrawn
      const finalBalance = await lpToken.balanceOf(user1.address);
      expect(finalBalance - initialBalance).to.equal(unstakeAmount);

      // Check that unlocking chunks were removed
      const unlockingChunks = await zenVault.getUnlockingChunks(user1.address);
      expect(unlockingChunks.length).to.equal(0);
    });

    it("should emit Withdrawal event when withdrawing", async function () {
      // Advance era to after bonding period
      await mockStakingPrecompile.advanceEra(BONDING_DURATION + 1);

      // Withdraw unlocked tokens
      await expect(zenVault.connect(user1).withdrawUnlocked())
        .to.emit(zenVault, "Withdrawal")
        .withArgs(user1.address, unstakeAmount);
    });

    it("should not allow withdrawing when withdrawals are disabled", async function () {
      // Advance era to after bonding period
      await mockStakingPrecompile.advanceEra(BONDING_DURATION + 1);

      // Disable withdrawals
      await zenVault.connect(owner).setIsWithdrawEnabled(false);

      // Try to withdraw
      await expect(zenVault.connect(user1).withdrawUnlocked())
        .to.be.revertedWith("Withdrawals are temporarily disabled.");
    });
  });

  describe("Reward Distribution", function () {
    const stakeAmount1 = ethers.parseEther("100");
    const stakeAmount2 = ethers.parseEther("200");
    const rewardAmount = ethers.parseEther("30");

    beforeEach(async function () {
      // Approve and stake
      await lpToken.connect(user1).approve(await zenVault.getAddress(), stakeAmount1);
      await lpToken.connect(user2).approve(await zenVault.getAddress(), stakeAmount2);
      await zenVault.connect(user1).stake(stakeAmount1);
      await zenVault.connect(user2).stake(stakeAmount2);

      // Approve reward account to transfer rewards
      await lpToken.connect(rewardAccount).approve(await zenVault.getAddress(), rewardAmount);
    });

    it("should distribute rewards proportionally", async function () {
      // Distribute rewards
      await zenVault.connect(owner).distributeRewards(rewardAmount);

      // update user states
      await zenVault.connect(user1).updateUserState();
      await zenVault.connect(user2).updateUserState();

      // Calculate expected rewards
      const totalStake = stakeAmount1 + stakeAmount2;
      const rewardRatio = rewardAmount * PRECISION_FACTOR / totalStake;
      const expectedReward1 = (rewardRatio * stakeAmount1) / PRECISION_FACTOR;
      const expectedReward2 = (rewardRatio * stakeAmount2) / PRECISION_FACTOR;

      // Check that rewards were distributed correctly
      expect(await zenVault.stakedBalances(user1.address)).to.equal(stakeAmount1 + expectedReward1);
      expect(await zenVault.stakedBalances(user2.address)).to.equal(stakeAmount2 + expectedReward2);
      expect(await zenVault.totalStake()).to.equal(totalStake + rewardAmount);
    });

    it("should emit VaultRewardsAdded event", async function () {
      // Calculate expected reward ratio
      const totalStake = stakeAmount1 + stakeAmount2;
      const rewardRatio = rewardAmount * PRECISION_FACTOR / totalStake;
      // This is the first reward distribution, and each distribution adds the next rewardRatio to cumulativeRewardPerShare
      const cumulativeRewardPerShare = rewardRatio;

      // call distributeRewards
      await expect(zenVault.connect(owner).distributeRewards(rewardAmount))
        .to.emit(zenVault, "VaultRewardsAdded")
        .withArgs(rewardAmount, cumulativeRewardPerShare, rewardRatio);
    });

    it("should not allow non-owners to distribute rewards", async function () {
      await expect(zenVault.connect(user1).distributeRewards(rewardAmount))
        .to.be.revertedWithCustomError(zenVault, "OwnableUnauthorizedAccount").withArgs(user1.address);
    });

    it("should not allow distributing zero rewards", async function () {
      await expect(zenVault.connect(owner).distributeRewards(0))
        .to.be.revertedWith("Amount must be greater than zero.");
    });

    it("should not distribute rewards if there are no stakers", async function () {
      // Create a new ZenVault with no stakers
      const ZenVaultFactory = await ethers.getContractFactory("ZenVault");
      const newZenVault = await ZenVaultFactory.deploy(owner.address, await lpToken.getAddress());
      await newZenVault.connect(owner).setRewardAccount(rewardAccount.address);

      // verify totalStake is 0
      const totalStake = await newZenVault.totalStake();
      expect(totalStake).to.equal(0n);

      // Distribute rewards (should revert since totalStake is 0)
      await expect(newZenVault.connect(owner).distributeRewards(rewardAmount))
        .to.be.revertedWith("There are no stakers to receive rewards.");
    });
  });

  describe("Slashing", function () {
    const stakeAmount1 = ethers.parseEther("100");
    const stakeAmount2 = ethers.parseEther("200");
    const slashAmount = ethers.parseEther("30");

    beforeEach(async function () {
      // Approve and stake
      await lpToken.connect(user1).approve(await zenVault.getAddress(), stakeAmount1);
      await lpToken.connect(user2).approve(await zenVault.getAddress(), stakeAmount2);
      await zenVault.connect(user1).stake(stakeAmount1);
      await zenVault.connect(user2).stake(stakeAmount2);
    });

    it("should slash stakers proportionally", async function () {
      // Slash
      await zenVault.connect(owner).doSlash(slashAmount);

      // update user states
      await zenVault.connect(user1).updateUserState();
      await zenVault.connect(user2).updateUserState();

      // Calculate expected slash amounts
      const totalStake = stakeAmount1 + stakeAmount2;
      const slashRatio = slashAmount * PRECISION_FACTOR / totalStake;
      const expectedSlash1 = (slashRatio * stakeAmount1) / PRECISION_FACTOR;
      const expectedSlash2 = (slashRatio * stakeAmount2) / PRECISION_FACTOR;

      // Check that stakers were slashed correctly
      expect(await zenVault.stakedBalances(user1.address)).to.equal(stakeAmount1 - expectedSlash1);
      expect(await zenVault.stakedBalances(user2.address)).to.equal(stakeAmount2 - expectedSlash2);
    });

    it("should emit VaultSlashed event", async function () {
      // Calculate expected slash ratio
      const totalStake = stakeAmount1 + stakeAmount2;
      const slashRatio = slashAmount * PRECISION_FACTOR / totalStake;
      // This is the first slash, and each slash adds the next slashRatio to cumulativeSlashPerShare
      const cumulativeSlashPerShare = slashRatio;

      // call doSlash
      await expect(zenVault.connect(owner).doSlash(slashAmount))
        .to.emit(zenVault, "VaultSlashed")
        .withArgs(slashAmount, cumulativeSlashPerShare, slashRatio);
    });

    it("should not allow non-owners to slash", async function () {
      await expect(zenVault.connect(user1).doSlash(slashAmount))
        .to.be.revertedWithCustomError(zenVault, "OwnableUnauthorizedAccount").withArgs(user1.address)
    });

    it("should not allow slashing when there is no stake", async function () {
      // Create a new ZenVault with no stakers
      const ZenVaultFactory = await ethers.getContractFactory("ZenVault");
      const newZenVault = await ZenVaultFactory.deploy(owner.address, await lpToken.getAddress());

      // verify totalStake is 0
      const totalStake = await newZenVault.totalStake();
      expect(totalStake).to.equal(0n);

      // Try to slash with no stake
      await expect(newZenVault.connect(owner).doSlash(slashAmount))
        .to.be.revertedWith("No stake to slash.");
    });

    it("should slash from unlocking chunks if staked balance is insufficient", async function () {
      // Unstake all tokens
      await zenVault.connect(user1).unstake(stakeAmount1);

      // Slash
      await zenVault.connect(owner).doSlash(slashAmount);

      // update user state
      await zenVault.connect(user1).updateUserState();

      // Calculate expected slash amount for user1
      const totalStake = stakeAmount1 + stakeAmount2;
      const slashRatio = slashAmount * PRECISION_FACTOR / totalStake;
      const expectedSlash1 = (slashRatio * stakeAmount1) / PRECISION_FACTOR;

      // Check that unlocking chunks were slashed
      const unlockingChunks = await zenVault.getUnlockingChunks(user1.address);
      expect(unlockingChunks[0].value).to.equal(stakeAmount1 - expectedSlash1);
    });

    it("should handle slashing more than total stake", async function () {

      // Slash more than total stake
      const totalStake = stakeAmount1 + stakeAmount2;
      const hugeSlashAmount = totalStake * 2n;
      await zenVault.connect(owner).doSlash(hugeSlashAmount);

      // Update user states
      await zenVault.connect(user1).updateUserState();
      await zenVault.connect(user2).updateUserState();

      // Verify all stake was slashed
      expect(await zenVault.stakedBalances(user1.address)).to.equal(0);
      expect(await zenVault.stakedBalances(user2.address)).to.equal(0);
      expect(await zenVault.totalStake()).to.equal(0);
    });

    it("should handle slashing exactly total stake", async function () {
      // Slash exactly total stake
      const totalStake = stakeAmount1 + stakeAmount2;
      await zenVault.connect(owner).doSlash(totalStake);

      // Update user states
      await zenVault.connect(user1).updateUserState();
      await zenVault.connect(user2).updateUserState();

      // Verify all stake was slashed
      expect(await zenVault.stakedBalances(user1.address)).to.equal(0);
      expect(await zenVault.stakedBalances(user2.address)).to.equal(0);
      expect(await zenVault.totalStake()).to.equal(0);
    });
  });

  describe("Administrative Functions", function () {

    describe("setIsStakingEnabled", function () {
      it("should allow owner to enable/disable staking", async function () {
        // Disable staking
        await zenVault.connect(owner).setIsStakingEnabled(false);
        expect(await zenVault.isStakingEnabled()).to.equal(false);

        // Enable staking
        await zenVault.connect(owner).setIsStakingEnabled(true);
        expect(await zenVault.isStakingEnabled()).to.equal(true);
      });

      it("should emit StakingEnabled event", async function () {
        await expect(zenVault.connect(owner).setIsStakingEnabled(false))
          .to.emit(zenVault, "StakingEnabled")
          .withArgs(false);
      });

      it("should not allow non-owners to enable/disable staking", async function () {
        await expect(zenVault.connect(user1).setIsStakingEnabled(false))
          .to.be.revertedWithCustomError(zenVault, "OwnableUnauthorizedAccount").withArgs(user1.address)
      });
    });

    describe("setIsWithdrawEnabled", function () {
      it("should allow owner to enable/disable withdrawals", async function () {
        // Disable withdrawals
        await zenVault.connect(owner).setIsWithdrawEnabled(false);
        expect(await zenVault.isWithdrawEnabled()).to.equal(false);

        // Enable withdrawals
        await zenVault.connect(owner).setIsWithdrawEnabled(true);
        expect(await zenVault.isWithdrawEnabled()).to.equal(true);
      });

      it("should emit WithdrawEnabled event", async function () {
        await expect(zenVault.connect(owner).setIsWithdrawEnabled(false))
          .to.emit(zenVault, "WithdrawEnabled")
          .withArgs(false);
      });

      it("should not allow non-owners to enable/disable withdrawals", async function () {
        await expect(zenVault.connect(user1).setIsWithdrawEnabled(false))
          .to.be.revertedWithCustomError(zenVault, "OwnableUnauthorizedAccount").withArgs(user1.address)
      });
    });

    describe("setRewardAccount", function () {
      it("should allow owner to set reward account", async function () {
        // Set new reward account
        await zenVault.connect(owner).setRewardAccount(user2.address);
        expect(await zenVault.rewardAccount()).to.equal(user2.address);
      });

      it("should emit RewardAccountSet event", async function () {
        await expect(zenVault.connect(owner).setRewardAccount(user2.address))
          .to.emit(zenVault, "RewardAccountSet")
          .withArgs(user2.address);
      });

      it("should not allow non-owners to set reward account", async function () {
        await expect(zenVault.connect(user1).setRewardAccount(user2.address))
          .to.be.revertedWithCustomError(zenVault, "OwnableUnauthorizedAccount").withArgs(user1.address)
      });
    });

    describe("setMinStake", function () {
      it("should allow owner to set minimum stake threshold", async function () {
        // verify default min stake
        const initialMinStake = ethers.parseEther("1");
        expect(await zenVault.minStake()).to.equal(initialMinStake);

        // set higher minimum stake
        const higherMinStake = ethers.parseEther("10");
        await zenVault.connect(owner).setMinStake(higherMinStake);
        expect(await zenVault.minStake()).to.equal(higherMinStake);

        // set minStake back to default
        await zenVault.connect(owner).setMinStake(initialMinStake);
        expect(await zenVault.minStake()).to.equal(initialMinStake);
      });

      it("should emit MinStakeSet event", async function () {
        const minStake = ethers.parseEther("1");
        await expect(zenVault.connect(owner).setMinStake(minStake))
          .to.emit(zenVault, "MinStakeSet")
          .withArgs(minStake);
      });

      it("should not allow non-owners to set minStake", async function () {
        const minStake = ethers.parseEther("1");
        await expect(zenVault.connect(user1).setMinStake(minStake))
          .to.be.revertedWithCustomError(zenVault, "OwnableUnauthorizedAccount").withArgs(user1.address)
      });
    });

    describe("setMaxUnlockChunks", function () {
      it("should allow owner to set maxUnlockChunks", async function () {
        // verify default max unlock chunks
        const initialMaxUnlockChunks = 10;
        expect(await zenVault.maxUnlockChunks()).to.equal(initialMaxUnlockChunks);

        // set higher max unlock chunks
        const higherMaxUnlockChunks = 25
        await zenVault.connect(owner).setMaxUnlockChunks(higherMaxUnlockChunks);
        expect(await zenVault.maxUnlockChunks()).to.equal(higherMaxUnlockChunks);

        // set minStake back to default
        await zenVault.connect(owner).setMaxUnlockChunks(initialMaxUnlockChunks);
        expect(await zenVault.maxUnlockChunks()).to.equal(initialMaxUnlockChunks);
      });

      it("should emit MaxUnlockChunksSet event", async function () {
        const maxUnlockChunks = 10;
        await expect(zenVault.connect(owner).setMaxUnlockChunks(maxUnlockChunks))
          .to.emit(zenVault, "MaxUnlockChunksSet")
          .withArgs(maxUnlockChunks);
      });

      it("should not allow non-owners to set maxUnlockingCHunks", async function () {
        const maxUnockChunks = 10;
        await expect(zenVault.connect(user1).setMaxUnlockChunks(maxUnockChunks))
          .to.be.revertedWithCustomError(zenVault, "OwnableUnauthorizedAccount").withArgs(user1.address)
      });

      it("should not allow setting maxUnlockChunks to zero", async function () {
        await expect(zenVault.connect(owner).setMaxUnlockChunks(0))
          .to.be.revertedWith("The maximum unlocking array length must be greater than 0.");
      });
    });

    describe("setNativeStakingAddress", function () {
      it("should allow owner to set native staking address", async function () {
        // verify default native staking address
        const initialNativeStakingAddress = "0x0000000000000000000000000000000000000800";
        expect(await zenVault.nativeStaking()).to.equal(initialNativeStakingAddress);

        // set new native staking address
        const newAddress = "0x0000000000000000000000000000000000000801";
        await zenVault.connect(owner).setNativeStakingAddress(newAddress);
        expect(await zenVault.nativeStaking()).to.equal(newAddress);

        // set native staking address back to default
        await zenVault.connect(owner).setNativeStakingAddress(initialNativeStakingAddress);
        expect(await zenVault.nativeStaking()).to.equal(initialNativeStakingAddress);
      });

      it("should emit NativeStakingAddressSet event", async function () {
        const newAddress = "0x0000000000000000000000000000000000000801";
        await expect(zenVault.connect(owner).setNativeStakingAddress(newAddress))
          .to.emit(zenVault, "NativeStakingAddressSet")
          .withArgs(newAddress);
      });

      it("should not allow non-owners to set native staking address", async function () {
        const newAddress = "0x0000000000000000000000000000000000000801";
        await expect(zenVault.connect(user1).setNativeStakingAddress(newAddress))
          .to.be.revertedWithCustomError(zenVault, "OwnableUnauthorizedAccount").withArgs(user1.address);
      });
    });
  });
});

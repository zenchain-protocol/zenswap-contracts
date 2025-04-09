import { expect } from "chai";
import { ethers } from "hardhat";
import { ZenVault, MockToken, MockStakingPrecompile } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("ZenVault", function () {
  // Contracts
  let zenVault: ZenVault;
  let mockToken1: MockToken;
  let mockToken2: MockToken;
  let mockStakingPrecompile: MockStakingPrecompile;
  let lpToken: MockToken; // We'll use a MockToken as LP token for simplicity

  // Signers
  let owner: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;
  let rewardAccount: SignerWithAddress;

  // Constants
  const STAKING_ADDRESS = "0x0000000000000000000000000000000000000800";
  const INITIAL_SUPPLY = ethers.parseEther("1000000");
  const INITIAL_ERA = 1;
  const BONDING_DURATION = 2; // 2 eras

  beforeEach(async function () {
    // Reset the blockchain
    await ethers.provider.send("hardhat_reset", []);

    // Get signers
    [owner, user1, user2, rewardAccount] = await ethers.getSigners();

    // Deploy mock tokens
    const MockTokenFactory = await ethers.getContractFactory("MockToken");
    mockToken1 = await MockTokenFactory.deploy("Token A", "TKNA", 18);
    mockToken2 = await MockTokenFactory.deploy("Token B", "TKNB", 18);
    lpToken = await MockTokenFactory.deploy("LP Token", "LP", 18);

    // Mint initial supply
    await mockToken1.mint(owner.address, INITIAL_SUPPLY);
    await mockToken2.mint(owner.address, INITIAL_SUPPLY);
    await lpToken.mint(owner.address, INITIAL_SUPPLY);
    await lpToken.mint(user1.address, INITIAL_SUPPLY);
    await lpToken.mint(user2.address, INITIAL_SUPPLY);
    await lpToken.mint(rewardAccount.address, INITIAL_SUPPLY);

    // Deploy mock staking precompile
    const MockStakingPrecompileFactory = await ethers.getContractFactory("MockStakingPrecompile");
    const tempMockStakingPrecompile = await MockStakingPrecompileFactory.deploy(INITIAL_ERA, BONDING_DURATION);
    // Get the bytecode of the deployed mock staking precompile
    const mockStakingPrecompileCode = await ethers.provider.getCode(await tempMockStakingPrecompile.getAddress());
    // Set the code at the STAKING_ADDRESS to the mock staking precompile bytecode
    await ethers.provider.send("hardhat_setCode", [
      STAKING_ADDRESS,
      mockStakingPrecompileCode
    ]);
    // Must set era and bonding duration again, because the stored values are not transferred with the bytecode.
    mockStakingPrecompile = await ethers.getContractAt(
      "MockStakingPrecompile",
      STAKING_ADDRESS
    );
    await mockStakingPrecompile.advanceEra(INITIAL_ERA);
    await mockStakingPrecompile.setBondingDuration(BONDING_DURATION);

    // Deploy ZenVault
    const ZenVaultFactory = await ethers.getContractFactory("ZenVault");
    zenVault = await ZenVaultFactory.deploy(owner.address, await lpToken.getAddress());

    // Set up ZenVault
    await zenVault.connect(owner).setRewardAccount(rewardAccount.address);
    await zenVault.connect(owner).setIsStakingEnabled(true);
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

    it("should enable staking by default", async function () {
      expect(await zenVault.isStakingEnabled()).to.equal(true);
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
        .to.be.revertedWith("Amount must be greater than zero.");
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
      const unlockingChunks = await zenVault.getUserUnlockingChunks(user1.address);
      expect(unlockingChunks.length).to.equal(1);
      expect(unlockingChunks[0].value).to.equal(unstakeAmount);
      expect(unlockingChunks[0].era).to.equal(INITIAL_ERA + BONDING_DURATION);
    });

    it("should emit Unstaked event when unstaking", async function () {
      const unstakeAmount = ethers.parseEther("50");
      await expect(zenVault.connect(user1).unstake(unstakeAmount))
        .to.emit(zenVault, "Unstaked")
        .withArgs(user1.address, unstakeAmount);
    });

    it("should not allow unstaking more than staked balance", async function () {
      const unstakeAmount = ethers.parseEther("150"); // More than staked
      await expect(zenVault.connect(user1).unstake(unstakeAmount))
        .to.be.revertedWith("Insufficient staked balance.");
    });

    it("should not allow unstaking zero amount", async function () {
      await expect(zenVault.connect(user1).unstake(0))
        .to.be.revertedWith("Amount must be greater than zero.");
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
      const unlockingChunks = await zenVault.getUserUnlockingChunks(user1.address);
      expect(unlockingChunks.length).to.equal(1);
      expect(unlockingChunks[0].value).to.equal(unstakeAmount);
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
      const unlockingChunks = await zenVault.getUserUnlockingChunks(user1.address);
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

  describe("Era Stake Recording", function () {
    const stakeAmount1 = ethers.parseEther("100");
    const stakeAmount2 = ethers.parseEther("200");

    beforeEach(async function () {
      // Approve and stake
      await lpToken.connect(user1).approve(await zenVault.getAddress(), stakeAmount1);
      await lpToken.connect(user2).approve(await zenVault.getAddress(), stakeAmount2);
      await zenVault.connect(user1).stake(stakeAmount1);
      await zenVault.connect(user2).stake(stakeAmount2);
    });

    it("should record era stake correctly", async function () {
      // Record era stake
      await zenVault.recordEraStake();

      // Check that era stake was recorded
      expect(await zenVault.totalStakeAtEra(INITIAL_ERA)).to.equal(stakeAmount1 + stakeAmount2);
      expect(await zenVault.lastEraUpdate()).to.equal(INITIAL_ERA);

      // Check era exposures
      const eraExposures = await zenVault.getEraExposures(INITIAL_ERA);
      expect(eraExposures.length).to.equal(2);

      // Check that user exposures were recorded
      const user1Exposures = await zenVault.getStakerExposuresForEras(user1.address, [INITIAL_ERA]);
      const user2Exposures = await zenVault.getStakerExposuresForEras(user2.address, [INITIAL_ERA]);
      expect(user1Exposures[0]).to.equal(stakeAmount1);
      expect(user2Exposures[0]).to.equal(stakeAmount2);
    });

    it("should emit EraExposureRecorded event", async function () {
      await expect(zenVault.recordEraStake())
        .to.emit(zenVault, "EraExposureRecorded")
        .withArgs(INITIAL_ERA, stakeAmount1 + stakeAmount2);
    });

    it("should not allow recording era stake twice in the same era", async function () {
      // Record era stake
      await zenVault.recordEraStake();

      // Try to record again in the same era
      await expect(zenVault.recordEraStake())
        .to.be.revertedWith("Era exposures have been finalized for the current era.");
    });

    it("should allow recording era stake in a new era", async function () {
      // Record era stake
      await zenVault.recordEraStake();

      // Advance era
      await mockStakingPrecompile.advanceEra(1);

      // Record era stake again
      await zenVault.recordEraStake();

      // Check that era stake was recorded for the new era
      expect(await zenVault.totalStakeAtEra(INITIAL_ERA + 1)).to.equal(stakeAmount1 + stakeAmount2);
      expect(await zenVault.lastEraUpdate()).to.equal(INITIAL_ERA + 1);
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

      // Record era stake
      await zenVault.recordEraStake();

      // Approve reward account to transfer rewards
      await lpToken.connect(rewardAccount).approve(await zenVault.getAddress(), rewardAmount);
    });

    it("should distribute rewards proportionally", async function () {
      // Distribute rewards
      await zenVault.connect(owner).distributeRewards(rewardAmount, INITIAL_ERA);

      // Calculate expected rewards
      const totalStake = stakeAmount1 + stakeAmount2;
      const expectedReward1 = rewardAmount * stakeAmount1 / totalStake;
      const expectedReward2 = rewardAmount * stakeAmount2 / totalStake;

      // Check that rewards were distributed correctly
      expect(await zenVault.stakedBalances(user1.address)).to.equal(stakeAmount1 + expectedReward1);
      expect(await zenVault.stakedBalances(user2.address)).to.equal(stakeAmount2 + expectedReward2);
      expect(await zenVault.totalStake()).to.equal(totalStake + rewardAmount);
    });

    it("should emit VaultRewardsDistributed event", async function () {
      // Calculate expected rewards
      const totalStake = stakeAmount1 + stakeAmount2;
      const expectedReward1 = rewardAmount * stakeAmount1 / totalStake;
      const expectedReward2 = rewardAmount * stakeAmount2 / totalStake;

      // call distributeRewards
      await expect(zenVault.connect(owner).distributeRewards(rewardAmount, INITIAL_ERA))
        .to.emit(zenVault, "VaultRewardsDistributed")
        .withArgs(INITIAL_ERA, rewardAmount, [
          [user1.address,
            expectedReward1,
          ],
          [
            user2.address,
            expectedReward2,
          ]
        ]);
    });

    it("should not allow non-owners to distribute rewards", async function () {
      await expect(zenVault.connect(user1).distributeRewards(rewardAmount, INITIAL_ERA))
        .to.be.revertedWithCustomError(zenVault, "OwnableUnauthorizedAccount").withArgs(user1.address);
    });

    it("should not allow distributing zero rewards", async function () {
      await expect(zenVault.connect(owner).distributeRewards(0, INITIAL_ERA))
        .to.be.revertedWith("Amount must be greater than zero.");
    });

    it("should not allow distributing rewards for an era with no stake", async function () {
      await expect(zenVault.connect(owner).distributeRewards(rewardAmount, INITIAL_ERA + 1))
        .to.be.revertedWith("No stake for this era");
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

      // Record era stake
      await zenVault.recordEraStake();
    });

    it("should slash stakers proportionally", async function () {
      // Slash
      await zenVault.connect(owner).doSlash(slashAmount, INITIAL_ERA);

      // Calculate expected slash amounts
      const totalStake = stakeAmount1 + stakeAmount2;
      const expectedSlash1 = slashAmount * stakeAmount1 / totalStake;
      const expectedSlash2 = slashAmount * stakeAmount2 / totalStake;

      // Check that stakers were slashed correctly
      expect(await zenVault.stakedBalances(user1.address)).to.equal(stakeAmount1 - expectedSlash1);
      expect(await zenVault.stakedBalances(user2.address)).to.equal(stakeAmount2 - expectedSlash2);
    });

    it("should emit VaultSlashed event", async function () {
      // Calculate expected slash amounts
      const totalStake = stakeAmount1 + stakeAmount2;
      const expectedSlash1 = slashAmount * stakeAmount1 / totalStake;
      const expectedSlash2 = slashAmount * stakeAmount2 / totalStake;

      // call doSlash
      await expect(zenVault.connect(owner).doSlash(slashAmount, INITIAL_ERA))
        .to.emit(zenVault, "VaultSlashed")
        .withArgs(INITIAL_ERA, slashAmount, [
          [
            user1.address,
            expectedSlash1,
          ],
          [
            user2.address,
            expectedSlash2,
          ]
        ]);
    });

    it("should not allow non-owners to slash", async function () {
      await expect(zenVault.connect(user1).doSlash(slashAmount, INITIAL_ERA))
        .to.be.revertedWithCustomError(zenVault, "OwnableUnauthorizedAccount").withArgs(user1.address)
    });

    it("should not allow slashing for an era with no stake", async function () {
      await expect(zenVault.connect(owner).doSlash(slashAmount, INITIAL_ERA + 1))
        .to.be.revertedWith("No stake for this era");
    });

    it("should slash from unlocking chunks if staked balance is insufficient", async function () {
      // Unstake all tokens
      await zenVault.connect(user1).unstake(stakeAmount1);

      // Slash
      await zenVault.connect(owner).doSlash(slashAmount, INITIAL_ERA);

      // Calculate expected slash amount for user1
      const totalStake = stakeAmount1 + stakeAmount2;
      const expectedSlash1 = slashAmount * stakeAmount1 / totalStake;

      // Check that unlocking chunks were slashed
      const unlockingChunks = await zenVault.getUserUnlockingChunks(user1.address);
      expect(unlockingChunks[0].value).to.equal(stakeAmount1 - expectedSlash1);
    });
  });

  describe("Administrative Functions", function () {
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
});

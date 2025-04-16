import {expect} from "chai";
import {ethers} from "hardhat";
import {MockStakingPrecompile, MockToken, ZenVault} from "../typechain-types";
import {SignerWithAddress} from "@nomicfoundation/hardhat-ethers/signers";
import {PRECISION_FACTOR, setupTestEnvironment} from "./utils";

describe("ZenVault Complex Scenarios", function () {
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
  const REWARD_AMOUNT = ethers.parseEther("30");
  const SLASH_AMOUNT = ethers.parseEther("20");
  const stakeAmount1 = ethers.parseEther("100");
  const stakeAmount2 = ethers.parseEther("200");

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

    // Mint and approve tokens
    await lpToken.mint(user1.address, INITIAL_SUPPLY);
    await lpToken.mint(user2.address, INITIAL_SUPPLY);
    await lpToken.connect(user1).approve(await zenVault.getAddress(), INITIAL_SUPPLY);
    await lpToken.connect(user2).approve(await zenVault.getAddress(), INITIAL_SUPPLY);

    // Stake tokens
    await zenVault.connect(user1).stake(stakeAmount1);
    await zenVault.connect(user2).stake(stakeAmount2);
  });

  it("should distribute rewards correctly after slashing occurred", async function () {
    // Do slash first
    await zenVault.connect(owner).doSlash(SLASH_AMOUNT);

    // update user states
    await zenVault.connect(user1).updateUserState();
    await zenVault.connect(user2).updateUserState();

    // Calculate expected slash amounts
    const totalStake = stakeAmount1 + stakeAmount2;
    const slashRatio = SLASH_AMOUNT * PRECISION_FACTOR / totalStake;
    const expectedSlash1 = (slashRatio * stakeAmount1) / PRECISION_FACTOR;
    const expectedSlash2 = (slashRatio * stakeAmount2) / PRECISION_FACTOR;

    // Verify slash was applied correctly
    expect(await zenVault.stakedBalances(user1.address)).to.equal(stakeAmount1 - expectedSlash1);
    expect(await zenVault.stakedBalances(user2.address)).to.equal(stakeAmount2 - expectedSlash2);

    // Now distribute rewards
    await zenVault.connect(owner).distributeRewards(REWARD_AMOUNT);

    // update user states
    await zenVault.connect(user1).updateUserState();
    await zenVault.connect(user2).updateUserState();

    // Calculate expected stake amounts after slash
    const postSlashTotalStake = totalStake - SLASH_AMOUNT;
    const postSlashStakeAmount1 = stakeAmount1 - expectedSlash1;
    const postSlashStakeAmount2 = stakeAmount2 - expectedSlash2;

    // Calculate expected rewards
    const rewardRatio = REWARD_AMOUNT * PRECISION_FACTOR / postSlashTotalStake;
    const expectedReward1 = (rewardRatio * postSlashStakeAmount1) / PRECISION_FACTOR;
    const expectedReward2 = (rewardRatio * postSlashStakeAmount2) / PRECISION_FACTOR;

    // Verify rewards were distributed correctly
    expect(await zenVault.stakedBalances(user1.address)).to.equal(
      stakeAmount1 - expectedSlash1 + expectedReward1
    );
    expect(await zenVault.stakedBalances(user2.address)).to.equal(
      stakeAmount2 - expectedSlash2 + expectedReward2
    );
  });

  it("should slash correctly after rewards were distributed", async function () {
    // Distribute rewards first
    await zenVault.connect(owner).distributeRewards(REWARD_AMOUNT);

    // update user states
    await zenVault.connect(user1).updateUserState();
    await zenVault.connect(user2).updateUserState();

    // Calculate expected rewards
    const totalStake = stakeAmount1 + stakeAmount2;
    const rewardRatio = REWARD_AMOUNT * PRECISION_FACTOR / totalStake;
    const expectedReward1 = (rewardRatio * stakeAmount1) / PRECISION_FACTOR;
    const expectedReward2 = (rewardRatio * stakeAmount2) / PRECISION_FACTOR;

    // Verify rewards were distributed correctly
    expect(await zenVault.stakedBalances(user1.address)).to.equal(stakeAmount1 + expectedReward1);
    expect(await zenVault.stakedBalances(user2.address)).to.equal(stakeAmount2 + expectedReward2);

    // Now do slash
    await zenVault.connect(owner).doSlash(SLASH_AMOUNT);

    // update user states
    await zenVault.connect(user1).updateUserState();
    await zenVault.connect(user2).updateUserState();

    // Calculate expected slash amounts (based on post-reward stake amounts)
    const postRewardTotalStake = totalStake + REWARD_AMOUNT;
    const slashRatio = SLASH_AMOUNT * PRECISION_FACTOR / postRewardTotalStake;
    const expectedSlash1 = (slashRatio * (stakeAmount1 + expectedReward1)) / PRECISION_FACTOR;
    const expectedSlash2 = (slashRatio * (stakeAmount2 + expectedReward2)) / PRECISION_FACTOR;

    // Verify slash was applied correctly to the post-reward balances
    expect(await zenVault.stakedBalances(user1.address)).to.equal(
      stakeAmount1 + expectedReward1 - expectedSlash1
    );
    expect(await zenVault.stakedBalances(user2.address)).to.equal(
      stakeAmount2 + expectedReward2 - expectedSlash2
    );
  });

  it("verify rewarded amount is withdrawable", async function () {
    // Distribute rewards
    await zenVault.connect(owner).distributeRewards(REWARD_AMOUNT);

    // update user state
    await zenVault.connect(user1).updateUserState();

    // Calculate expected reward
    const totalStake = stakeAmount1 + stakeAmount2;
    const rewardRatio = REWARD_AMOUNT * PRECISION_FACTOR / totalStake;
    const expectedReward1 = (rewardRatio * stakeAmount1) / PRECISION_FACTOR;

    // Verify reward was added to staked balance
    expect(await zenVault.stakedBalances(user1.address)).to.equal(stakeAmount1 + expectedReward1);

    // Unstake all tokens (including rewards)
    const totalStaked = stakeAmount1 + expectedReward1;
    await zenVault.connect(user1).unstake(totalStaked);

    // Verify staked balance is now zero
    expect(await zenVault.stakedBalances(user1.address)).to.equal(0);

    // Verify unlocking chunk contains the full amount
    const unlockingChunks = await zenVault.getUnlockingChunks(user1.address);
    expect(unlockingChunks.length).to.equal(1);
    expect(unlockingChunks[0].value).to.equal(totalStaked);

    // Advance era to after bonding period
    await mockStakingPrecompile.advanceEra(BONDING_DURATION + 1);

    // Get initial LP token balance
    const initialBalance = await lpToken.balanceOf(user1.address);

    // Withdraw unlocked tokens
    await zenVault.connect(user1).withdrawUnlocked();

    // Verify the full amount (including rewards) was withdrawn
    const finalBalance = await lpToken.balanceOf(user1.address);
    expect(finalBalance - initialBalance).to.equal(totalStaked);
  });

  it("should handle unstake and withdraw after slash", async function () {
    // Apply slash
    await zenVault.connect(owner).doSlash(SLASH_AMOUNT);

    // update user states
    await zenVault.connect(user1).updateUserState();

    // Calculate expected remaining amount after slash
    const totalStake = stakeAmount1 + stakeAmount2;
    const slashRatio = SLASH_AMOUNT * PRECISION_FACTOR / totalStake;
    const expectedSlash1 = (slashRatio * stakeAmount1) / PRECISION_FACTOR;
    const expectedRemaining = stakeAmount1 - expectedSlash1;

    // Verify staked balance was reduced by slash amount
    expect(await zenVault.stakedBalances(user1.address)).to.equal(expectedRemaining);

    // Unstake all remaining tokens
    await zenVault.connect(user1).unstake(expectedRemaining);

    // Verify staked balance is now zero
    expect(await zenVault.stakedBalances(user1.address)).to.equal(0);

    // Verify unlocking chunk contains the reduced amount
    const unlockingChunks = await zenVault.getUnlockingChunks(user1.address);
    expect(unlockingChunks.length).to.equal(1);
    expect(unlockingChunks[0].value).to.equal(expectedRemaining);

    // Advance era to after bonding period
    await mockStakingPrecompile.advanceEra(BONDING_DURATION + 1);

    // Get initial LP token balance
    const initialBalance = await lpToken.balanceOf(user1.address);

    // Withdraw unlocked tokens
    await zenVault.connect(user1).withdrawUnlocked();

    // Verify the reduced amount was withdrawn
    const finalBalance = await lpToken.balanceOf(user1.address);
    expect(finalBalance - initialBalance).to.equal(expectedRemaining);
  });

  it("should handle slashing from unlocking chunks that were created after rewards were added", async function () {
    // Distribute rewards
    await zenVault.connect(owner).distributeRewards(REWARD_AMOUNT);

    // update user state
    await zenVault.connect(user1).updateUserState();
    await zenVault.connect(user2).updateUserState();

    // Verify reward was added to staked balance
    const initialTotalStake = stakeAmount1 + stakeAmount2;
    const rewardRatio = REWARD_AMOUNT * PRECISION_FACTOR / initialTotalStake;
    const expectedReward1 = (rewardRatio * stakeAmount1) / PRECISION_FACTOR;
    const totalUserStake1 = stakeAmount1 + expectedReward1; // 100 + 10 = 110
    expect(await zenVault.stakedBalances(user1.address)).to.equal(totalUserStake1);

    // Unstake half of the tokens (creating an unlocking chunk) for user1
    const unstakeAmount = totalUserStake1 / 2n; // 55
    await zenVault.connect(user1).unstake(unstakeAmount);

    // Verify staked balance is reduced
    expect(await zenVault.stakedBalances(user1.address)).to.equal(totalUserStake1 - unstakeAmount);

    // Verify unlocking chunk
    let unlockingChunks = await zenVault.getUnlockingChunks(user1.address);
    expect(unlockingChunks.length).to.equal(1);
    expect(unlockingChunks[0].value).to.equal(unstakeAmount);

    // Apply a large slash
    const bigSlashAmount = SLASH_AMOUNT * 12n; // 20 * 12 = 240
    await zenVault.connect(owner).doSlash(bigSlashAmount);

    // update user state
    await zenVault.connect(user1).updateUserState();

    // Calculate how much should be slashed from each portion
    // In the new contract, slash is proportional to current stake, not original stake
    const currentTotalSlashableStake = initialTotalStake + REWARD_AMOUNT;
    const slashRatio = bigSlashAmount * PRECISION_FACTOR / currentTotalSlashableStake;
    const expectedSlash1 = (slashRatio * totalUserStake1) / PRECISION_FACTOR;

    // If stakedPortion is completely slashed, the remaining slash goes to unlocking chunks
    const stakedPortion = totalUserStake1 - unstakeAmount;
    const slashFromStaked = stakedPortion >= expectedSlash1 ? expectedSlash1 : stakedPortion;
    const remainingSlash = expectedSlash1 > stakedPortion ? expectedSlash1 - stakedPortion : 0n;

    // Verify staked balance after slash
    const expectedStakedBalance = stakedPortion - slashFromStaked;
    expect(await zenVault.stakedBalances(user1.address)).to.equal(expectedStakedBalance);

    // Verify unlocking chunk was slashed
    unlockingChunks = await zenVault.getUnlockingChunks(user1.address);
    expect(unlockingChunks[0].value).to.equal(unstakeAmount - remainingSlash);
  });

  it("should handle slashing from multiple unlocking chunks", async function () {
    // unstake user 2 to simplify math
    await zenVault.connect(user2).unstake(stakeAmount2);
    expect(await zenVault.totalStake()).to.equal(stakeAmount1);

    // create unlocking chunks, such that the user's stake is split evenly between chunks and staked balance
    const numUnlockingChunks = 3;
    const chunkSize = stakeAmount1 / BigInt(numUnlockingChunks + 1);
    for (let i = 0; i < numUnlockingChunks; i++) {
      await zenVault.connect(user1).unstake(chunkSize);
    }

    // Verify unlocking chunks
    let unlockingChunks = await zenVault.getUnlockingChunks(user1.address);
    expect(unlockingChunks.length).to.equal(3);
    for (let i = 0; i < numUnlockingChunks; i++) {
      expect(unlockingChunks[i].value).to.equal(chunkSize);
    }

    // Verify user stake
    const totalStake = await zenVault.totalStake();
    const userStake = await zenVault.stakedBalances(user1);
    expect(userStake).to.equal(totalStake);
    expect(userStake).to.equal(stakeAmount1 / 4n);

    // Apply slash equal to staked balance, plus all but one of the unlocking chunks, plus part of the final chunk
    const extra = ethers.parseEther("5");
    const bigSlashAmount = chunkSize * BigInt(numUnlockingChunks) + extra;
    await zenVault.connect(owner).doSlash(bigSlashAmount);

    // update user state
    await zenVault.connect(user1).updateUserState();

    // Verify staked balance was reduced to zero
    // The slash should be applied first to the staked balance and then to unlocking amounts

    // Verify staked balance after slash
    expect(await zenVault.stakedBalances(user1.address)).to.equal(0);

    // Verify unlocking chunks were slashed
    unlockingChunks = await zenVault.getUnlockingChunks(user1.address);
    // The new contract slashes newest chunks first
    expect(unlockingChunks.length).to.be.lte(3);
    if (unlockingChunks.length > 0) {
      // At least one chunk should remain with reduced value
      const lastChunk = unlockingChunks[unlockingChunks.length - 1];
      expect(lastChunk.value).to.be.lt(chunkSize);
    }
  });
});

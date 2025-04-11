import {expect} from "chai";
import {ethers} from "hardhat";
import {MockStakingPrecompile, MockToken, ZenVault} from "../typechain-types";
import {SignerWithAddress} from "@nomicfoundation/hardhat-ethers/signers";
import {createMultipleUnlockingChunks, PRECISION_FACTOR, setupTestEnvironment} from "./utils";

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

    // Record era stake
    await zenVault.recordEraStake();
  });

  it("should distribute rewards correctly for an era after slashing occurred for that same era", async function () {
    // Do slash first
    await zenVault.connect(owner).doSlash(SLASH_AMOUNT, INITIAL_ERA);

    // Calculate expected slash amounts
    const totalStake = stakeAmount1 + stakeAmount2;
    const slashRatio = SLASH_AMOUNT * PRECISION_FACTOR / totalStake;
    const expectedSlash1 = (slashRatio * stakeAmount1) / PRECISION_FACTOR;
    const expectedSlash2 = (slashRatio * stakeAmount2) / PRECISION_FACTOR;

    // Verify slash was applied correctly
    expect(await zenVault.stakedBalances(user1.address)).to.equal(stakeAmount1 - expectedSlash1);
    expect(await zenVault.stakedBalances(user2.address)).to.equal(stakeAmount2 - expectedSlash2);

    // Now distribute rewards
    await zenVault.connect(owner).distributeRewards(REWARD_AMOUNT, INITIAL_ERA);

    // Calculate expected rewards (based on original stake amounts, not post-slash)
    const rewardRatio = REWARD_AMOUNT * PRECISION_FACTOR / totalStake;
    const expectedReward1 = (rewardRatio * stakeAmount1) / PRECISION_FACTOR;
    const expectedReward2 = (rewardRatio * stakeAmount2) / PRECISION_FACTOR;

    // Verify rewards were distributed correctly
    expect(await zenVault.stakedBalances(user1.address)).to.equal(
      stakeAmount1 - expectedSlash1 + expectedReward1
    );
    expect(await zenVault.stakedBalances(user2.address)).to.equal(
      stakeAmount2 - expectedSlash2 + expectedReward2
    );
  });

  it("should slash correctly for an era after rewards were distributed for that same era", async function () {
    // Distribute rewards first
    await zenVault.connect(owner).distributeRewards(REWARD_AMOUNT, INITIAL_ERA);

    // Calculate expected rewards
    const totalStake = stakeAmount1 + stakeAmount2;
    const rewardRatio = REWARD_AMOUNT * PRECISION_FACTOR / totalStake;
    const expectedReward1 = (rewardRatio * stakeAmount1) / PRECISION_FACTOR;
    const expectedReward2 = (rewardRatio * stakeAmount2) / PRECISION_FACTOR;

    // Verify rewards were distributed correctly
    expect(await zenVault.stakedBalances(user1.address)).to.equal(stakeAmount1 + expectedReward1);
    expect(await zenVault.stakedBalances(user2.address)).to.equal(stakeAmount2 + expectedReward2);

    // Now do slash
    await zenVault.connect(owner).doSlash(SLASH_AMOUNT, INITIAL_ERA);

    // Calculate expected slash amounts (based on original stake amounts, not post-reward)
    const slashRatio = SLASH_AMOUNT * PRECISION_FACTOR / totalStake;
    const expectedSlash1 = (slashRatio * stakeAmount1) / PRECISION_FACTOR;
    const expectedSlash2 = (slashRatio * stakeAmount2) / PRECISION_FACTOR;

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
    await zenVault.connect(owner).distributeRewards(REWARD_AMOUNT, INITIAL_ERA);

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
    const unlockingChunks = await zenVault.getUserUnlockingChunks(user1.address);
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
    await zenVault.connect(owner).doSlash(SLASH_AMOUNT, INITIAL_ERA);

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
    const unlockingChunks = await zenVault.getUserUnlockingChunks(user1.address);
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
    await zenVault.connect(owner).distributeRewards(REWARD_AMOUNT, INITIAL_ERA);

    // Verify reward was added to staked balance
    const initialTotalStake = stakeAmount1 + stakeAmount2;
    const rewardRatio = REWARD_AMOUNT * PRECISION_FACTOR / initialTotalStake;
    const expectedReward1 = (rewardRatio * stakeAmount1) / PRECISION_FACTOR;
    const totalUserStake = stakeAmount1 + expectedReward1; // 100 + 10 = 110
    expect(await zenVault.stakedBalances(user1.address)).to.equal(totalUserStake);

    // Unstake half of the tokens (creating an unlocking chunk)
    const unstakeAmount = totalUserStake / 2n; // 55
    await zenVault.connect(user1).unstake(unstakeAmount);

    // Verify staked balance is reduced
    expect(await zenVault.stakedBalances(user1.address)).to.equal(totalUserStake - unstakeAmount);

    // Verify unlocking chunk
    let unlockingChunks = await zenVault.getUserUnlockingChunks(user1.address);
    expect(unlockingChunks.length).to.equal(1);
    expect(unlockingChunks[0].value).to.equal(unstakeAmount);

    // Advance to next era and record it
    await mockStakingPrecompile.advanceEra(1);
    await zenVault.recordEraStake();

    // Apply slash to the new era
    const bigSlashAmount = SLASH_AMOUNT * 12n; // 20 * 12 = 240
    await zenVault.connect(owner).doSlash(bigSlashAmount, INITIAL_ERA);
    const slashRatio = bigSlashAmount * PRECISION_FACTOR / initialTotalStake;
    const expectedSlash1 = (slashRatio * stakeAmount1) / PRECISION_FACTOR;

    // Verify staked balance was reduced to zero
    // The slash should be applied first to the staked balance and then to unlocking amounts

    // Calculate how much should be slashed from each portion
    const stakedPortion = totalUserStake - unstakeAmount;
    const unlockingPortion = unstakeAmount;

    const slashFromStaked = stakedPortion >= expectedSlash1 ? expectedSlash1 : stakedPortion;
    const slashFromUnlocking = stakedPortion >= expectedSlash1 ? 0n : expectedSlash1 - stakedPortion;

    // Verify staked balance after slash
    expect(await zenVault.stakedBalances(user1.address)).to.equal(stakedPortion - slashFromStaked);

    // Verify unlocking chunk was slashed
    unlockingChunks = await zenVault.getUserUnlockingChunks(user1.address);
    expect(unlockingChunks[0].value).to.equal(unlockingPortion - slashFromUnlocking);
  });

  it("should handle slashing from multiple unlocking chunks", async function () {
    // unstake user 2 to simplify math
    await zenVault.connect(user2).unstake(stakeAmount2);
    expect(await zenVault.totalStake()).to.equal(stakeAmount1);
    // move to era 1 so we can control the total exposure
    await mockStakingPrecompile.advanceEra(1);
    await zenVault.recordEraStake();

    // create unlocking chunks, such that the user's stake is split evenly between chunks and staked balance
    const numUnlockingChunks = 3;
    const chunkSize = stakeAmount1 / BigInt(numUnlockingChunks + 1);
    for (let i = 0; i < numUnlockingChunks; i++) {
      await zenVault.connect(user1).unstake(chunkSize);
    }

    // Verify unlocking chunks
    let unlockingChunks = await zenVault.getUserUnlockingChunks(user1.address);
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
    await zenVault.connect(owner).doSlash(bigSlashAmount, INITIAL_ERA + 1);

    // Verify staked balance was reduced to zero
    // The slash should be applied first to the staked balance and then to unlocking amounts

    // Verify staked balance after slash
    expect(await zenVault.stakedBalances(user1.address)).to.equal(0);

    // Verify unlocking chunks were slashed
    unlockingChunks = await zenVault.getUserUnlockingChunks(user1.address);
    expect(unlockingChunks.length).to.equal(1);
    expect(unlockingChunks[0].value).to.equal(chunkSize - extra);
  });
});
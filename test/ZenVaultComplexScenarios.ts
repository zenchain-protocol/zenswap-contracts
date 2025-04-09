import {expect} from "chai";
import {ethers} from "hardhat";
import {MockStakingPrecompile, MockToken, ZenVault} from "../typechain-types";
import {SignerWithAddress} from "@nomicfoundation/hardhat-ethers/signers";
import {setupTestEnvironment} from "./utils";

describe("ZenVault Complex Scenarios", function () {
  // Contracts
  let zenVault: ZenVault;
  let mockStakingPrecompile: MockStakingPrecompile;
  let lpToken: MockToken;

  // Signers
  let owner: SignerWithAddress;
  let rewardAccount: SignerWithAddress;

  // Constants
  const STAKING_ADDRESS = "0x0000000000000000000000000000000000000800";
  const INITIAL_SUPPLY = ethers.parseEther("1000000");
  const INITIAL_ERA = 1;
  const BONDING_DURATION = 2;
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

    // Approve rewards
    await lpToken.connect(rewardAccount).approve(await zenVault.getAddress(), INITIAL_SUPPLY);
  });

  it("should distribute rewards correctly for an era after slashing occurred for that same era", async function () {
    // Setup stakers
    const user1 = (await ethers.getSigners())[2];
    const user2 = (await ethers.getSigners())[3];

    // Mint and approve tokens
    await lpToken.mint(user1.address, INITIAL_SUPPLY);
    await lpToken.mint(user2.address, INITIAL_SUPPLY);
    await lpToken.connect(user1).approve(await zenVault.getAddress(), INITIAL_SUPPLY);
    await lpToken.connect(user2).approve(await zenVault.getAddress(), INITIAL_SUPPLY);

    // Stake tokens
    const stakeAmount1 = ethers.parseEther("100");
    const stakeAmount2 = ethers.parseEther("200");
    await zenVault.connect(user1).stake(stakeAmount1);
    await zenVault.connect(user2).stake(stakeAmount2);

    // Record era stake
    await zenVault.recordEraStake();

    // Do slash first
    await zenVault.connect(owner).doSlash(SLASH_AMOUNT, INITIAL_ERA);

    // Calculate expected slash amounts
    const totalStake = stakeAmount1 + stakeAmount2;
    const expectedSlash1 = (SLASH_AMOUNT * stakeAmount1) / totalStake;
    const expectedSlash2 = (SLASH_AMOUNT * stakeAmount2) / totalStake;

    // Verify slash was applied correctly
    expect(await zenVault.stakedBalances(user1.address)).to.equal(stakeAmount1 - expectedSlash1);
    expect(await zenVault.stakedBalances(user2.address)).to.equal(stakeAmount2 - expectedSlash2);

    // Now distribute rewards
    await zenVault.connect(owner).distributeRewards(REWARD_AMOUNT, INITIAL_ERA);

    // Calculate expected rewards (based on original stake amounts, not post-slash)
    const expectedReward1 = (REWARD_AMOUNT * stakeAmount1) / totalStake;
    const expectedReward2 = (REWARD_AMOUNT * stakeAmount2) / totalStake;

    // Verify rewards were distributed correctly
    expect(await zenVault.stakedBalances(user1.address)).to.equal(
      stakeAmount1 - expectedSlash1 + expectedReward1
    );
    expect(await zenVault.stakedBalances(user2.address)).to.equal(
      stakeAmount2 - expectedSlash2 + expectedReward2
    );
  });

  it("should slash correctly for an era after rewards were distributed for that same era", async function () {
    // Setup stakers
    const user1 = (await ethers.getSigners())[2];
    const user2 = (await ethers.getSigners())[3];

    // Mint and approve tokens
    await lpToken.mint(user1.address, INITIAL_SUPPLY);
    await lpToken.mint(user2.address, INITIAL_SUPPLY);
    await lpToken.connect(user1).approve(await zenVault.getAddress(), INITIAL_SUPPLY);
    await lpToken.connect(user2).approve(await zenVault.getAddress(), INITIAL_SUPPLY);

    // Stake tokens
    const stakeAmount1 = ethers.parseEther("100");
    const stakeAmount2 = ethers.parseEther("200");
    await zenVault.connect(user1).stake(stakeAmount1);
    await zenVault.connect(user2).stake(stakeAmount2);

    // Record era stake
    await zenVault.recordEraStake();

    // Distribute rewards first
    await zenVault.connect(owner).distributeRewards(REWARD_AMOUNT, INITIAL_ERA);

    // Calculate expected rewards
    const totalStake = stakeAmount1 + stakeAmount2;
    const expectedReward1 = (REWARD_AMOUNT * stakeAmount1) / totalStake;
    const expectedReward2 = (REWARD_AMOUNT * stakeAmount2) / totalStake;

    // Verify rewards were distributed correctly
    expect(await zenVault.stakedBalances(user1.address)).to.equal(stakeAmount1 + expectedReward1);
    expect(await zenVault.stakedBalances(user2.address)).to.equal(stakeAmount2 + expectedReward2);

    // Now do slash
    await zenVault.connect(owner).doSlash(SLASH_AMOUNT, INITIAL_ERA);

    // Calculate expected slash amounts (based on original stake amounts, not post-reward)
    const expectedSlash1 = (SLASH_AMOUNT * stakeAmount1) / totalStake;
    const expectedSlash2 = (SLASH_AMOUNT * stakeAmount2) / totalStake;

    // Verify slash was applied correctly to the post-reward balances
    expect(await zenVault.stakedBalances(user1.address)).to.equal(
      stakeAmount1 + expectedReward1 - expectedSlash1
    );
    expect(await zenVault.stakedBalances(user2.address)).to.equal(
      stakeAmount2 + expectedReward2 - expectedSlash2
    );
  });

  it("should handle staking -> record -> reward -> unstake -> wait -> withdraw (verify rewarded amount is withdrawable)", async function () {
    // Setup staker
    const user = (await ethers.getSigners())[2];

    // Mint and approve tokens
    await lpToken.mint(user.address, INITIAL_SUPPLY);
    await lpToken.connect(user).approve(await zenVault.getAddress(), INITIAL_SUPPLY);

    // Stake tokens
    const stakeAmount = ethers.parseEther("100");
    await zenVault.connect(user).stake(stakeAmount);

    // Record era stake
    await zenVault.recordEraStake();

    // Distribute rewards
    await zenVault.connect(owner).distributeRewards(REWARD_AMOUNT, INITIAL_ERA);

    // Calculate expected reward
    const expectedReward = REWARD_AMOUNT; // Only one staker, so they get all rewards

    // Verify reward was added to staked balance
    expect(await zenVault.stakedBalances(user.address)).to.equal(stakeAmount + expectedReward);

    // Unstake all tokens (including rewards)
    const totalStaked = stakeAmount + expectedReward;
    await zenVault.connect(user).unstake(totalStaked);

    // Verify staked balance is now zero
    expect(await zenVault.stakedBalances(user.address)).to.equal(0);

    // Verify unlocking chunk contains the full amount
    const unlockingChunks = await zenVault.getUserUnlockingChunks(user.address);
    expect(unlockingChunks.length).to.equal(1);
    expect(unlockingChunks[0].value).to.equal(totalStaked);

    // Advance era to after bonding period
    await mockStakingPrecompile.advanceEra(BONDING_DURATION + 1);

    // Get initial LP token balance
    const initialBalance = await lpToken.balanceOf(user.address);

    // Withdraw unlocked tokens
    await zenVault.connect(user).withdrawUnlocked();

    // Verify the full amount (including rewards) was withdrawn
    const finalBalance = await lpToken.balanceOf(user.address);
    expect(finalBalance - initialBalance).to.equal(totalStaked);
  });

  it("should handle staking -> record -> slash -> unstake (verify less amount unstaked) -> wait -> withdraw", async function () {
    // Setup staker
    const user = (await ethers.getSigners())[2];

    // Mint and approve tokens
    await lpToken.mint(user.address, INITIAL_SUPPLY);
    await lpToken.connect(user).approve(await zenVault.getAddress(), INITIAL_SUPPLY);

    // Stake tokens
    const stakeAmount = ethers.parseEther("100");
    await zenVault.connect(user).stake(stakeAmount);

    // Record era stake
    await zenVault.recordEraStake();

    // Apply slash
    await zenVault.connect(owner).doSlash(SLASH_AMOUNT, INITIAL_ERA);

    // Calculate expected remaining amount after slash
    const expectedRemaining = stakeAmount - SLASH_AMOUNT;

    // Verify staked balance was reduced by slash amount
    expect(await zenVault.stakedBalances(user.address)).to.equal(expectedRemaining);

    // Unstake all remaining tokens
    await zenVault.connect(user).unstake(expectedRemaining);

    // Verify staked balance is now zero
    expect(await zenVault.stakedBalances(user.address)).to.equal(0);

    // Verify unlocking chunk contains the reduced amount
    const unlockingChunks = await zenVault.getUserUnlockingChunks(user.address);
    expect(unlockingChunks.length).to.equal(1);
    expect(unlockingChunks[0].value).to.equal(expectedRemaining);

    // Advance era to after bonding period
    await mockStakingPrecompile.advanceEra(BONDING_DURATION + 1);

    // Get initial LP token balance
    const initialBalance = await lpToken.balanceOf(user.address);

    // Withdraw unlocked tokens
    await zenVault.connect(user).withdrawUnlocked();

    // Verify the reduced amount was withdrawn
    const finalBalance = await lpToken.balanceOf(user.address);
    expect(finalBalance - initialBalance).to.equal(expectedRemaining);
  });

  it("should handle slashing from unlocking chunks that were created after rewards were added", async function () {
    // Setup staker
    const user = (await ethers.getSigners())[2];

    // Mint and approve tokens
    await lpToken.mint(user.address, INITIAL_SUPPLY);
    await lpToken.connect(user).approve(await zenVault.getAddress(), INITIAL_SUPPLY);

    // Stake tokens
    const stakeAmount = ethers.parseEther("100");
    await zenVault.connect(user).stake(stakeAmount);

    // Record era stake
    await zenVault.recordEraStake();

    // Distribute rewards
    await zenVault.connect(owner).distributeRewards(REWARD_AMOUNT, INITIAL_ERA);

    // Verify reward was added to staked balance
    const totalStaked = stakeAmount + REWARD_AMOUNT;
    expect(await zenVault.stakedBalances(user.address)).to.equal(totalStaked);

    // Unstake half of the tokens (creating an unlocking chunk)
    const unstakeAmount = totalStaked / 2n;
    await zenVault.connect(user).unstake(unstakeAmount);

    // Verify staked balance is reduced
    expect(await zenVault.stakedBalances(user.address)).to.equal(totalStaked - unstakeAmount);

    // Verify unlocking chunk
    let unlockingChunks = await zenVault.getUserUnlockingChunks(user.address);
    expect(unlockingChunks.length).to.equal(1);
    expect(unlockingChunks[0].value).to.equal(unstakeAmount);

    // Advance to next era and record it
    await mockStakingPrecompile.advanceEra(1);
    await zenVault.recordEraStake();

    // Apply slash to the new era
    await zenVault.connect(owner).doSlash(SLASH_AMOUNT, INITIAL_ERA + 1);

    // Verify staked balance was reduced by slash amount
    // Since there's only one staker, they get the full slash
    // But the slash should be applied proportionally to staked and unlocking amounts

    // Calculate how much should be slashed from each portion
    const totalValue = totalStaked; // Total value before unstaking
    const stakedPortion = totalStaked - unstakeAmount;
    const unlockingPortion = unstakeAmount;

    const slashFromStaked = (SLASH_AMOUNT * stakedPortion) / totalValue;
    const slashFromUnlocking = (SLASH_AMOUNT * unlockingPortion) / totalValue;

    // Verify staked balance after slash
    expect(await zenVault.stakedBalances(user.address)).to.equal(stakedPortion - slashFromStaked);

    // Verify unlocking chunk was slashed
    unlockingChunks = await zenVault.getUserUnlockingChunks(user.address);
    expect(unlockingChunks[0].value).to.equal(unlockingPortion - slashFromUnlocking);
  });
});
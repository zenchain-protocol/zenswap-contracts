import { ethers } from "hardhat";
import { ZenVault, MockToken, MockStakingPrecompile } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import {
  createMultipleUnlockingChunks,
  setupLargeNumberOfStakers,
  setupTestEnvironment
} from "./utils";
import {expect} from "chai";

describe("ZenVault Gas Tests", function () {
  // Contracts
  let zenVault: ZenVault;
  let mockStakingPrecompile: MockStakingPrecompile;
  let lpToken: MockToken;

  // Signers
  let owner: SignerWithAddress;
  let rewardAccount: SignerWithAddress;
  let user1: SignerWithAddress;

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
    mockStakingPrecompile = testEnvironment.mockStakingPrecompile;
    lpToken = testEnvironment.lpToken;
    owner = testEnvironment.owner;
    rewardAccount = testEnvironment.rewardAccount;
    user1 = testEnvironment.user1;

    // Approve rewards
    await lpToken.connect(rewardAccount).approve(await zenVault.getAddress(), INITIAL_SUPPLY);
  });

  it("should test gas costs for stake from new user", async function () {
    await lpToken.mint(user1.address, INITIAL_SUPPLY);
    await lpToken.connect(user1).approve(await zenVault.getAddress(), INITIAL_SUPPLY);

    // Measure gas used for stake
    const tx = await zenVault.connect(user1).stake(STAKE_AMOUNT);
    const receipt = await tx.wait();

    console.log(`Gas used for stake from new user: ${receipt?.gasUsed}`);
  });

  it("should test gas costs for stake (second call)", async function () {
    await lpToken.mint(user1.address, 2n * INITIAL_SUPPLY);
    await lpToken.connect(user1).approve(await zenVault.getAddress(), 2n * INITIAL_SUPPLY);

    // Measure gas used for stake
    await zenVault.connect(user1).stake(STAKE_AMOUNT);
    const tx = await zenVault.connect(user1).stake(STAKE_AMOUNT);
    const receipt = await tx.wait();

    console.log(`Gas used for second stake: ${receipt?.gasUsed}`);
  });

  it("should test gas costs for full unstake", async function () {
    await lpToken.mint(user1.address, INITIAL_SUPPLY);
    await lpToken.connect(user1).approve(await zenVault.getAddress(), INITIAL_SUPPLY);
    await zenVault.connect(user1).stake(STAKE_AMOUNT);

    expect(await zenVault.stakedBalances(user1)).to.equal(STAKE_AMOUNT);

    // Measure gas used for stake
    const tx = await zenVault.connect(user1).unstake(STAKE_AMOUNT);
    const receipt = await tx.wait();

    console.log(`Gas used for full unstake: ${receipt?.gasUsed}`);
  });

  it("should test gas costs for partial unstake", async function () {
    await lpToken.mint(user1.address, INITIAL_SUPPLY);
    await lpToken.connect(user1).approve(await zenVault.getAddress(), INITIAL_SUPPLY);
    await zenVault.connect(user1).stake(STAKE_AMOUNT);

    // Measure gas used for stake
    const tx = await zenVault.connect(user1).unstake(STAKE_AMOUNT / 2n);
    const receipt = await tx.wait();

    console.log(`Gas used for partial unstake: ${receipt?.gasUsed}`);
  });

  it("should test gas costs with a large number of stakers for recordEraStake", async function () {
    // Setup stakers
    const numStakers = 100;
    await setupLargeNumberOfStakers(numStakers, lpToken, zenVault, INITIAL_SUPPLY, STAKE_AMOUNT);

    // Measure gas used for recordEraStake
    const tx = await zenVault.recordEraStake();
    const receipt = await tx.wait();

    console.log(`Gas used for recordEraStake with ${numStakers} stakers: ${receipt?.gasUsed}`);
  });

  it("should test gas costs with a large number of stakers for distributeRewards", async function () {
    // Setup stakers
    const numStakers = 100;
    await setupLargeNumberOfStakers(numStakers, lpToken, zenVault, INITIAL_SUPPLY, STAKE_AMOUNT);

    // Record era stake
    await zenVault.recordEraStake();

    // Measure gas used for distributeRewards
    const tx = await zenVault.connect(owner).distributeRewards(REWARD_AMOUNT, INITIAL_ERA);
    const receipt = await tx.wait();

    console.log(`Gas used for distributeRewards with ${numStakers} stakers: ${receipt?.gasUsed}`);
  });

  it("should test gas costs with a large number of stakers for doSlash (no unlock chunks)", async function () {
    // Setup stakers
    const numStakers = 100;
    await setupLargeNumberOfStakers(numStakers, lpToken, zenVault, INITIAL_SUPPLY, STAKE_AMOUNT);

    // Record era stake
    await zenVault.recordEraStake();

    // Measure gas used for doSlash
    const tx = await zenVault.connect(owner).doSlash(SLASH_AMOUNT, INITIAL_ERA);
    const receipt = await tx.wait();

    console.log(`Gas used for doSlash with ${numStakers} staked stakers: ${receipt?.gasUsed}`);
  });

  it("should test gas costs with a large number of stakers for doSlash (each with staked balance + 2 unlocking chunks)", async function () {
    // Setup stakers
    const numStakers = 100;
    const stakers = await setupLargeNumberOfStakers(numStakers, lpToken, zenVault, INITIAL_SUPPLY, STAKE_AMOUNT);

    // Record era stake
    await zenVault.recordEraStake();

    // calculate unrealistically big slash
    const totalStake = await zenVault.totalStake();
    const slashAmount = totalStake * 80n / 100n;

    // unstake each staker, keeping 1/3 staked balance and 1/3 in each of two unlocking chunks
    for (const staker of stakers) {
      await zenVault.connect(staker).unstake(STAKE_AMOUNT / 3n);
      await zenVault.connect(staker).unstake(STAKE_AMOUNT / 3n);
    }

    // Measure gas used for doSlash
    const tx = await zenVault.connect(owner).doSlash(slashAmount, INITIAL_ERA);
    const receipt = await tx.wait();

    console.log(`Gas used for doSlash with ${numStakers} unstaking stakers: ${receipt?.gasUsed}`);
  });

  it("should test gas costs with a large number of unlocking chunks for withdrawUnlocked", async function () {
    // Get a user
    const user = (await ethers.getSigners())[2];

    // Create max unlocking chunks
    const numChunks = Number(await zenVault.maxUnlockChunks());
    await createMultipleUnlockingChunks(user, numChunks, lpToken, zenVault, STAKE_AMOUNT);

    // Advance era to after bonding period
    await mockStakingPrecompile.advanceEra(BONDING_DURATION + 1);

    // Measure gas used for withdrawUnlocked
    const tx = await zenVault.connect(user).withdrawUnlocked();
    const receipt = await tx.wait();

    console.log(`Gas used for withdrawUnlocked with ${numChunks} unlocking chunks: ${receipt?.gasUsed}`);
  });
});

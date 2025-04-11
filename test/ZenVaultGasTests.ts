import { ethers } from "hardhat";
import { ZenVault, MockToken, MockStakingPrecompile } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import {createMultipleUnlockingChunks, setupLargeNumberOfStakers, setupTestEnvironment} from "./utils";
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

  it("should test gas costs for stake", async function () {
    await lpToken.mint(user1.address, INITIAL_SUPPLY);
    await lpToken.connect(user1).approve(await zenVault.getAddress(), INITIAL_SUPPLY);

    // Measure gas used for stake
    const tx = await zenVault.connect(user1).stake(STAKE_AMOUNT);
    const receipt = await tx.wait();

    console.log(`Gas used for stake: ${receipt?.gasUsed}`);
  });

  it("should test gas costs for unstake", async function () {
    await lpToken.mint(user1.address, INITIAL_SUPPLY);
    await lpToken.connect(user1).approve(await zenVault.getAddress(), INITIAL_SUPPLY);
    await zenVault.connect(user1).stake(STAKE_AMOUNT);

    // Measure gas used for stake
    const tx = await zenVault.connect(user1).unstake(STAKE_AMOUNT);
    const receipt = await tx.wait();

    console.log(`Gas used for unstake: ${receipt?.gasUsed}`);
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

  it("should test gas costs with a large number of stakers for doSlash", async function () {
    // Setup stakers
    const numStakers = 100;
    await setupLargeNumberOfStakers(numStakers, lpToken, zenVault, INITIAL_SUPPLY, STAKE_AMOUNT);

    // Record era stake
    await zenVault.recordEraStake();

    // Measure gas used for doSlash
    const tx = await zenVault.connect(owner).doSlash(SLASH_AMOUNT, INITIAL_ERA);
    const receipt = await tx.wait();

    console.log(`Gas used for doSlash with ${numStakers} stakers: ${receipt?.gasUsed}`);
  });

  it("should test gas costs with a large number of unlocking chunks for withdrawUnlocked", async function () {
    // Get a user
    const user = (await ethers.getSigners())[2];

    // Create many unlocking chunks
    const numChunks = 50; // Start with 50 chunks
    await createMultipleUnlockingChunks(user, numChunks, lpToken, zenVault, STAKE_AMOUNT);

    // Advance era to after bonding period
    await mockStakingPrecompile.advanceEra(BONDING_DURATION + 1);

    // Measure gas used for withdrawUnlocked
    const tx = await zenVault.connect(user).withdrawUnlocked();
    const receipt = await tx.wait();

    console.log(`Gas used for withdrawUnlocked with ${numChunks} unlocking chunks: ${receipt?.gasUsed}`);
  });
});

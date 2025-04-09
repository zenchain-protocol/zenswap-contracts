import { ethers } from "hardhat";
import { ZenVault, MockToken, MockStakingPrecompile } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import {createMultipleUnlockingChunks, setupLargeNumberOfStakers, setupTestEnvironment} from "./utils";

describe("ZenVault Gas Tests", function () {
  // Contracts
  let zenVault: ZenVault;
  let mockStakingPrecompile: MockStakingPrecompile;
  let lpToken: MockToken;

  // Signers
  let owner: SignerWithAddress;
  let users: SignerWithAddress[];
  let rewardAccount: SignerWithAddress;

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
    users = [testEnvironment.user1, testEnvironment.user2];
    rewardAccount = testEnvironment.rewardAccount;

    // Approve rewards
    await lpToken.connect(rewardAccount).approve(await zenVault.getAddress(), INITIAL_SUPPLY);
  });

  describe("Gas Cost Tests", function () {
    it("should test gas costs with a large number of stakers for recordEraStake", async function () {
      // Setup a large number of stakers (adjust based on practical limits)
      const numStakers = 100; // Start with 100 stakers
      await setupLargeNumberOfStakers(numStakers, lpToken, zenVault, INITIAL_SUPPLY, STAKE_AMOUNT);

      // Measure gas used for recordEraStake
      const tx = await zenVault.recordEraStake();
      const receipt = await tx.wait();

      console.log(`Gas used for recordEraStake with ${numStakers} stakers: ${receipt?.gasUsed}`);

      // Practical limit test - try with increasing numbers until it fails or becomes impractical
      // This is commented out as it would be run manually with different values
      // await setupLargeNumberOfStakers(200); // Try with 200 stakers
      // await setupLargeNumberOfStakers(500); // Try with 500 stakers
      // etc.
    });

    it("should test gas costs with a large number of stakers for distributeRewards", async function () {
      // Setup a large number of stakers
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
      // Setup a large number of stakers
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

    it("should test gas costs with a large stakers array during cleanup in recordEraStake", async function () {
      // Setup many stakers
      const numStakers = 100;
      await setupLargeNumberOfStakers(numStakers, lpToken, zenVault, INITIAL_SUPPLY, STAKE_AMOUNT);

      // Unstake all tokens for half of the stakers to create "empty" entries
      for (let i = 0; i < numStakers / 2; i++) {
        await zenVault.connect(users[i]).unstake(STAKE_AMOUNT);
      }

      // Measure gas used for recordEraStake with cleanup
      const tx = await zenVault.recordEraStake();
      const receipt = await tx.wait();

      console.log(`Gas used for recordEraStake cleanup with ${numStakers} stakers (half empty): ${receipt?.gasUsed}`);
    });
  });

});

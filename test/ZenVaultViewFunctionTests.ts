import { expect } from "chai";
import { ethers } from "hardhat";
import { ZenVault, MockToken, MockStakingPrecompile } from "../typechain-types";
import {setupTestEnvironment} from "./utils";

describe("ZenVault View Function Tests", function () {
  // Contracts
  let zenVault: ZenVault;
  let mockStakingPrecompile: MockStakingPrecompile;
  let lpToken: MockToken;

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
  });

  it("getStakerExposuresForEras should return correct data", async function () {
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

    // Record era stake for era 1
    await zenVault.recordEraStake();

    // Advance to era 2 and record again
    await mockStakingPrecompile.advanceEra(1);
    await zenVault.recordEraStake();

    // Verify getStakerExposuresForEras returns correct data for multiple eras
    const exposures = await zenVault.getStakerExposuresForEras(user1.address, [INITIAL_ERA, INITIAL_ERA + 1]);
    expect(exposures.length).to.equal(2);
    expect(exposures[0]).to.equal(stakeAmount1);
    expect(exposures[1]).to.equal(stakeAmount1);
  });

  it("getEraExposures should return correct data", async function () {
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

    // Verify getEraExposures returns correct data
    const eraExposures = await zenVault.getEraExposures(INITIAL_ERA);
    expect(eraExposures.length).to.equal(2);

    // Check that both users are included with correct amounts
    const user1Included = eraExposures.some(exposure => 
      exposure.staker === user1.address && exposure.value == stakeAmount1
    );
    const user2Included = eraExposures.some(exposure => 
      exposure.staker === user2.address && exposure.value == stakeAmount2
    );

    expect(user1Included).to.be.true;
    expect(user2Included).to.be.true;
  });

  it("getUserUnlockingChunks should return correct data", async function () {
    // Setup staker
    const user = (await ethers.getSigners())[2];

    // Mint and approve tokens
    await lpToken.mint(user.address, INITIAL_SUPPLY);
    await lpToken.connect(user).approve(await zenVault.getAddress(), INITIAL_SUPPLY);

    // Stake tokens
    const stakeAmount = ethers.parseEther("100");
    await zenVault.connect(user).stake(stakeAmount);

    // Create multiple unlocking chunks
    const chunk1 = ethers.parseEther("20");
    const chunk2 = ethers.parseEther("30");
    await zenVault.connect(user).unstake(chunk1);
    await zenVault.connect(user).unstake(chunk2);

    // Verify getUserUnlockingChunks returns correct data
    const unlockingChunks = await zenVault.getUserUnlockingChunks(user.address);
    expect(unlockingChunks.length).to.equal(2);
    expect(unlockingChunks[0].value).to.equal(chunk1);
    expect(unlockingChunks[0].era).to.equal(INITIAL_ERA + BONDING_DURATION);
    expect(unlockingChunks[1].value).to.equal(chunk2);
    expect(unlockingChunks[1].era).to.equal(INITIAL_ERA + BONDING_DURATION);
  });
});
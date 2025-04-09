import {ethers} from "hardhat";
import {MockStakingPrecompile, MockToken, ZenVault} from "../typechain-types";
import {SignerWithAddress} from "@nomicfoundation/hardhat-ethers/signers";

export interface TestEnvironment {
  // Contracts
  zenVault: ZenVault;
  mockToken1: MockToken;
  mockToken2: MockToken;
  mockStakingPrecompile: MockStakingPrecompile;
  lpToken: MockToken;
  // Signers
  owner: SignerWithAddress;
  user1: SignerWithAddress;
  user2: SignerWithAddress;
  rewardAccount: SignerWithAddress;
}

export async function setupTestEnvironment(
  nativeStakingAddress: string,
  initialSupply: bigint,
  initialEra: number,
  bondingDuration: number,
): Promise<TestEnvironment> {
  // Reset the blockchain
  await ethers.provider.send("hardhat_reset", []);

  // Get signers
  const [owner, rewardAccount, user1, user2] = await ethers.getSigners();

  // Deploy mock tokens
  const MockTokenFactory = await ethers.getContractFactory("MockToken");
  const mockToken1 = await MockTokenFactory.deploy("Token A", "TKNA", 18);
  const mockToken2 = await MockTokenFactory.deploy("Token B", "TKNB", 18);
  const lpToken = await MockTokenFactory.deploy("LP Token", "LP", 18);

  // Mint initial supply
  await mockToken1.mint(owner.address, initialSupply);
  await mockToken2.mint(owner.address, initialSupply);
  await lpToken.mint(owner.address, initialSupply);
  await lpToken.mint(user1.address, initialSupply);
  await lpToken.mint(user2.address, initialSupply);
  await lpToken.mint(rewardAccount.address, initialSupply);

  // Deploy mock staking precompile
  const MockStakingPrecompileFactory = await ethers.getContractFactory("MockStakingPrecompile");
  const tempMockStakingPrecompile = await MockStakingPrecompileFactory.deploy(initialEra, bondingDuration);
  // Get the bytecode of the deployed mock staking precompile
  const mockStakingPrecompileCode = await ethers.provider.getCode(await tempMockStakingPrecompile.getAddress());
  // Set the code at the nativeStakingAddress to the mock staking precompile bytecode
  await ethers.provider.send("hardhat_setCode", [
    nativeStakingAddress,
    mockStakingPrecompileCode
  ]);
  // Must set era and bonding duration again, because the stored values are not transferred with the bytecode.
  const mockStakingPrecompile = await ethers.getContractAt(
    "MockStakingPrecompile",
    nativeStakingAddress
  );
  await mockStakingPrecompile.advanceEra(initialEra);
  await mockStakingPrecompile.setBondingDuration(bondingDuration);

  // Deploy ZenVault
  const ZenVaultFactory = await ethers.getContractFactory("ZenVault");
  const zenVault = await ZenVaultFactory.deploy(owner.address, await lpToken.getAddress());

  // Set up ZenVault
  await zenVault.connect(owner).setRewardAccount(rewardAccount.address);
  await zenVault.connect(owner).setIsStakingEnabled(true);

  return {
    zenVault,
    mockToken1,
    mockToken2,
    mockStakingPrecompile,
    lpToken,
    owner,
    user1,
    user2,
    rewardAccount,
  }
}

export async function setupLargeNumberOfStakers(
  numStakers: number,
  lpToken: MockToken,
  zenVault: ZenVault,
  initialSupply: bigint,
  stakeAmount: bigint
) {
  // Get additional signers for testing with many stakers
  const allSigners = await ethers.getSigners();
  const users = allSigners.slice(2, 2 + numStakers); // skip owner and rewardAccount

  // Mint tokens and approve for all users
  for (const user of users) {
    await lpToken.mint(user.address, initialSupply);
    await lpToken.connect(user).approve(await zenVault.getAddress(), initialSupply);

    // Stake tokens
    await zenVault.connect(user).stake(stakeAmount);
  }

  console.log(`Setup ${users.length} stakers with ${ethers.formatEther(stakeAmount)} LP tokens each`);
}

export async function createMultipleUnlockingChunks(
  user: SignerWithAddress,
  numChunks: number,
  lpToken: MockToken,
  zenVault: ZenVault,
  stakeAmount: bigint
) {
  const chunkSize = stakeAmount / BigInt(numChunks);

  // Stake a large amount first
  await lpToken.mint(user.address, stakeAmount * 2n);
  await lpToken.connect(user).approve(await zenVault.getAddress(), stakeAmount * 2n);
  await zenVault.connect(user).stake(stakeAmount);

  // Create multiple unlocking chunks
  for (let i = 0; i < numChunks; i++) {
    await zenVault.connect(user).unstake(chunkSize);
  }

  console.log(`Created ${numChunks} unlocking chunks for ${user.address}`);
}
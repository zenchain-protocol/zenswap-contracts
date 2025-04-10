import {ethers} from "hardhat";
import {MockStakingPrecompile, MockToken, ZenVault} from "../typechain-types";
import {SignerWithAddress} from "@nomicfoundation/hardhat-ethers/signers";

export const PRECISION_FACTOR = BigInt(1e18);

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

/**
 * Creates and funds multiple random Ethereum wallets
 *
 * @param numAccounts - The number of random wallets to create
 * @param fundingAmount - The amount of native currency to send to each wallet
 * @returns An array of funded Ethereum wallets connected to the provider
 */
export async function createAndFundAccounts(
  numAccounts: number,
  fundingAmount: bigint
): Promise<ethers.Wallet[]> {
  const fundedAccounts: ethers.Wallet[] = [];
  const owner = (await ethers.getSigners())[0];

  for (let i = 0; i < numAccounts; i++) {
    const wallet = ethers.Wallet.createRandom().connect(ethers.provider);
    await owner.sendTransaction({
      to: wallet.address,
      value: fundingAmount,
    });
    fundedAccounts.push(wallet);
  }

  return fundedAccounts;
}

/**
 * Sets up multiple stakers for testing the ZenVault contract.
 *
 * This function creates the requested number of user accounts, mints LP tokens to each account,
 * approves the ZenVault contract to spend these tokens, and then performs a stake operation
 * for each user.
 *
 * @param numStakers - The number of staker accounts to set up
 * @param lpToken - The MockToken contract instance representing LP tokens
 * @param zenVault - The ZenVault contract instance where tokens will be staked
 * @param initialSupply - The amount of LP tokens to mint to each account
 * @param stakeAmount - The amount of LP tokens each account will stake
 * @returns An array of SignerWithAddress objects representing the staker accounts
 */
export async function setupLargeNumberOfStakers(
  numStakers: number,
  lpToken: MockToken,
  zenVault: ZenVault,
  initialSupply: bigint,
  stakeAmount: bigint
): Promise<SignerWithAddress[]> {
  // Get additional signers for testing with many stakers
  const hardhatSigners = await ethers.getSigners();
  // skip owner and rewardAccount
  let users: (SignerWithAddress | ethers.Wallet)[] = hardhatSigners.slice(2, 2 + numStakers);
  // manually generate remaining signers
  if (numStakers > users.length) {
    const additionalUsers = await createAndFundAccounts(
      numStakers - users.length,
      ethers.parseEther("0.1")
    );
    users = users.concat(additionalUsers);
  }

  // Mint tokens, approve vault, and stake tokens for all users
  const zenVaultAddress = await zenVault.getAddress();
  for (const user of users) {
    await lpToken.mint(user.address, initialSupply);
    await lpToken.connect(user).approve(zenVaultAddress, initialSupply);
    await zenVault.connect(user).stake(stakeAmount);
  }

  return users;
}

/**
 * Creates multiple unlocking chunks for a user in the ZenVault contract
 *
 * This helper function stakes a specified amount of tokens and then divides it into
 * multiple equal-sized unstaking operations. It's useful for testing scenarios that
 * involve multiple unlocking chunks in progress simultaneously.
 *
 * @param user - The user account that will stake and create unlocking chunks
 * @param numChunks - The number of separate unlocking chunks to create
 * @param lpToken - The LP token contract to be staked
 * @param zenVault - The ZenVault contract instance
 * @param stakeAmount - The total amount to stake before creating unlocking chunks
 *
 * @remarks Each unlocking chunk will have a size of stakeAmount/numChunks
 */
export async function createMultipleUnlockingChunks(
  user: SignerWithAddress,
  numChunks: number,
  lpToken: MockToken,
  zenVault: ZenVault,
  stakeAmount: bigint
) {
  const chunkSize = stakeAmount / BigInt(numChunks);

  // Stake a large amount first
  await lpToken.mint(user.address, stakeAmount);
  await lpToken.connect(user).approve(await zenVault.getAddress(), stakeAmount);
  await zenVault.connect(user).stake(stakeAmount);

  // Create multiple unlocking chunks
  for (let i = 0; i < numChunks; i++) {
    await zenVault.connect(user).unstake(chunkSize);
  }
}
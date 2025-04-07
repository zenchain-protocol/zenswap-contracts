import { expect } from "chai";
import { ethers } from "hardhat";

describe("UniswapV2Library", function () {
  it("should return the same pair address as createPair", async function () {
    // Deploy two ERC20 tokens for testing
    const TokenFactory = await ethers.getContractFactory("MockToken");
    const tokenA = await TokenFactory.deploy("Token A", "TKNA", 18);
    const tokenB = await TokenFactory.deploy("Token B", "TKNB", 18);

    // Mint initial supply
    const [signer] = await ethers.getSigners();
    await tokenA.mint(await signer.getAddress(), ethers.parseEther("1000000"));
    await tokenB.mint(await signer.getAddress(), ethers.parseEther("1000000"));

    // Make sure tokenA address is less than tokenB for consistent sorting
    const tokenAAddress = await tokenA.getAddress();
    const tokenBAddress = await tokenB.getAddress();
    const [token0Address, token1Address] = tokenAAddress < tokenBAddress
      ? [tokenAAddress, tokenBAddress]
      : [tokenBAddress, tokenAAddress];

    // Deploy UniswapV2Factory
    const FactoryFactory = await ethers.getContractFactory("UniswapV2Factory");
    const factory = await FactoryFactory.deploy(ethers.ZeroAddress);

    // Create a pair using createPair
    const createPairTx = await factory.createPair(token0Address, token1Address);
    const receipt = await createPairTx.wait();

    // Get the pair address from the event
    const pairCreatedEvent = receipt?.logs.find(log => {
      try {
        return factory.interface.parseLog(log)?.name === "PairCreated";
      } catch (e) {
        return false;
      }
    });

    if (!pairCreatedEvent) {
      throw new Error("PairCreated event not found");
    }
    const parsedEvent = factory.interface.parseLog(pairCreatedEvent);
    const pairAddress = parsedEvent?.args[2]; // pair is the third argument in the event

    // Get the pair address using pairFor
    const LibraryWrapperFactory = await ethers.getContractFactory("UniswapV2LibraryWrapper");
    const libraryWrapper = await LibraryWrapperFactory.deploy();
    const factoryAddress = await factory.getAddress();

    // Try with the original pairFor function
    const calculatedPairAddress = await libraryWrapper.pairFor(factoryAddress, token0Address, token1Address);
    console.log("Calculated pair address with original init code hash:", calculatedPairAddress);

    // Try with the custom pairFor function
    const calculatedPairAddressCustom = await libraryWrapper.pairForWithCustomInitCodeHash(factoryAddress, token0Address, token1Address);
    console.log("Calculated pair address with custom init code hash:", calculatedPairAddressCustom);

    // The test pairFor function should return the correct pair address
    expect(calculatedPairAddress.toLowerCase()).to.equal(pairAddress.toLowerCase());
  });
});

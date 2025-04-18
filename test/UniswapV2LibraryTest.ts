import { expect } from "chai";
import { ethers } from "hardhat";

describe("UniswapV2Library", function () {
  let factoryAddress: string;
  let token0Address: string;
  let token1Address: string;
  let pairAddress: string;
  
  beforeEach(async function () {
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
    [token0Address, token1Address] = tokenAAddress < tokenBAddress
      ? [tokenAAddress, tokenBAddress]
      : [tokenBAddress, tokenAAddress];

    // Deploy UniswapV2Factory
    const FactoryFactory = await ethers.getContractFactory("UniswapV2Factory");
    const factory = await FactoryFactory.deploy(ethers.ZeroAddress);
    factoryAddress = await factory.getAddress();

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
    pairAddress = parsedEvent?.args[2]; // pair is the third argument in the event
  });
  
  it("should return the same pair address as createPair", async function () {
    // Get the pair address using pairFor
    const LibraryWrapperFactory = await ethers.getContractFactory("UniswapV2LibraryWrapper");
    const libraryWrapper = await LibraryWrapperFactory.deploy();

    // Try with the original pairFor function
    const calculatedPairAddress = await libraryWrapper.pairFor(factoryAddress, token0Address, token1Address);
    expect(calculatedPairAddress.toLowerCase()).to.equal(pairAddress.toLowerCase());

    // Try with the custom pairFor function
    const calculatedPairAddressCustom = await libraryWrapper.pairForWithCustomInitCodeHash(factoryAddress, token0Address, token1Address);
    expect(calculatedPairAddressCustom.toLowerCase()).to.equal(pairAddress.toLowerCase());
  });

  it("Pair address should match calculated pair address", async () => {
    // Calculate the salt
    const salt = ethers.keccak256(
      ethers.solidityPacked(
        ["address", "address"],
        [token0Address, token1Address]
      )
    );

    // Calculate the UniswapV2Pair init code hash by hashing the bytecode
    const UniswapV2PairFactory = await ethers.getContractFactory("UniswapV2Pair");
    const bytecode = UniswapV2PairFactory.bytecode;
    const initCodeHash = ethers.keccak256(bytecode);

    // Calculate the expected pair address with our calculated init code hash
    const packedData = ethers.solidityPacked(
      ["bytes1", "address", "bytes32", "bytes32"],
      ["0xff", factoryAddress, salt, initCodeHash]
    );
    const calculatedPairAddress = ethers.getAddress("0x" + ethers.keccak256(packedData).slice(26));

    expect(calculatedPairAddress.toLowerCase()).to.equal(pairAddress.toLowerCase());
  });
});

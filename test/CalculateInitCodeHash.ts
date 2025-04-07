import { ethers } from "hardhat";

async function main() {
  // Get the addresses from the previous test
  const factoryAddress = "0x9fe46736679d2d9a65f0992f2272de9f3c7fa6e0";
  const token0Address = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
  const token1Address = "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512";
  const actualPairAddress = "0x9551931b93b9716f8cE3a51a20cBCcc3517CF09F";

  // Calculate the salt
  const salt = ethers.keccak256(
    ethers.solidityPacked(
      ["address", "address"],
      [token0Address, token1Address]
    )
  );

  // Get UniswapV2Pair contract factory to obtain the bytecode
  const UniswapV2PairFactory = await ethers.getContractFactory("UniswapV2Pair");

  // Get the bytecode of the UniswapV2Pair contract
  const bytecode = UniswapV2PairFactory.bytecode;

  // Calculate the init code hash by hashing the bytecode
  const initCodeHash = ethers.keccak256(bytecode);

  console.log("Calculated init code hash:", initCodeHash);

  // Calculate the expected pair address with our calculated init code hash
  const packedData = ethers.solidityPacked(
    ["bytes1", "address", "bytes32", "bytes32"],
    ["0xff", factoryAddress, salt, initCodeHash]
  );

  const calculatedPairAddress = ethers.getAddress("0x" + ethers.keccak256(packedData).slice(26));

  console.log("Calculated pair address:", calculatedPairAddress);
  console.log("Actual pair address:", actualPairAddress);

  if (calculatedPairAddress.toLowerCase() === actualPairAddress.toLowerCase()) {
    console.log("The calculated init code hash is correct!");
  } else {
    console.log("The calculated init code hash doesn't match the deployment. Let's check if there are any constructor arguments.");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

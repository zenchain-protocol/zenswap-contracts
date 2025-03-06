import { ContractFactory } from "ethers";
import { ethers, network } from "hardhat";

const NATIVE_CURRENCY_ADDRESS = "0x0000000000000000000000000000000000000804"; // Precompile address for ZTC

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying contracts with:", deployer.address);

  // Deploy Uniswap V2 Factory (Solidity 0.5.16)
  const Factory: ContractFactory = await ethers.getContractFactory(
    "UniswapV2Factory"
  );
  const factory = await Factory.deploy(deployer.address);
  await factory.waitForDeployment();
  const uniswapV2FactoryAddress = await factory.getAddress();
  console.log("✅ Uniswap V2 Factory deployed at:", uniswapV2FactoryAddress);

  let usdcAddress: string, usdtAddress: string, ztcAddress: string;

  if (network.name === "hardhat" || network.name === "localhost") {
    console.log("Deploying mock tokens...");

    const MockERC20Factory: ContractFactory = await ethers.getContractFactory(
      "MockERC20"
    );

    const usdc = await MockERC20Factory.deploy("USD Coin", "USDC", 6);
    await usdc.waitForDeployment();
    usdcAddress = await usdc.getAddress();
    console.log("✅ USDC deployed at:", usdcAddress);

    const usdt = await MockERC20Factory.deploy("Tether USD", "USDT", 6);
    await usdt.waitForDeployment();
    usdtAddress = await usdt.getAddress();
    console.log("✅ Mock USDT deployed at:", usdtAddress);

    const ztc = await MockERC20Factory.deploy("Tether USD", "USDT", 6);
    await ztc.waitForDeployment();
    ztcAddress = await ztc.getAddress();
    console.log("✅ Mock USDT deployed at:", ztcAddress);
  } else {
    console.log("Skipping mock token deployment for non-local network.");
    // TODO: Replace with real token addresses
    usdcAddress = "REAL_USDC_ADDRESS";
    usdtAddress = "REAL_USDT_ADDRESS";
    ztcAddress = NATIVE_CURRENCY_ADDRESS;
  }

  // Deploy Uniswap V2 Router (Solidity 0.6.6)
  const Router: ContractFactory = await ethers.getContractFactory(
    "UniswapV2Router02"
  );
  const router = await Router.deploy(uniswapV2FactoryAddress, ztcAddress);
  await router.waitForDeployment();
  const uniswapV2RouterAddress = await router.getAddress();
  console.log("✅ Uniswap V2 Router deployed at:", uniswapV2RouterAddress);
  const routerCode = await ethers.provider.getCode(uniswapV2RouterAddress);
  console.log("Router contract code:", `${routerCode.slice(0, 10)}...`);

  if (network.name === "hardhat" || network.name === "localhost") {
    // ✅ Add Liquidity
    console.log("\n🔹 Adding liquidity to Uniswap pools...");

    // Get router contract instance
    const routerInstance = await ethers.getContractAt(
      "UniswapV2Router02",
      uniswapV2RouterAddress
    );
    const factoryInstance = await ethers.getContractAt(
      "UniswapV2Factory",
      uniswapV2FactoryAddress
    );

    const pairBefore = await factoryInstance.getPair(ztcAddress, usdcAddress);

    await factoryInstance.createPair(ztcAddress, usdcAddress);
    console.log("✅ Manually created Uniswap Pair for ZTC-USDC");
    const ztcUsdcPair = await factoryInstance.getPair(ztcAddress, usdcAddress);
    console.log("Pair Creation - ZTC-USDC:", ztcUsdcPair);

    await factoryInstance.createPair(ztcAddress, usdtAddress);
    console.log("✅ Manually created Uniswap Pair for ZTC-USDC");
    const ztcUsdtPair = await factoryInstance.getPair(ztcAddress, usdtAddress);
    console.log("Pair Creation - ZTC-USDC:", ztcUsdtPair);

    // Approve tokens for liquidity
    const usdcInstance = await ethers.getContractAt("MockERC20", usdcAddress);
    const usdtInstance = await ethers.getContractAt("MockERC20", usdtAddress);
    const ztcInstance = await ethers.getContractAt("MockERC20", ztcAddress);

    await usdcInstance.approve(
      uniswapV2RouterAddress,
      ethers.parseEther("1000")
    );
    await usdtInstance.approve(
      uniswapV2RouterAddress,
      ethers.parseEther("1000")
    );
    await ztcInstance.approve(
      uniswapV2RouterAddress,
      ethers.parseEther("1000")
    );

    const allowanceUSDC = await usdcInstance.allowance(
      deployer.address,
      uniswapV2RouterAddress
    );
    console.log("USDC Allowance:", allowanceUSDC.toString());

    const allowanceUSDT = await usdtInstance.allowance(
      deployer.address,
      uniswapV2RouterAddress
    );
    console.log("USDT Allowance:", allowanceUSDT.toString());

    const allowanceZTC = await ztcInstance.allowance(
      deployer.address,
      uniswapV2RouterAddress
    );
    console.log("ZTC Allowance:", allowanceZTC.toString());

    const factoryFromRouter = await routerInstance.factory();
    console.log("Factory address from Router:", factoryFromRouter);

    const wethFromRouter = await routerInstance.WETH();
    console.log("WETH (ZTC) address from Router:", wethFromRouter);

    // Add liquidity for ZTC-USDC
    await routerInstance.addLiquidity(
      ztcAddress,
      usdcAddress,
      ethers.parseEther("1000"),
      ethers.parseEther("1000"),
      0,
      0,
      deployer.address,
      Math.floor(Date.now() / 1000) + 60 * 10
    );
    console.log("✅ Liquidity added to ZTC-USDC pair!");

    // Add liquidity for ZTC-USDT
    await routerInstance.addLiquidity(
      ztcAddress,
      usdtAddress,
      ethers.parseEther("1000"),
      ethers.parseEther("1000"),
      0,
      0,
      deployer.address,
      Math.floor(Date.now() / 1000) + 60 * 10
    );
    console.log("✅ Liquidity added to ZTC-USDT pair!");
  }

  console.log("\n🚀 Deployment Completed!");
}

main().catch((error) => {
  console.error("❌ Error deploying:", error);
  if (error?.reason) {
    console.error("🔴 Solidity Revert Reason:", error.reason);
  }
  if (error?.error?.message) {
    console.error("🔴 Ethers.js Error Message:", error.error.message);
  }
  process.exit(1);
});

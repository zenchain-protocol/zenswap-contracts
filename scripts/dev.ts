import { ethers } from "hardhat";
import WETH9 from "../WETH9.json";
import factoryArtifact from "@uniswap/v2-core/build/UniswapV2Factory.json";
import routerArtifact from "@uniswap/v2-periphery/build/UniswapV2Router02.json";
import pairArtifact from "@uniswap/v2-periphery/build/IUniswapV2Pair.json";
import { Contract, ContractFactory } from "ethers";

async function main() {
  const [owner] = await ethers.getSigners();
  console.log(`Deploying contracts with the account: ${owner.address}`);

  const Factory = new ContractFactory(
    factoryArtifact.abi,
    factoryArtifact.bytecode,
    owner
  );

  const factory = await (await Factory.deploy(owner.address)).waitForDeployment();
  const factoryAddress = await factory.getAddress();
  console.log(`Factory deployed to ${factoryAddress}`);

  const USDT = await ethers.getContractFactory("Tether", owner);
  const usdt = await (await USDT.deploy()).waitForDeployment();
  const usdtAddress = await usdt.getAddress();
  console.log(`USDT deployed to ${usdtAddress}`);

  const USDC = await ethers.getContractFactory("UsdCoin", owner);
  const usdc = await (await USDC.deploy()).waitForDeployment();
  const usdcAddress = await usdc.getAddress();
  console.log(`USDC deployed to ${usdcAddress}`);

  await usdt.connect(owner).mint(owner.address, ethers.parseEther("1000"));
  await usdc.connect(owner).mint(owner.address, ethers.parseEther("1000"));

  const factoryInstance = await ethers.getContractAt(
    "UniswapV2Factory",
    factoryAddress
  );
  const tx1 = await factoryInstance.createPair(usdtAddress, usdcAddress);
  await tx1.wait();
  const pairAddress = await factoryInstance.getPair(usdtAddress, usdcAddress);
  console.log(`Pair deployed to ${pairAddress}`);

  const pair = new Contract(pairAddress, pairArtifact.abi, owner);
  let reserves = await pair.getReserves();
  console.log(`Reserves: ${reserves[0].toString()}, ${reserves[1].toString()}`);

  const WETH = new ContractFactory(WETH9.abi, WETH9.bytecode, owner);
  const weth = await WETH.deploy();
  const wethAddress = await weth.getAddress();
  console.log(`WETH deployed to ${wethAddress}`);

  const Router = new ContractFactory(
    routerArtifact.abi,
    routerArtifact.bytecode,
    owner
  );
  const router = await (await Router.deploy(factoryAddress, wethAddress)).waitForDeployment();
  const routerAddress = await router.getAddress();
  console.log(`Router deployed to ${routerAddress}`);

  const MaxUint256 =
    "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";

  await usdt.approve(routerAddress, MaxUint256);
  await usdc.approve(routerAddress, MaxUint256);

  const token0Amount = ethers.parseUnits("100");
  const token1Amount = ethers.parseUnits("100");

  const lpTokenBalanceBefore = await pair.balanceOf(owner.address);
  console.log(`LP tokens for the owner before: ${lpTokenBalanceBefore.toString()}`);

  const deadline = Math.floor(Date.now() / 1000) + 10 * 60;
  const routerInstance = await ethers.getContractAt(
    "UniswapV2Router02",
    routerAddress
  );
  await routerInstance.addLiquidity(
    usdtAddress,
    usdcAddress,
    token0Amount,
    token1Amount,
    0,
    0,
    owner.address,
    deadline
  );

  const lpTokenBalance = await pair.balanceOf(owner.address);
  console.log(`LP tokens for the owner: ${lpTokenBalance.toString()}`);

  reserves = await pair.getReserves();
  console.log(`Reserves: ${reserves[0].toString()}, ${reserves[1].toString()}`);

  console.log("USDT_ADDRESS", usdtAddress);
  console.log("USDC_ADDRESS", usdcAddress);
  console.log("WETH_ADDRESS", wethAddress);
  console.log("FACTORY_ADDRESS", factoryAddress);
  console.log("ROUTER_ADDRESS", routerAddress);
  console.log("PAIR_ADDRESS", pairAddress);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

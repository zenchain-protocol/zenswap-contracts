import fs from "fs";
import path from "path";
import hre, { network } from "hardhat";
import { formatUnits, parseUnits } from "viem";
import factoryArtifact from "@uniswap/v2-core/build/UniswapV2Factory.json";
import routerArtifact from "@uniswap/v2-periphery/build/UniswapV2Router02.json";
import WETH9 from "../WETH9.json";

type DeployedContracts = {
  factory: string;
  weth: string;
  router: string;
  ETH?: string; // Optional for mainnet
  USDC?: string; // Optional for mainnet
  ETHUSDCPair?: string; // Only applicable if liquidity is added
};

const PACKAGE_JSON_PATH = path.join(__dirname, "../package.json");

async function updatePackageJson(
  networkName: string,
  deployments: DeployedContracts
) {
  const packageJson = JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, "utf8"));

  if (!packageJson.deployments) {
    packageJson.deployments = {};
  }

  packageJson.deployments[networkName] = deployments;

  fs.writeFileSync(PACKAGE_JSON_PATH, JSON.stringify(packageJson, null, 2));
  console.log(`Updated package.json for network: ${networkName}`);
}

async function main() {
  const [walletClient] = await hre.viem.getWalletClients();
  const publicClient = await hre.viem.getPublicClient();
  const owner = walletClient.account.address;
  const networkName = network.name;
  console.log(`Deploying to network: ${networkName} with account: ${owner}`);

  let deployedContracts: DeployedContracts = {
    factory: "",
    weth: "",
    router: "",
  };

  console.log("Deploying UniswapV2Factory...");
  const factoryHash = await walletClient.deployContract({
    abi: factoryArtifact.abi,
    bytecode: factoryArtifact.bytecode as `0x${string}`,
    args: [owner],
  });
  const factoryAddress = await publicClient
    .waitForTransactionReceipt({ hash: factoryHash })
    .then((r) => r.contractAddress!);
  console.log(`Factory deployed to ${factoryAddress}`);
  deployedContracts.factory = factoryAddress;

  const ETHdecimals = 18;
  const ETH = await hre.viem.deployContract("MockToken", [
    "Ether",
    "ETH",
    ETHdecimals,
  ]);
  console.log(`ETH deployed to ${ETH.address}`);
  deployedContracts.ETH = ETH.address;

  const USDCdecimals = 6;
  const USDC = await hre.viem.deployContract("MockToken", [
    "USD Coin",
    "USDC",
    USDCdecimals,
  ]);
  console.log(`USDC deployed to ${USDC.address}`);
  deployedContracts.USDC = USDC.address;

  console.log("Deploying WETH...");
  const wethHash = await walletClient.deployContract({
    abi: WETH9.abi,
    bytecode: WETH9.bytecode as `0x${string}`,
  });
  const wethAddress = await publicClient
    .waitForTransactionReceipt({ hash: wethHash })
    .then((r) => r.contractAddress!);
  console.log(`WETH deployed at: ${wethAddress}`);
  deployedContracts.weth = wethAddress;

  console.log("Deploying UniswapV2Router02...");
  const routerHash = await walletClient.deployContract({
    abi: routerArtifact.abi,
    bytecode: routerArtifact.bytecode as `0x${string}`,
    args: [factoryAddress, wethAddress],
  });
  const routerAddress = await publicClient
    .waitForTransactionReceipt({ hash: routerHash })
    .then((r) => r.contractAddress!);
  console.log(`Router deployed at: ${routerAddress}`);
  deployedContracts.router = routerAddress;

  console.log("Minting 1000 ETH and 1000 USDC...");
  await walletClient.writeContract({
    address: ETH.address,
    abi: ETH.abi,
    functionName: "mint",
    args: [owner, parseUnits("1000", ETHdecimals)],
  });
  await walletClient.writeContract({
    address: USDC.address,
    abi: USDC.abi,
    functionName: "mint",
    args: [owner, parseUnits("1000", USDCdecimals)],
  });
  console.log("Minting successful!");

  console.log("Creating ETH-USDC Pair...");
  const createPairHash = await walletClient.writeContract({
    address: factoryAddress,
    abi: factoryArtifact.abi,
    functionName: "createPair",
    args: [ETH.address, USDC.address],
  });
  await publicClient.waitForTransactionReceipt({ hash: createPairHash });
  const pairAddress = await publicClient.readContract({
    address: factoryAddress,
    abi: factoryArtifact.abi,
    functionName: "getPair",
    args: [ETH.address, USDC.address],
  });
  console.log(`ETH-USDC pair deployed at: ${pairAddress}`);
  deployedContracts.ETHUSDCPair = pairAddress as string;

  console.log("Approving Router for token transfers...");
  const approveETHHash = await walletClient.writeContract({
    address: ETH.address,
    abi: ETH.abi,
    functionName: "approve",
    args: [routerAddress, parseUnits("1000", ETHdecimals)],
  });
  await publicClient.waitForTransactionReceipt({ hash: approveETHHash });
  const allowanceETH = await publicClient.readContract({
    address: ETH.address,
    abi: ETH.abi,
    functionName: "allowance",
    args: [owner, routerAddress],
  });
  console.log(
    "ETH Allowance -> Router:",
    formatUnits(allowanceETH, ETHdecimals)
  );
  const approveUSDCHash = await walletClient.writeContract({
    address: USDC.address,
    abi: USDC.abi,
    functionName: "approve",
    args: [routerAddress, parseUnits("1000", USDCdecimals)],
  });
  await publicClient.waitForTransactionReceipt({ hash: approveUSDCHash });
  const allowanceUSDC = await publicClient.readContract({
    address: USDC.address,
    abi: USDC.abi,
    functionName: "allowance",
    args: [owner, routerAddress],
  });
  console.log(
    "USDC Allowance -> Router:",
    formatUnits(allowanceUSDC, USDCdecimals)
  );
  console.log("Approvals completed.");

  const balanceETH = await publicClient.readContract({
    address: ETH.address,
    abi: ETH.abi,
    functionName: "balanceOf",
    args: [owner],
  });
  const balanceUSDC = await publicClient.readContract({
    address: USDC.address,
    abi: USDC.abi,
    functionName: "balanceOf",
    args: [owner],
  });
  console.log("ETH Balance:", formatUnits(balanceETH, ETHdecimals));
  console.log("USDC Balance:", formatUnits(balanceUSDC, USDCdecimals));

  console.log("Adding liquidity...");
  const deadline = Math.floor(Date.now() / 1000) + 10 * 60;
  const addLiquidityHash = await walletClient.writeContract({
    address: routerAddress,
    abi: routerArtifact.abi,
    functionName: "addLiquidity",
    args: [
      ETH.address,
      USDC.address,
      parseUnits("100", 6),
      parseUnits("100", 6),
      0,
      0,
      owner,
      deadline,
    ],
  });
  await publicClient.waitForTransactionReceipt({ hash: addLiquidityHash });
  console.log("Liquidity added successfully.");

  if (networkName !== "localhost") {
    await updatePackageJson(networkName, deployedContracts);
  } else {
    console.log("Skipping package.json update for localhost.");
  }

  console.log("Deployment completed successfully!");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

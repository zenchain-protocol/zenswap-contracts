import hre, { network } from "hardhat";
import { readDeploymentRecord, addLiquidityToPair } from "./utils";
import { Address, parseUnits } from "viem";

async function main() {
  const [walletClient] = await hre.viem.getWalletClients();
  const publicClient = await hre.viem.getPublicClient();
  const owner = walletClient.account.address;
  const networkName = network.name;

  console.log(`Adding liquidity on network: ${networkName} with account: ${owner}`);
  const deployedContracts = await readDeploymentRecord(networkName);
  if (!deployedContracts.factory || !deployedContracts.router) {
    throw new Error("Deployed contracts not found in deployment record");
  }

  console.log("Deployed Contracts:", deployedContracts);

  // 1 ETH = 2750 USDC
  console.log("Adding liquidity for ETH/USDC pair...");
  await addLiquidityToPair({
    walletClient,
    publicClient,
    routerAddress: deployedContracts.router as Address,
    tokenA: deployedContracts.tokens.ETH as Address,
    tokenB: deployedContracts.tokens.USDC as Address,
    amountADesired: parseUnits("1", 18 + 3).toString(),
    amountBDesired: parseUnits("2750", 18 + 3).toString(),
    mintTokensA: true, // Mint ETH if it's a mock token
    mintTokensB: true, // Mint USDC if it's a mock token
  });

  // 1 ETH = 2750 USDT
  console.log("Adding liquidity for ETH/USDT pair...");
  await addLiquidityToPair({
    walletClient,
    publicClient,
    routerAddress: deployedContracts.router as Address,
    tokenA: deployedContracts.tokens.ETH as Address,
    tokenB: deployedContracts.tokens.USDT as Address,
    amountADesired: parseUnits("1", 18 + 6).toString(),
    amountBDesired: parseUnits("2750", 18 + 6).toString(),
    mintTokensA: true, // Mint ETH if it's a mock token
    mintTokensB: true, // Mint USDT if it's a mock token
  });

  // 1 ETH = 6.875 ZTC
  console.log("Adding liquidity for ZTC/ETH pair...");
  await addLiquidityToPair({
    walletClient,
    publicClient,
    routerAddress: deployedContracts.router as Address,
    tokenA: deployedContracts.tokens.ZTC as Address,
    tokenB: deployedContracts.tokens.ETH as Address,
    amountADesired: parseUnits("6.875", 18 + 1).toString(),
    amountBDesired: parseUnits("1", 18 + 1).toString(),
    mintTokensA: false,
    mintTokensB: true, // Mint ETH if it's a mock token
  });

  // 1 ZTC = 400 USDC
  console.log("Adding liquidity for ZTC/USDC pair...");
  await addLiquidityToPair({
    walletClient,
    publicClient,
    routerAddress: deployedContracts.router as Address,
    tokenA: deployedContracts.tokens.ZTC as Address,
    tokenB: deployedContracts.tokens.ETH as Address,
    amountADesired: parseUnits("1", 18 + 1).toString(),
    amountBDesired: parseUnits("400", 18 + 1).toString(),
    mintTokensA: false,
    mintTokensB: true,
  });

  // 1 ZTC = 400 USDT
  console.log("Adding liquidity for ZTC/USDT pair...");
  await addLiquidityToPair({
    walletClient,
    publicClient,
    routerAddress: deployedContracts.router as Address,
    tokenA: deployedContracts.tokens.ZTC as Address,
    tokenB: deployedContracts.tokens.USDT as Address,
    amountADesired: parseUnits("1", 18 + 2).toString(),
    amountBDesired: parseUnits("400", 18 + 2).toString(),
    mintTokensA: false,
    mintTokensB: true, // Mint USDT if it's a mock token
  });

  //1 USDC = 1 USDT
  console.log("Adding liquidity for USDC/USDT pair...");
  await addLiquidityToPair({
    walletClient,
    publicClient,
    routerAddress: deployedContracts.router as Address,
    tokenA: deployedContracts.tokens.USDC as Address,
    tokenB: deployedContracts.tokens.USDT as Address,
    amountADesired: parseUnits("1", 18 + 5).toString(),
    amountBDesired: parseUnits("1", 18 + 5).toString(),
    mintTokensA: true, // Mint USDC if it's a mock token
    mintTokensB: true, // Mint USDT if it's a mock token
  });

}


main().catch(console.error);
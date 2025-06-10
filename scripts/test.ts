import hre, { network } from "hardhat";
import { addLiquidityToPair, DeployedContracts } from "./utils";
import { deployAll } from "./utils/deploy";
import { Address, parseUnits } from "viem";

async function main() {
  const helpers = require("@nomicfoundation/hardhat-toolbox/network-helpers");
  const address = "0x46a148316eba94539642f3fd6908dcab10994d1a";
  await helpers.impersonateAccount(address);

  //const testClient = await hre.viem.getTestClient();
  const walletClient = await hre.viem.getWalletClient(address);
  const publicClient = await hre.viem.getPublicClient();
  const owner = walletClient.account.address;
  const networkName = network.name;

  console.log(`Deploying to network: ${networkName} with account: ${owner}`);
  const deploymentRecord: DeployedContracts = {
    tokens: {
      ZTC: "0x0000000000000000000000000000000000000804"
    },
    pairs: {}
  }

  await deployAll({
    walletClient,
    publicClient,
    deploymentRecord
  });

  console.log("Adding liquidity for ZTC/USDC pair...");
  await addLiquidityToPair({
    walletClient,
    publicClient,
    routerAddress: deploymentRecord.router as Address,
    tokenA: deploymentRecord.tokens.ZTC as Address,
    tokenB: deploymentRecord.tokens.ETH as Address,
    amountADesired: parseUnits("1", 16).toString(),
    amountBDesired: parseUnits("400", 16).toString(),
    mintTokensA: false,
    mintTokensB: true, // Mint ETH if it's a mock token
  });


}

main().catch(console.error);

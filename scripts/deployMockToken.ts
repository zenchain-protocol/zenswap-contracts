
import hre, { network } from "hardhat";
import { deployMockToken, mintMockToken, readDeploymentRecord, updateDeploymentRecord } from "./utils";
import { deployAll } from "./utils/deploy";
import { parseUnits } from "viem";

async function main() {
  const [walletClient] = await hre.viem.getWalletClients();
  const publicClient = await hre.viem.getPublicClient();
  const owner = walletClient.account.address;
  const networkName = network.name;
  console.log(`Deploying to network: ${networkName} with account: ${owner}`);

  const tokenAddress = await deployMockToken({
    walletClient,
    publicClient,
    name: "Zach Token 2",
    symbol: "ZACH2",
    decimals: 18,
  });

  await mintMockToken({
    walletClient,
    publicClient,
    tokenAddress: tokenAddress,
    amount: parseUnits("1000", 18).toString(),
    decimals: 18,
    forAddress: owner, // Mint to the owner's address
  });



  console.log(tokenAddress);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

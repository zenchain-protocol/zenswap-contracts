
import hre, { network } from "hardhat";
import { readDeploymentRecord, updateDeploymentRecord } from "./utils";
import { deployAll } from "./utils/deploy";

async function main() {
  const [walletClient] = await hre.viem.getWalletClients();
  const publicClient = await hre.viem.getPublicClient();
  const owner = walletClient.account.address;
  const networkName = network.name;
  console.log(`Deploying to network: ${networkName} with account: ${owner}`);

  const deploymentRecord = await readDeploymentRecord(networkName);

  console.log("Deployed Contracts:", deploymentRecord);
  try {
    await deployAll({
      walletClient,
      publicClient,
      deploymentRecord
    })
  } catch (error) {
    console.error("Deployment failed:", error);
    throw error;
  } finally {
    if (networkName !== "localhost") {
      console.log("Updating package.json with deployment records...");
      await updateDeploymentRecord(networkName, deploymentRecord);
    } else {
      console.log("Skipping package.json update for localhost.");
    }
  }

  console.log("Deployment completed successfully!");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

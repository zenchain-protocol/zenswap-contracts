import hre, { network } from "hardhat";
import { Address, parseUnits } from "viem";
import { readDeploymentRecord, getTokenDecimals, mintMockToken } from "./utils";

async function main() {
  const [walletClient] = await hre.viem.getWalletClients();
  const publicClient = await hre.viem.getPublicClient();
  const owner = walletClient.account.address;
  const networkName = network.name;

  const toEnv = process.env.MINT_TO;
  const amountEnv = process.env.MINT_AMOUNT;

  if (!toEnv || !amountEnv) {
    console.error("Missing environment variables MINT_TO and/or MINT_AMOUNT.");
    console.error("Set them inline in the npm script or your environment, e.g. MINT_TO=0x... MINT_AMOUNT=1000");
    process.exit(1);
  }

  const to = toEnv as Address;
  const amountHuman = amountEnv; // human-readable amount to mint for each token (e.g., "1000")

  console.log(`Minting ${amountHuman} of each selected token to: ${to}`);
  console.log(`Using network: ${networkName}, sender: ${owner}`);

  const deployments = await readDeploymentRecord(networkName);

  const tokenEntries = Object.entries(deployments.tokens) as [keyof typeof deployments.tokens, string][];
  // Skip ZTC (non-mintable by current account)
  const mintableTokens = tokenEntries.filter(([sym]) => String(sym).toUpperCase() !== "ZTC");

  console.log(`Tokens to mint: ${mintableTokens.map(([sym]) => sym).join(", ")}`);

  for (const [sym, tokenAddress] of mintableTokens) {
    const tokenAddr = tokenAddress as Address | undefined;
    if (!tokenAddr) {
      console.warn(`Skipping ${sym}: Address not found in deployments for ${networkName}.`);
      continue;
    }

    try {
      const decimals = await getTokenDecimals({ publicClient, tokenAddress: tokenAddr });
      const amountWei = parseUnits(amountHuman, decimals).toString();

      console.log(`\nMinting ${amountHuman} ${String(sym)} (decimals: ${decimals}) to ${to} @ ${tokenAddr}`);
      await mintMockToken({
        walletClient,
        publicClient,
        tokenAddress: tokenAddr,
        amount: amountWei,
        decimals,
        forAddress: to,
      });
      console.log(`Minted ${amountHuman} ${String(sym)} to ${to}`);
    } catch (err) {
      console.error(`Failed to mint ${String(sym)} at ${tokenAddr}:`, err);
      // Continue with next token
    }
  }

  console.log("\nMint process completed.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

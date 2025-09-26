import hre, { network } from "hardhat";
import { readDeploymentRecord, addLiquidityToPair, tokenList, getTokenDecimals, getTokenBalance } from "./utils";
import { Address, formatUnits } from "viem";

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

  // Define USD price map for consistent ratios
  const priceUSD: Record<string, number> = {
    ETH: 2750,
    USDC: 1,
    USDT: 1,
    ZTC: 400,
    BTC: 55000,
  };

  // Utility to safely extract token symbols from pair key like "ETHUSDC"
  const getPairSymbols = (pairKey: string): [keyof typeof deployedContracts.tokens, keyof typeof deployedContracts.tokens] | null => {
    for (const a of tokenList) {
      if (pairKey.startsWith(a)) {
        const b = pairKey.slice(a.length) as keyof typeof deployedContracts.tokens;
        if ((tokenList as readonly string[]).includes(b)) {
          return [a as keyof typeof deployedContracts.tokens, b];
        }
      }
    }
    return null;
  };

  // Iterate all configured pairs for the network and add liquidity
  for (const [pairKey] of Object.entries(deployedContracts.pairs)) {
    const syms = getPairSymbols(pairKey);
    if (!syms) {
      console.warn(`Skipping unknown pair key ${pairKey}`);
      continue;
    }
    const [symA, symB] = syms;
    const tokenA = deployedContracts.tokens[symA] as Address;
    const tokenB = deployedContracts.tokens[symB] as Address;
    if (!tokenA || !tokenB) {
      console.warn(`Token addresses missing for pair ${pairKey}: ${symA}=${tokenA}, ${symB}=${tokenB}`);
      continue;
    }

    // Choose amounts that reflect equal USD value on both sides.
    // We target $1000 per side for reasonable sizes, but clamp to available balances for non-mintable tokens (e.g., ZTC).
    const usdTargetPerSide = 1000;
    const priceA = priceUSD[String(symA)] ?? 1;
    const priceB = priceUSD[String(symB)] ?? 1;

    const ztcAddress = deployedContracts.tokens.ZTC as Address;
    const mintA = tokenA.toLowerCase() !== ztcAddress.toLowerCase();
    const mintB = tokenB.toLowerCase() !== ztcAddress.toLowerCase();

    const [decA, decB] = await Promise.all([
      getTokenDecimals({ publicClient, tokenAddress: tokenA }),
      getTokenDecimals({ publicClient, tokenAddress: tokenB }),
    ]);
    const [balAWei, balBWei] = await Promise.all([
      getTokenBalance({ publicClient, tokenAddress: tokenA, owner: owner as Address }),
      getTokenBalance({ publicClient, tokenAddress: tokenB, owner: owner as Address }),
    ]);
    const balAHuman = parseFloat(formatUnits(balAWei, decA));
    const balBHuman = parseFloat(formatUnits(balBWei, decB));

    const availUsdA = mintA ? Number.POSITIVE_INFINITY : balAHuman * priceA;
    const availUsdB = mintB ? Number.POSITIVE_INFINITY : balBHuman * priceB;
    const usdPerSideActual = Math.min(usdTargetPerSide, availUsdA, availUsdB);

    if (usdPerSideActual <= 0) {
      console.warn(`Skipping ${pairKey}: insufficient non-mintable token balance (mintA=${mintA}, mintB=${mintB}).`);
      continue;
    }

    const amountA = (usdPerSideActual / priceA).toString();
    const amountB = (usdPerSideActual / priceB).toString();

    console.log(`\nAdding liquidity for ${pairKey} -> ${symA}/${symB}`);
    console.log(`Target USD per side: $${usdTargetPerSide}, using $${usdPerSideActual}. Computed amounts: ${symA}=${amountA}, ${symB}=${amountB}`);
    console.log(`Mint flags: ${symA}=${mintA}, ${symB}=${mintB}. Balances: ${symA}=${balAHuman}, ${symB}=${balBHuman}`);

    try {
      await addLiquidityToPair({
        walletClient,
        publicClient,
        routerAddress: deployedContracts.router as Address,
        tokenA,
        tokenB,
        amountA,
        amountB,
        mintTokensA: mintA,
        mintTokensB: mintB,
      });
    } catch (e) {
      console.error(`Failed to add liquidity for ${pairKey}`, e);
    }
  }

}


main().catch(console.error);
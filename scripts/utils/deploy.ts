
import { Address } from "viem";
import factoryArtifact from "@uniswap/v2-core/build/UniswapV2Factory.json";
import routerArtifact from "@uniswap/v2-periphery/build/UniswapV2Router02.json";
import { CommonParams, createPair, DeployedContracts, deployMockToken, getTokenPairs, tokenList, TokenPairNames } from ".";

export interface DeployCommonParams extends CommonParams {
  deploymentRecord: DeployedContracts;
}

export const deployFactory = async ({ walletClient, publicClient, deploymentRecord }: DeployCommonParams) => {
  if (!deploymentRecord.factory) {
    const owner = walletClient.account.address;
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
    deploymentRecord.factory = factoryAddress;
  } else {
    console.log(`UniswapV2Factory already deployed at: ${deploymentRecord.factory}`);
  }
}

export const deployMockTokens = async ({ walletClient, publicClient, deploymentRecord }: DeployCommonParams) => {
  const tokens = tokenList.filter((e) => e != "ZTC");
  if (tokens.length === 0) {
    console.log("No tokens to deploy");
  } else {
    for (const token of tokens) {
      if (!deploymentRecord.tokens[token]) {
        console.log(`Deploying Mock ${token}...`);
        const mockTokenAddress = await deployMockToken({
          walletClient,
          publicClient,
          name: token,
          symbol: token,
          decimals: 18, // Assuming all tokens have 18 decimals
        });
        console.log(`Mock ${token} deployed to ${mockTokenAddress}`);
        deploymentRecord.tokens[token] = mockTokenAddress;
      } else {
        console.log(`Mock ${token} already deployed at: ${deploymentRecord.tokens[token]}`);
      }
    }
  }
}

export const deployRouter = async ({ walletClient, publicClient, deploymentRecord }: DeployCommonParams) => {
  if (!deploymentRecord.router) {
    console.log("Deploying UniswapV2Router02...");
    const routerHash = await walletClient.deployContract({
      abi: routerArtifact.abi,
      bytecode: routerArtifact.bytecode as `0x${string}`,
      args: [deploymentRecord.factory, deploymentRecord.tokens.ZTC],
    });
    const routerAddress = await publicClient
      .waitForTransactionReceipt({ hash: routerHash })
      .then((r) => r.contractAddress!);
    console.log(`Router deployed at: ${routerAddress}`);
    deploymentRecord.router = routerAddress;
  } else {
    console.log(`UniswapV2Router02 already deployed at: ${deploymentRecord.router}`);

    const routerZTC = await publicClient.readContract({
      address: deploymentRecord.router as Address,
      abi: routerArtifact.abi,
      functionName: "WETH",
    });
    if (routerZTC !== deploymentRecord.tokens.ZTC) {
      console.error(`Router's WETH address (${routerZTC}) does not match deployed ZTC address (${deploymentRecord.tokens.ZTC}).`);
      throw new Error("Router's WETH address needs to match ZTC address.");
    }
  }
}

export const deployTokenPairs = async ({ walletClient, publicClient, deploymentRecord }: DeployCommonParams) => {
  type TokenPairToDeploy = {
    tokenA: Address;
    tokenB: Address;
    pairName: TokenPairNames;
  }

  const pairsToDeploy: TokenPairToDeploy[] = [];
  const pairs = getTokenPairs(tokenList);
  for (const pair of pairs) {
    const pairName = `${pair.tokenA}${pair.tokenB}` as TokenPairNames;
    if (!deploymentRecord.pairs[pairName]) {
      pairsToDeploy.push({
        tokenA: deploymentRecord.tokens[pair.tokenA] as Address,
        tokenB: deploymentRecord.tokens[pair.tokenB] as Address,
        pairName,
      });
    }
  }
  if (pairsToDeploy.length === 0) {
    console.log("All token pairs already deployed.");
  } else {
    console.log("Pairs to deploy:", pairsToDeploy.map(p => p.pairName));

    for (const { tokenA, tokenB, pairName } of pairsToDeploy) {
      if (!deploymentRecord.pairs[pairName]) {
        console.log(`Creating ${pairName}...`);
        const pairAddress = await createPair({
          walletClient,
          publicClient,
          factoryAddress: deploymentRecord.factory as Address,
          tokenA: tokenA as Address,
          tokenB: tokenB as Address,
        });
        deploymentRecord.pairs[pairName] = pairAddress as string;
        console.log(`${pairName} deployed at: ${pairAddress}`);
      } else {
        console.log(`${pairName} already deployed at: ${deploymentRecord.pairs[pairName]}`);
      }
    }
  }
}

export const deployAll = async ({ walletClient, publicClient, deploymentRecord }: DeployCommonParams) => {
  console.log("Step 1: Factory Deployment");
  await deployFactory({
    walletClient,
    publicClient,
    deploymentRecord,
  })

  console.log("Step 2: Mock Token Deployment");
  await deployMockTokens({
    walletClient,
    publicClient,
    deploymentRecord,
  });

  console.log("Step 3: Router Deployment");
  await deployRouter({
    walletClient,
    publicClient,
    deploymentRecord,
  });

  console.log("Step 4: Token Pair Deployment");
  await deployTokenPairs({
    walletClient,
    publicClient,
    deploymentRecord,
  });
}
import fs from "fs";
import path, { format } from "path";
import hre from "hardhat";
import { Address, BaseError, ContractFunctionRevertedError, formatUnits, parseUnits, PublicClient } from "viem";
import { WalletClient } from "@nomicfoundation/hardhat-viem/types";

export interface CommonParams {
  walletClient: WalletClient;
  publicClient: PublicClient;
}

export const tokenList = ["ZTC", "ETH", "USDC", "USDT", "BTC"] as const;
// Convert union to tuple (manually, due to TS limitations)
type TokenList = ["ZTC", "ETH", "USDC", "USDT", "BTC"];
type Tokens = TokenList[number];


// Create unique unordered pair combinations
type Combine<A extends string, B extends string> =
  A extends B ? never : `${A}${B}` extends `${B}${A}` ? never : `${A}${B}`;

type TokenPairsHelper<T extends readonly string[], Acc extends string = never> =
  T extends [infer First extends string, ...infer Rest extends string[]]
  ? TokenPairsHelper<Rest, Acc | Combine<First, Rest[number]>>
  : Acc;

export type TokenPairNames = TokenPairsHelper<TokenList>;

export type RequiredTokens = {
  ['ZTC']: string; // ZTC is always required
}

export type OptionalTokens = {
  [key in Tokens]?: string; // All tokens are optional except ZTC
};

export type TokenPairs = {
  [key in TokenPairNames]?: string; // All pairs are optional
}

export const getTokenPairs = (tokens: readonly string[]) => {
  const pairs: { tokenA: Tokens; tokenB: Tokens; name: TokenPairNames }[] = [];

  for (let i = 0; i < tokens.length; i++) {
    for (let j = i + 1; j < tokens.length; j++) {
      const tokenA = tokens[i] as Tokens;
      const tokenB = tokens[j] as Tokens;
      const name = `${tokenA}${tokenB}` as TokenPairNames;
      pairs.push({ tokenA, tokenB, name });
    }
  }

  return pairs;
}



export type DeployedContracts = {
  factory?: string;
  router?: string;
  tokens: OptionalTokens & RequiredTokens;
  pairs: TokenPairs;
};


export const PACKAGE_JSON_PATH = path.join(__dirname, "../../package.json");

export const updateDeploymentRecord = async (
  networkName: string,
  deployments: DeployedContracts
) => {
  const packageJson = JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, "utf8"));

  if (!packageJson.deployments) {
    packageJson.deployments = {};
  }

  packageJson.deployments[networkName] = deployments;

  fs.writeFileSync(PACKAGE_JSON_PATH, JSON.stringify(packageJson, null, 2));
  console.log(`Updated package.json for network: ${networkName}`);
}

export const readDeploymentRecord = async (networkName: string): Promise<DeployedContracts> => {
  const packageJson = JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, "utf8"));
  if (!packageJson.deployments) {
    packageJson.deployments = {};
  }

  const deployments = packageJson.deployments[networkName] as DeployedContracts | undefined;

  if (!deployments) {
    console.warn(`No deployments found for network: ${networkName}`);

    return {
      tokens: {
        ZTC: "0x0000000000000000000000000000000000000804",
      },
      pairs: {},
    }
  }

  if (!deployments.tokens) {
    deployments.tokens = {
      ZTC: "0x0000000000000000000000000000000000000804"
    }
  }

  if (!deployments.pairs) {
    deployments.pairs = {};
  }


  return deployments;
}

export interface MintTokenParms {
  walletClient: WalletClient;
  publicClient: PublicClient;
  tokenAddress: Address;
  amount: string; // Amount to mint
  decimals?: number; // Optional, defaults to 18, used only for logging
  forAddress?: Address; // Optional, if provided, mints to this address instead of walletClient.account.address
}

export const mintMockToken = async ({
  walletClient,
  publicClient,
  tokenAddress,
  amount,
  decimals = 18,
  forAddress = walletClient.account.address, // Default to walletClient's address
}: MintTokenParms) => {
  console.log(`Minting ${formatUnits(BigInt(amount), decimals)} of token at address ${tokenAddress} with ${decimals} decimals`);

  try {
    const MockToken = await hre.artifacts.readArtifact("MockToken");
    const mintHash = await walletClient.writeContract({
      address: tokenAddress,
      abi: MockToken.abi,
      functionName: "mint",
      args: [forAddress, BigInt(amount)],
      chain: undefined,
      account: null
    });
    await publicClient.waitForTransactionReceipt({ hash: mintHash });
  } catch (err) {
    console.error(`Error minting token at address ${tokenAddress}:`, err);
  }
}


export interface ApproveTokenTransferParams {
  walletClient: WalletClient;
  publicClient: PublicClient;
  tokenAddress: Address;
  spender: Address;
  amount: string;
  decimals?: number; // Optional, defaults to 18. used only for logging
}

export const approveTokenTransfer = async ({ walletClient, publicClient, tokenAddress, spender, amount, decimals = 18 }: ApproveTokenTransferParams) => {

  console.log(`Approving ${formatUnits(BigInt(amount), decimals)} of token at address ${tokenAddress} for spender ${spender} with ${decimals || 18} decimals`);

  const IERC20 = await hre.artifacts.readArtifact("IERC20Metadata");
  const approveETHHash = await walletClient.writeContract({
    address: tokenAddress,
    abi: IERC20.abi,
    functionName: "approve",
    args: [spender, BigInt(amount)],
    chain: undefined,
    account: null
  });

  await publicClient.waitForTransactionReceipt({ hash: approveETHHash });
  const allowanceETH = await publicClient.readContract({
    address: tokenAddress,
    abi: IERC20.abi,
    functionName: "allowance",
    args: [walletClient.account?.address, spender],
  });

  // Ensure allowanceETH is a bigint (if array, take first element)
  const allowanceValue = Array.isArray(allowanceETH) ? allowanceETH[0] : allowanceETH;

  console.log(
    `${tokenAddress} Allowance to Router:`,
    formatUnits(allowanceValue, decimals).toString()
  );
}

export interface AddLiquidityParams {
  walletClient: WalletClient;
  publicClient: PublicClient;
  routerAddress: Address;
  tokenA: Address;
  tokenB: Address;
  amountADesired: string;
  amountBDesired: string;
  mintTokensA?: boolean; // Optional, defaults to false
  mintTokensB?: boolean; // Optional, defaults to false
}

export const addLiquidityToPair = async ({
  walletClient,
  publicClient,
  routerAddress,
  tokenA,
  tokenB,
  amountADesired,
  amountBDesired,
  mintTokensA = false, // Optional, defaults to false
  mintTokensB = false, // Optional, defaults to false
}: AddLiquidityParams) => {

  // Mint tokens if they are mock tokens
  if (mintTokensA) {
    await mintMockToken({
      walletClient,
      publicClient,
      tokenAddress: tokenA,
      amount: amountADesired,
    });
  }
  if (mintTokensB) {
    await mintMockToken({
      walletClient,
      publicClient,
      tokenAddress: tokenB,
      amount: amountBDesired,
    });
  }

  // Approve token transfers for the router
  await approveTokenTransfer({
    walletClient,
    publicClient,
    tokenAddress: tokenA,
    spender: routerAddress,
    amount: amountADesired,
  });
  await approveTokenTransfer({
    walletClient,
    publicClient,
    tokenAddress: tokenB,
    spender: routerAddress,
    amount: amountBDesired,
  });

  console.log(`Adding liquidity to pair: ${tokenA} and ${tokenB}`);
  console.log(`Amount A Desired: ${formatUnits(BigInt(amountADesired), 18).toString()}`);
  console.log(`Amount B Desired: ${formatUnits(BigInt(amountBDesired), 18).toString()}`);

  const IUniswapV2Router02 = await hre.artifacts.readArtifact("IUniswapV2Router02");

  const deadline = Math.floor(Date.now() / 1000) + 60 * 20; // 20 minutes from now

  try {
    const addLiquidityHash = await walletClient.writeContract({
      address: routerAddress,
      abi: IUniswapV2Router02.abi,
      functionName: "addLiquidity",
      args: [
        tokenA,
        tokenB,
        BigInt(amountADesired),
        BigInt(amountBDesired),
        0n, // Min amount A
        0n, // Min amount B
        walletClient.account.address, // Recipient
        BigInt(deadline), // Deadline (20 minutes from now)
      ],
      account: walletClient.account.address,
    });
  } catch (err) {
    if (err instanceof BaseError) {
      const revertError = err.walk(err => err instanceof ContractFunctionRevertedError)
      if (revertError instanceof ContractFunctionRevertedError) {
        const errorName = revertError.data?.errorName ?? ''
        console.log(errorName);
        console.log(revertError.data?.args ?? '');
      }
    }

    console.error("Error adding liquidity:", err);
    throw err;
  }


  //await publicClient.waitForTransactionReceipt({ hash: addLiquidityHash });
  console.log("Liquidity added successfully.");

}

export interface CreatePairParams {
  walletClient: WalletClient;
  publicClient: PublicClient;
  factoryAddress: Address;
  tokenA: Address;
  tokenB: Address;
}
export const createPair = async ({
  walletClient,
  publicClient,
  factoryAddress,
  tokenA,
  tokenB,
}: CreatePairParams) => {
  const IUniswapV2Factory = await hre.artifacts.readArtifact("IUniswapV2Factory");

  const createPairHash = await walletClient.writeContract({
    address: factoryAddress,
    abi: IUniswapV2Factory.abi,
    functionName: "createPair",
    args: [tokenA, tokenB],
    chain: undefined,
    account: null
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash: createPairHash });
  console.log(`Pair created successfully. Transaction Hash: ${receipt.transactionHash}`);

  const pairAddress = await publicClient.readContract({
    address: factoryAddress,
    abi: IUniswapV2Factory.abi,
    functionName: "getPair",
    args: [tokenA, tokenB],
  });
  return pairAddress;
}

export interface DeployMockTokenParams {
  walletClient: WalletClient;
  publicClient: PublicClient;
  name: string;
  symbol: string;
  decimals?: number; // Optional, defaults to 18
}

export const deployMockToken = async ({
  walletClient,
  publicClient,
  name,
  symbol,
  decimals = 18, // Optional, defaults to 18
}: DeployMockTokenParams) => {
  const MockToken = await hre.artifacts.readArtifact("MockToken");
  const deployHash = await walletClient.deployContract({
    abi: MockToken.abi,
    bytecode: MockToken.bytecode as `0x${string}`,
    args: [name, symbol, decimals],
    chain: undefined,
    account: null
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash: deployHash });
  console.log(`Mock token deployed successfully. Transaction Hash: ${receipt.transactionHash}`);

  return receipt.contractAddress!;
}
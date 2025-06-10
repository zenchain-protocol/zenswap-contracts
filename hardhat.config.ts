import 'dotenv/config'
import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "@nomicfoundation/hardhat-viem";

const config: HardhatUserConfig = {
  solidity: {
    compilers: [
      {
        version: "0.8.27", // Mock Token Contracts
        settings: {
          optimizer: { enabled: true, runs: 1000000 },
          evmVersion: `shanghai`,
        },
      },
      {
        version: "0.6.6", // Uniswap V2 Periphery
        settings: {
          optimizer: { enabled: true, runs: 1000000 },
        },
      },
      {
        version: "0.5.16", // Uniswap V2 Core
        settings: {
          optimizer: { enabled: true, runs: 1000000 },
        },
      },
    ],
  },
  paths: {
    sources: "./contracts",
    cache: "./cache",
    artifacts: "./artifacts",
  },
  networks: {
    hardhat: {
      forking: {
        url: `https://zenchain-testnet.api.onfinality.io/rpc?apikey=${process.env.RPC_API_KEY}`,
      },
      loggingEnabled: true,
      chainId: 31337,
    },
    zenchainTestnet: {
      url: `https://zenchain-testnet.api.onfinality.io/rpc?apikey=${process.env.RPC_API_KEY}`,
      chainId: 8408,
      accounts: [process.env.DEPLOYER_PRIVATE_KEY!],
      minGasPrice: 1000000000,
    },
  },
};

export default config;

import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";

const config: HardhatUserConfig = {
  solidity: {
    compilers: [
      {
        version: "0.8.28", // Mock Contracts
        settings: {
          optimizer: { enabled: true, runs: 200 },
        },
      },
      {
        version: "0.6.6", // Uniswap V2 Periphery
        settings: {
          optimizer: { enabled: true, runs: 200 },
        },
      },
      {
        version: "0.5.16", // Uniswap V2 Core
        settings: {
          optimizer: { enabled: true, runs: 200 },
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
      loggingEnabled: true,
      chainId: 31337,
    },
  },
};

export default config;

import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-ethers";
import "@nomicfoundation/hardhat-chai-matchers";
import "@nomicfoundation/hardhat-verify";
import "@typechain/hardhat";
import "hardhat-gas-reporter";
import "hardhat-contract-sizer";
import * as dotenv from "dotenv";

dotenv.config();

const { TESTNET_PRIVATE_KEY, MAINNET_PRIVATE_KEY, ETHERSCAN_API } = process.env;
const reportGas = process.env.REPORT_GAS;

const config: HardhatUserConfig = {
  networks: {
    localhost: {
      url: "http://127.0.0.1:8545",
    },
    sepolia: {
      url: "https://ethereum-sepolia.publicnode.com",
      chainId: 11155111,
      ...(TESTNET_PRIVATE_KEY ? { accounts: [TESTNET_PRIVATE_KEY] } : {}),
    },
    ethereum: {
      url: "https://ethereum.publicnode.com",
      chainId: 1,
      ...(MAINNET_PRIVATE_KEY ? { accounts: [MAINNET_PRIVATE_KEY] } : {}),
    },
  },
  solidity: {
    version: "0.8.28",
    settings: {
      evmVersion: "cancun",
      optimizer: {
        enabled: true,
        runs: 1000,
      },
    },
  },
  etherscan: {
    apiKey: ETHERSCAN_API || "",
  },
  gasReporter: {
    enabled: reportGas === "1",
  },
};

export default config;

import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-ethers";
import "@nomicfoundation/hardhat-chai-matchers";
import * as dotenv from "dotenv";

dotenv.config();

const ZERO_KEY =
  "0x0000000000000000000000000000000000000000000000000000000000000000";

function normalizePrivateKey(raw?: string): string | undefined {
  const trimmed = raw?.trim();
  if (!trimmed) return undefined;
  const withPrefix = trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`;
  if (withPrefix.length !== 66 || withPrefix === ZERO_KEY) return undefined;
  return withPrefix;
}

const privateKey = normalizePrivateKey(process.env.PRIVATE_KEY);
const anvilPort = process.env.ANVIL_PORT || "18545";
const anvilRpcUrl = process.env.ANVIL_RPC_URL || `http://127.0.0.1:${anvilPort}`;

function resolveAccounts(networkKey: string): string[] {
  const specificKey = normalizePrivateKey(process.env[networkKey]);
  if (specificKey) {
    return [specificKey];
  }
  return privateKey ? [privateKey] : [];
}

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: {
      viaIR: true,
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  networks: {
    hardhat: {
      chainId: 31337,
    },
    anvil: {
      url: anvilRpcUrl,
      chainId: Number(process.env.ANVIL_CHAIN_ID || 31337),
    },
    bscTestnet: {
      url:
        process.env.BSC_TESTNET_RPC ||
        "https://data-seed-prebsc-1-s1.binance.org:8545",
      chainId: 97,
      accounts: resolveAccounts("BSC_TESTNET_PRIVATE_KEY"),
    },
    baseSepolia: {
      url: process.env.BASE_SEPOLIA_RPC || "https://sepolia.base.org",
      chainId: 84532,
      accounts: resolveAccounts("BASE_SEPOLIA_PRIVATE_KEY"),
    },
    avaxFuji: {
      url:
        process.env.AVAX_FUJI_RPC ||
        "https://api.avax-test.network/ext/bc/C/rpc",
      chainId: 43113,
      accounts: resolveAccounts("AVAX_FUJI_PRIVATE_KEY"),
    },
    bsc: {
      url: process.env.BSC_MAINNET_RPC || "https://bsc-dataseed.binance.org",
      chainId: 56,
      accounts: resolveAccounts("BSC_MAINNET_PRIVATE_KEY"),
    },
    base: {
      url: process.env.BASE_MAINNET_RPC || "https://mainnet.base.org",
      chainId: 8453,
      accounts: resolveAccounts("BASE_MAINNET_PRIVATE_KEY"),
    },
    avax: {
      url:
        process.env.AVAX_MAINNET_RPC || "https://api.avax.network/ext/bc/C/rpc",
      chainId: 43114,
      accounts: resolveAccounts("AVAX_MAINNET_PRIVATE_KEY"),
    },
  },
};

export default config;

/**
 * Chain configuration for multi-chain support.
 * Defines supported chains and resolves config from environment variables.
 */

import { bscTestnet, bsc, baseSepolia, base } from "wagmi/chains";
import type { Chain } from "wagmi/chains";
import {
  BSC_RPC_URL,
  BSC_CHAIN_ID,
  BSC_GOLD_CLOB_ADDRESS,
  BASE_RPC_URL,
  BASE_CHAIN_ID,
  BASE_GOLD_CLOB_ADDRESS,
} from "./config";

// ============================================================================
// Types
// ============================================================================

export type ChainId = "solana" | "bsc" | "base";

export type EvmChainConfig = {
  chainId: ChainId;
  evmChainId: number;
  name: string;
  shortName: string;
  rpcUrl: string;
  goldClobAddress: string;
  nativeCurrency: { name: string; symbol: string; decimals: number };
  blockExplorer: string;
  wagmiChain: Chain;
  color: string;
  icon: string; // emoji
};

// ============================================================================
// Chain Configs
// ============================================================================

function createCustomChain(
  template: Chain,
  {
    id,
    name,
    rpcUrl,
    nativeCurrency,
  }: {
    id: number;
    name: string;
    rpcUrl: string;
    nativeCurrency: { name: string; symbol: string; decimals: number };
  },
): Chain {
  return {
    ...template,
    id,
    name,
    nativeCurrency,
    rpcUrls: {
      default: { http: [rpcUrl] },
      public: { http: [rpcUrl] },
    },
    blockExplorers: {
      default: {
        name: "Local RPC",
        url: rpcUrl,
      },
    },
    testnet: true,
  } as Chain;
}

function resolveBscWagmiChain(): Chain {
  if (BSC_CHAIN_ID === 56) return bsc;
  if (BSC_CHAIN_ID === 97) return bscTestnet;
  return createCustomChain(bscTestnet, {
    id: BSC_CHAIN_ID,
    name: `BSC Local (${BSC_CHAIN_ID})`,
    rpcUrl: BSC_RPC_URL,
    nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
  });
}

function resolveBaseWagmiChain(): Chain {
  if (BASE_CHAIN_ID === 8453) return base;
  if (BASE_CHAIN_ID === 84532) return baseSepolia;
  return createCustomChain(baseSepolia, {
    id: BASE_CHAIN_ID,
    name: `Base Local (${BASE_CHAIN_ID})`,
    rpcUrl: BASE_RPC_URL,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  });
}

const BSC_CONFIG: EvmChainConfig = {
  chainId: "bsc",
  evmChainId: BSC_CHAIN_ID,
  name:
    BSC_CHAIN_ID === 56
      ? "BNB Smart Chain"
      : BSC_CHAIN_ID === 97
        ? "BSC Testnet"
        : `BSC Local (${BSC_CHAIN_ID})`,
  shortName: "BSC",
  rpcUrl: BSC_RPC_URL,
  goldClobAddress: BSC_GOLD_CLOB_ADDRESS,
  nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
  blockExplorer:
    BSC_CHAIN_ID === 56
      ? "https://bscscan.com"
      : BSC_CHAIN_ID === 97
        ? "https://testnet.bscscan.com"
        : BSC_RPC_URL,
  wagmiChain: resolveBscWagmiChain(),
  color: "#F0B90B",
  icon: "💎",
};

const BASE_CONFIG: EvmChainConfig = {
  chainId: "base",
  evmChainId: BASE_CHAIN_ID,
  name:
    BASE_CHAIN_ID === 8453
      ? "Base"
      : BASE_CHAIN_ID === 84532
        ? "Base Sepolia"
        : `Base Local (${BASE_CHAIN_ID})`,
  shortName: "Base",
  rpcUrl: BASE_RPC_URL,
  goldClobAddress: BASE_GOLD_CLOB_ADDRESS,
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  blockExplorer:
    BASE_CHAIN_ID === 8453
      ? "https://basescan.org"
      : BASE_CHAIN_ID === 84532
        ? "https://sepolia.basescan.org"
        : BASE_RPC_URL,
  wagmiChain: resolveBaseWagmiChain(),
  color: "#0052FF",
  icon: "🔵",
};

// ============================================================================
// Helpers
// ============================================================================

function hasConfiguredContracts(config: EvmChainConfig): boolean {
  return config.goldClobAddress.trim().length > 0;
}

/** Get all EVM chain configs that have valid contract addresses configured. */
export function getEnabledEvmChains(): EvmChainConfig[] {
  const chains: EvmChainConfig[] = [];
  if (hasConfiguredContracts(BSC_CONFIG)) {
    chains.push(BSC_CONFIG);
  }
  if (hasConfiguredContracts(BASE_CONFIG)) {
    chains.push(BASE_CONFIG);
  }
  return chains;
}

/** Get config for a specific EVM chain. */
export function getEvmChainConfig(
  chainId: "bsc" | "base",
): EvmChainConfig | null {
  if (chainId === "bsc") {
    return hasConfiguredContracts(BSC_CONFIG) ? BSC_CONFIG : null;
  }
  if (chainId === "base") {
    return hasConfiguredContracts(BASE_CONFIG) ? BASE_CONFIG : null;
  }
  return null;
}

/** Get all available chains for wallet login/switching. */
export function getAvailableChains(): ChainId[] {
  const chains: ChainId[] = ["solana"];
  if (hasConfiguredContracts(BSC_CONFIG)) {
    chains.push("bsc");
  }
  if (hasConfiguredContracts(BASE_CONFIG)) {
    chains.push("base");
  }
  return chains;
}

/** Get wagmi chains array for provider config. */
export function getWagmiChains(): [Chain, ...Chain[]] {
  return [BSC_CONFIG.wagmiChain, BASE_CONFIG.wagmiChain];
}

/** Display info for chains. */
export const CHAIN_DISPLAY: Record<
  ChainId,
  { name: string; shortName: string; icon: string; color: string }
> = {
  solana: { name: "Solana", shortName: "SOL", icon: "☀️", color: "#9945FF" },
  bsc: {
    name: BSC_CONFIG.name,
    shortName: "BSC",
    icon: "💎",
    color: "#F0B90B",
  },
  base: {
    name: BASE_CONFIG.name,
    shortName: "Base",
    icon: "🔵",
    color: "#0052FF",
  },
};

/** Local storage key for caching the largest-market chain. */
export const LARGEST_MARKET_CACHE_KEY = "goldArena_largestMarketChain";

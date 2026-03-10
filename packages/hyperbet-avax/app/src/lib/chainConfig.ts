/**
 * Chain configuration for multi-chain support.
 * Defines supported chains and resolves config from environment variables.
 */

import { avalanche, avalancheFuji } from "wagmi/chains";
import type { Chain } from "wagmi/chains";
import {
  AVAX_RPC_URL,
  AVAX_CHAIN_ID,
  AVAX_GOLD_CLOB_ADDRESS,
} from "./config";

// ============================================================================
// Types
// ============================================================================

export type ChainId = "avax";

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

function resolveAvaxWagmiChain(): Chain {
  if (AVAX_CHAIN_ID === 43114) return avalanche;
  if (AVAX_CHAIN_ID === 43113) return avalancheFuji;
  return createCustomChain(avalancheFuji, {
    id: AVAX_CHAIN_ID,
    name: `Avalanche Local (${AVAX_CHAIN_ID})`,
    rpcUrl: AVAX_RPC_URL,
    nativeCurrency: { name: "Avalanche", symbol: "AVAX", decimals: 18 },
  });
}

const AVAX_CONFIG: EvmChainConfig = {
  chainId: "avax",
  evmChainId: AVAX_CHAIN_ID,
  name:
    AVAX_CHAIN_ID === 43114
      ? "Avalanche"
      : AVAX_CHAIN_ID === 43113
        ? "Avalanche Fuji"
        : `Avalanche Local (${AVAX_CHAIN_ID})`,
  shortName: "AVALANCHE",
  rpcUrl: AVAX_RPC_URL,
  goldClobAddress: AVAX_GOLD_CLOB_ADDRESS,
  nativeCurrency: { name: "Avalanche", symbol: "AVAX", decimals: 18 },
  blockExplorer:
    AVAX_CHAIN_ID === 43114
      ? "https://snowtrace.io"
      : AVAX_CHAIN_ID === 43113
        ? "https://testnet.snowtrace.io"
        : AVAX_RPC_URL,
  wagmiChain: resolveAvaxWagmiChain(),
  color: "#E84142",
  icon: "🔺",
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
  if (hasConfiguredContracts(AVAX_CONFIG)) {
    chains.push(AVAX_CONFIG);
  }
  return chains;
}

/** Get config for a specific EVM chain. */
export function getEvmChainConfig(chainId: "avax"): EvmChainConfig | null {
  if (chainId === "avax") {
    return hasConfiguredContracts(AVAX_CONFIG) ? AVAX_CONFIG : null;
  }
  return null;
}

/** Get all available chains for wallet login/switching. */
export function getAvailableChains(): ChainId[] {
  const chains: ChainId[] = [];
  if (hasConfiguredContracts(AVAX_CONFIG)) {
    chains.push("avax");
  }
  return chains;
}

/** Get wagmi chains array for provider config. */
export function getWagmiChains(): [Chain, ...Chain[]] {
  return [AVAX_CONFIG.wagmiChain];
}

/** Display info for chains. */
export const CHAIN_DISPLAY: Record<
  ChainId,
  { name: string; shortName: string; icon: string; color: string }
> = {
  avax: {
    name: AVAX_CONFIG.name,
    shortName: "AVAX",
    icon: "🔺",
    color: "#E84142",
  },
};

/** Local storage key for caching the largest-market chain. */
export const LARGEST_MARKET_CACHE_KEY = "goldArena_largestMarketChain";

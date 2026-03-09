import type { UiLocale } from "./i18n";

export type SupportedUiChainId = "solana" | "bsc" | "base" | "avax";

type LocalizedText = Record<UiLocale, string>;

type ChainUiConfig = {
  chainId: SupportedUiChainId;
  icon: string;
  color: string;
  name: LocalizedText;
  shortName: string;
  nativeToken: {
    symbol: string;
    decimals: number;
    name: LocalizedText;
  };
};

const CHAIN_UI_CONFIG: Record<SupportedUiChainId, ChainUiConfig> = {
  solana: {
    chainId: "solana",
    icon: "☀️",
    color: "#9945FF",
    name: { en: "Solana", zh: "索拉纳" },
    shortName: "SOL",
    nativeToken: {
      symbol: "SOL",
      decimals: 9,
      name: { en: "Solana", zh: "索拉纳" },
    },
  },
  bsc: {
    chainId: "bsc",
    icon: "💎",
    color: "#F0B90B",
    name: { en: "BNB Smart Chain", zh: "币安智能链" },
    shortName: "BSC",
    nativeToken: {
      symbol: "BNB",
      decimals: 18,
      name: { en: "BNB", zh: "BNB" },
    },
  },
  base: {
    chainId: "base",
    icon: "🔵",
    color: "#0052FF",
    name: { en: "Base", zh: "Base" },
    shortName: "Base",
    nativeToken: {
      symbol: "ETH",
      decimals: 18,
      name: { en: "Ether", zh: "以太币" },
    },
  },
  avax: {
    chainId: "avax",
    icon: "🔺",
    color: "#E84142",
    name: { en: "Avalanche", zh: "雪崩链" },
    shortName: "AVAX",
    nativeToken: {
      symbol: "AVAX",
      decimals: 18,
      name: { en: "Avalanche", zh: "雪崩币" },
    },
  },
};

export function getChainUiConfig(
  chainId: SupportedUiChainId,
): ChainUiConfig {
  return CHAIN_UI_CONFIG[chainId];
}

export function getLocalizedChainDisplay(
  chainId: SupportedUiChainId,
  locale: UiLocale,
): {
  name: string;
  shortName: string;
  icon: string;
  color: string;
  nativeToken: {
    symbol: string;
    decimals: number;
    name: string;
  };
} {
  const config = getChainUiConfig(chainId);
  return {
    name: config.name[locale],
    shortName: config.shortName,
    icon: config.icon,
    color: config.color,
    nativeToken: {
      symbol: config.nativeToken.symbol,
      decimals: config.nativeToken.decimals,
      name: config.nativeToken.name[locale],
    },
  };
}

export function isSupportedEvmChain(
  chainId: SupportedUiChainId,
): chainId is Exclude<SupportedUiChainId, "solana"> {
  return chainId !== "solana";
}

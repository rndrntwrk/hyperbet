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
    name: { en: "Solana", zh: "索拉纳", ko: "솔라나", pt: "Solana", es: "Solana" },
    shortName: "SOL",
    nativeToken: {
      symbol: "SOL",
      decimals: 9,
      name: { en: "Solana", zh: "索拉纳", ko: "솔라나", pt: "Solana", es: "Solana" },
    },
  },
  bsc: {
    chainId: "bsc",
    icon: "💎",
    color: "#F0B90B",
    name: { en: "BNB Smart Chain", zh: "币安智能链", ko: "BNB 스마트 체인", pt: "BNB Smart Chain", es: "BNB Smart Chain" },
    shortName: "BSC",
    nativeToken: {
      symbol: "BNB",
      decimals: 18,
      name: { en: "BNB", zh: "BNB", ko: "BNB", pt: "BNB", es: "BNB" },
    },
  },
  base: {
    chainId: "base",
    icon: "🔵",
    color: "#0052FF",
    name: { en: "Base", zh: "Base", ko: "베이스", pt: "Base", es: "Base" },
    shortName: "Base",
    nativeToken: {
      symbol: "ETH",
      decimals: 18,
      name: { en: "Ether", zh: "以太币", ko: "이더", pt: "Ether", es: "Ether" },
    },
  },
  avax: {
    chainId: "avax",
    icon: "https://images.ctfassets.net/gcj8jwzm6086/5VHupNKwnDYJvqMENeV7iJ/fdd6326b7a82c8388e4ee9d4be7062d4/avalanche-avax-logo.svg",
    color: "#E84142",
    name: { en: "Avalanche", zh: "雪崩链", ko: "아발란체", pt: "Avalanche", es: "Avalanche" },
    shortName: "AVAX",
    nativeToken: {
      symbol: "AVAX",
      decimals: 18,
      name: { en: "Avalanche", zh: "雪崩币", ko: "아발란체", pt: "Avalanche", es: "Avalanche" },
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

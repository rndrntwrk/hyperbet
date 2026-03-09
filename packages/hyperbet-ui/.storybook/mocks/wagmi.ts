const CHAIN_ID_MAP = {
  solana: 43114,
  bsc: 56,
  base: 8453,
  avax: 43114,
} as const;

const STORYBOOK_EVM_WALLET = "0x1234567890abcdef1234567890abcdef12345678";

function readStoryChain(): keyof typeof CHAIN_ID_MAP {
  if (typeof window === "undefined") return "bsc";
  const selected = window.localStorage.getItem("goldArena_selectedChain");
  if (selected === "bsc" || selected === "base" || selected === "avax") {
    return selected;
  }
  return "bsc";
}

export function useAccount() {
  return {
    address: STORYBOOK_EVM_WALLET,
    isConnected: true,
  };
}

export function useChainId() {
  return CHAIN_ID_MAP[readStoryChain()];
}

export function useSwitchChain() {
  return {
    switchChainAsync: async ({ chainId }: { chainId: number }) => chainId,
  };
}

export function useWalletClient() {
  return {
    data: {
      account: {
        address: STORYBOOK_EVM_WALLET,
      },
      chain: {
        id: CHAIN_ID_MAP[readStoryChain()],
      },
    },
  };
}

export function WagmiProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}

import { useMemo, type ComponentType, type PropsWithChildren } from "react";
import type { Adapter } from "@solana/wallet-adapter-base";
import {
  ConnectionProvider,
  WalletProvider,
} from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RainbowKitProvider, darkTheme } from "@rainbow-me/rainbowkit";
import { WagmiProvider, type Config as WagmiConfig } from "wagmi";

import "@solana/wallet-adapter-react-ui/styles.css";
import "@rainbow-me/rainbowkit/styles.css";

type HeadlessWalletDescriptor = {
  adapter: Adapter;
  autoConnect: boolean;
};

type CreateHyperbetAppRootOptions = {
  getRpcUrl: () => string;
  getWsUrl: () => string;
  createHeadlessWalletsFromEnv: () => HeadlessWalletDescriptor[];
  ChainProvider: ComponentType<PropsWithChildren>;
  wagmiConfig?: WagmiConfig;
  App: ComponentType;
  StreamUIApp: ComponentType;
  isStreamUi?: boolean;
};

export function createHyperbetAppRoot({
  getRpcUrl,
  getWsUrl,
  createHeadlessWalletsFromEnv,
  ChainProvider,
  wagmiConfig,
  App,
  StreamUIApp,
  isStreamUi = import.meta.env.MODE === "stream-ui",
}: CreateHyperbetAppRootOptions): ComponentType {
  const queryClient = new QueryClient();

  return function HyperbetAppRoot() {
    const endpoint = getRpcUrl();
    const wsEndpoint = getWsUrl();
    const headlessWallets = useMemo(() => createHeadlessWalletsFromEnv(), []);

    const wallets = useMemo(() => {
      const walletList: Adapter[] = headlessWallets.map(
        (wallet) => wallet.adapter,
      );
      walletList.push(new PhantomWalletAdapter());
      return walletList;
    }, [headlessWallets]);

    const autoConnectWallet = headlessWallets.find(
      (entry) => entry.autoConnect,
    );
    if (autoConnectWallet) {
      localStorage.setItem(
        "walletName",
        JSON.stringify(autoConnectWallet.adapter.name),
      );
    }

    const appContent = isStreamUi ? <StreamUIApp /> : <App />;

    // Only mount Solana providers when a valid RPC endpoint is configured.
    // EVM-only chain packages (AVAX, BSC) pass an empty string to opt out.
    const innerContent = endpoint ? (
      <ConnectionProvider
        endpoint={endpoint}
        config={{
          wsEndpoint,
          commitment: "confirmed",
          disableRetryOnRateLimit: true,
        }}
      >
        <WalletProvider wallets={wallets} autoConnect>
          <WalletModalProvider>{appContent}</WalletModalProvider>
        </WalletProvider>
      </ConnectionProvider>
    ) : (
      appContent
    );

    const content = <ChainProvider>{innerContent}</ChainProvider>;

    return (
      <QueryClientProvider client={queryClient}>
        {wagmiConfig ? (
          <WagmiProvider config={wagmiConfig}>
            <RainbowKitProvider
              theme={darkTheme({
                accentColor: "#eab308",
                borderRadius: "large",
              })}
            >
              {content}
            </RainbowKitProvider>
          </WagmiProvider>
        ) : (
          content
        )}
      </QueryClientProvider>
    );
  };
}

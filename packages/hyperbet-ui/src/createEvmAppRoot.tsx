/**
 * EVM-only app root factory — no Solana imports whatsoever.
 * Use this in hyperbet-avax and hyperbet-bsc so that Vite never crawls
 * @solana/* dependencies and hits the @noble/hashes v1/v2 conflict.
 */
import {
  type ComponentProps,
  type ComponentType,
  type ReactNode,
  useMemo,
} from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RainbowKitProvider, darkTheme } from "@rainbow-me/rainbowkit";
import { WagmiProvider } from "wagmi";

import "@rainbow-me/rainbowkit/styles.css";

type WagmiConfig = ComponentProps<typeof WagmiProvider>["config"];

export interface CreateEvmAppRootOptions {
  ChainProvider: ComponentType<{ children: ReactNode }>;
  wagmiConfig: WagmiConfig;
  App: ComponentType;
  StreamUIApp: ComponentType;
  isStreamUi?: boolean;
}

export function createEvmAppRoot({
  ChainProvider,
  wagmiConfig,
  App,
  StreamUIApp,
  isStreamUi = import.meta.env.MODE === "stream-ui",
}: CreateEvmAppRootOptions): ComponentType {
  const queryClient = new QueryClient();

  return function EvmAppRoot() {
    const appContent = isStreamUi ? <StreamUIApp /> : <App />;
    const content = <ChainProvider>{appContent}</ChainProvider>;

    return (
      <QueryClientProvider client={queryClient}>
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
      </QueryClientProvider>
    );
  };
}

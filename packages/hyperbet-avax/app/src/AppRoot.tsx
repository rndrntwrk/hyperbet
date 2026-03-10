import { type ReactNode, useMemo } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  RainbowKitProvider,
  darkTheme,
  lightTheme,
} from "@rainbow-me/rainbowkit";
import { WagmiProvider } from "wagmi";

import "@rainbow-me/rainbowkit/styles.css";

import { ChainProvider } from "./lib/ChainContext";
import { ThemeProvider, useTheme } from "./lib/theme";
import { wagmiConfig } from "./lib/wagmiConfig";
import { App } from "./App";
import { StreamUIApp } from "./StreamUIApp";

function AvaxProviders({ children }: { children: ReactNode }) {
  const { theme } = useTheme();
  const queryClient = useMemo(() => new QueryClient(), []);
  const rainbowTheme = useMemo(
    () =>
      theme === "light"
        ? lightTheme({
            accentColor: "#E84142",
            accentColorForeground: "#ffffff",
            borderRadius: "large",
            overlayBlur: "small",
          })
        : darkTheme({
            accentColor: "#E84142",
            accentColorForeground: "#ffffff",
            borderRadius: "large",
            overlayBlur: "small",
          }),
    [theme],
  );

  return (
    <QueryClientProvider client={queryClient}>
      <WagmiProvider config={wagmiConfig as any}>
        <RainbowKitProvider theme={rainbowTheme}>
          <ChainProvider>{children}</ChainProvider>
        </RainbowKitProvider>
      </WagmiProvider>
    </QueryClientProvider>
  );
}

export default function AppRoot() {
  const isStreamUi = import.meta.env.MODE === "stream-ui";

  return (
    <ThemeProvider>
      <AvaxProviders>{isStreamUi ? <StreamUIApp /> : <App />}</AvaxProviders>
    </ThemeProvider>
  );
}

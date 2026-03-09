import { useEffect, useMemo, useRef, useState } from "react";
import { Buffer } from "buffer";
import { SolanaProvider } from "@solana/react-hooks";
import { watchWalletStandardConnectors } from "@solana/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { AppWalletProvider } from "./lib/appWallet";
import { createFrameworkClient } from "./lib/frameworkClient";
import { createHeadlessWalletConnectorsFromEnv } from "./lib/headlessWallet";
import { App } from "./App";
import { StreamUIApp } from "./StreamUIApp";

const IS_STREAM_UI = import.meta.env.MODE === "stream-ui";

if (!(globalThis as { Buffer?: typeof Buffer }).Buffer) {
  (globalThis as { Buffer?: typeof Buffer }).Buffer = Buffer;
}

const queryClient = new QueryClient();

export default function AppRoot() {
  const [walletScanVersion, setWalletScanVersion] = useState(0);
  const headlessWallets = useMemo(
    () => createHeadlessWalletConnectorsFromEnv(),
    [],
  );
  const frameworkClient = useMemo(
    () => createFrameworkClient(),
    [walletScanVersion],
  );
  const knownConnectorIdsRef = useRef<string>("");
  const autoConnectHeadlessConnectorId =
    headlessWallets.find((entry) => entry.autoConnect)?.connector.id ?? null;

  useEffect(() => {
    const stopWatchingWallets = watchWalletStandardConnectors((connectors) => {
      const nextConnectorIds = connectors
        .map((connector) => connector.id)
        .sort()
        .join("|");
      if (nextConnectorIds === knownConnectorIdsRef.current) return;
      knownConnectorIdsRef.current = nextConnectorIds;

      const walletStatus = frameworkClient.store.getState().wallet.status;
      if (walletStatus === "disconnected") {
        setWalletScanVersion((value) => value + 1);
      }
    });

    const delayedRescanId = window.setTimeout(() => {
      const walletStatus = frameworkClient.store.getState().wallet.status;
      if (walletStatus === "disconnected") {
        setWalletScanVersion((value) => value + 1);
      }
    }, 500);

    return () => {
      stopWatchingWallets();
      window.clearTimeout(delayedRescanId);
    };
  }, [frameworkClient]);

  return (
    <SolanaProvider
      client={frameworkClient}
      walletPersistence={{
        autoConnect: true,
        storageKey: "hyperbet-solana:last-wallet",
      }}
    >
      <QueryClientProvider client={queryClient}>
        <AppWalletProvider
          headlessAutoConnectorId={autoConnectHeadlessConnectorId}
        >
          {IS_STREAM_UI ? <StreamUIApp /> : <App />}
        </AppWalletProvider>
      </QueryClientProvider>
    </SolanaProvider>
  );
}

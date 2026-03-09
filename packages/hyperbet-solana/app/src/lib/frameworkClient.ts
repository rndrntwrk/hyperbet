import {
  createClient,
  defaultWalletConnectors,
  type WalletConnector,
} from "@solana/client";
import { connectorKit } from "@solana/client/connectorkit";

import { getCluster, getRpcUrl, getWsUrl } from "./config";
import { createHeadlessWalletConnectorsFromEnv } from "./headlessWallet";

function resolveConnectorKitNetwork() {
  const cluster = getCluster();
  if (cluster === "mainnet-beta") {
    return "mainnet-beta" as const;
  }
  if (cluster === "devnet" || cluster === "testnet" || cluster === "localnet") {
    return cluster;
  }
  return "devnet" as const;
}

function dedupeConnectors(connectors: readonly WalletConnector[]) {
  const seen = new Set<string>();
  const unique: WalletConnector[] = [];
  for (const connector of connectors) {
    if (seen.has(connector.id)) continue;
    seen.add(connector.id);
    unique.push(connector);
  }
  return unique;
}

export function createFrameworkClient() {
  const headlessConnectors = createHeadlessWalletConnectorsFromEnv().map(
    (entry) => entry.connector,
  );
  const detectedConnectors = defaultWalletConnectors();
  const interactiveConnectors = connectorKit({
    defaultConfig: {
      appName: "Hyperbet Solana",
      appUrl:
        typeof window !== "undefined"
          ? window.location.origin
          : "https://hyperbet.ai",
      autoConnect: true,
      enableMobile: true,
      network: resolveConnectorKitNetwork(),
    },
  });
  return createClient({
    endpoint: getRpcUrl(),
    websocketEndpoint: getWsUrl(),
    walletConnectors: dedupeConnectors([
      ...headlessConnectors,
      ...detectedConnectors,
      ...interactiveConnectors,
    ]),
  });
}

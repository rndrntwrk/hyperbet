/**
 * SolanaProviders — all @solana/* imports are isolated here so this module is
 * only loaded in packages that actually use Solana (i.e. hyperbet-solana).
 * EVM-only packages (hyperbet-avax, hyperbet-bsc) lazy-import this via
 * createAppRoot.tsx and never trigger the load since `endpoint` is "".
 */

import { type ReactNode, useMemo } from "react";
import type { Adapter } from "@solana/wallet-adapter-base";
import {
  ConnectionProvider,
  WalletProvider,
} from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import "@solana/wallet-adapter-react-ui/styles.css";
import type { HeadlessWalletDescriptor } from "./createAppRoot";

interface SolanaProvidersProps {
  endpoint: string;
  wsEndpoint: string | undefined;
  headlessWallets: HeadlessWalletDescriptor[];
  children: ReactNode;
}

export function SolanaProviders({
  endpoint,
  wsEndpoint,
  headlessWallets,
  children,
}: SolanaProvidersProps) {
  const wallets = useMemo(() => {
    const walletList: Adapter[] = headlessWallets.map(
      (w) => w.adapter as Adapter,
    );
    walletList.push(new PhantomWalletAdapter());

    const autoConnectWallet = headlessWallets.find((w) => w.autoConnect);
    if (autoConnectWallet) {
      localStorage.setItem(
        "walletName",
        JSON.stringify((autoConnectWallet.adapter as Adapter).name),
      );
    }

    return walletList;
  }, [headlessWallets]);

  return (
    <ConnectionProvider
      endpoint={endpoint}
      config={{
        wsEndpoint,
        commitment: "confirmed",
        disableRetryOnRateLimit: true,
      }}
    >
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}

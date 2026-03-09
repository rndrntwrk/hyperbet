import type { ReactNode } from "react";
import { PublicKey } from "@solana/web3.js";

const STORY_PUBLIC_KEY = new PublicKey(
  "9YQ6U3b1i3Qxb38nSxrdbidKdvUSsfx8bVsgcuyo6edS",
);

const mockConnection = {
  rpcEndpoint: "https://storybook.solana.local",
  getAccountInfo: async () => null,
  getMultipleAccountsInfo: async (keys: unknown[]) => keys.map(() => null),
  getMinimumBalanceForRentExemption: async () => 0,
  getBalance: async () => 0,
};

const mockWallet = {
  publicKey: STORY_PUBLIC_KEY,
  connected: true,
  signTransaction: async <T,>(tx: T) => tx,
  signAllTransactions: async <T,>(txs: T[]) => txs,
  disconnect: async () => undefined,
  connect: async () => undefined,
};

export function useConnection() {
  return { connection: mockConnection as any };
}

export function useWallet() {
  return mockWallet as any;
}

export function ConnectionProvider({
  children,
}: {
  children: ReactNode;
}) {
  return <>{children}</>;
}

export function WalletProvider({
  children,
}: {
  children: ReactNode;
}) {
  return <>{children}</>;
}

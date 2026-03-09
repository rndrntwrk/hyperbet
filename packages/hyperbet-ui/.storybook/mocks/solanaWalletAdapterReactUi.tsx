import type { ReactNode } from "react";

export function useWalletModal() {
  return {
    setVisible: () => undefined,
  };
}

export function WalletModalProvider({
  children,
}: {
  children: ReactNode;
}) {
  return <>{children}</>;
}

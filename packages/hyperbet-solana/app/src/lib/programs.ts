import {
  AnchorProvider,
  BN,
  Program,
  type Idl,
  type Wallet,
} from "@coral-xyz/anchor";
import {
  Connection,
  PublicKey,
  type Transaction,
  type VersionedTransaction,
} from "@solana/web3.js";
import type { WalletContextState } from "@solana/wallet-adapter-react";

import fightOracleIdl from "../idl/fight_oracle.json";
import goldClobMarketIdl from "../idl/gold_clob_market.json";
import goldPerpsMarketIdl from "../idl/gold_perps_market.json";
import { CONFIG } from "./config";

function extractProgramAddressFromIdl(idlJson: unknown): string | null {
  if (!idlJson || typeof idlJson !== "object") return null;
  const asRecord = idlJson as Record<string, unknown>;
  const direct = asRecord.address;
  if (typeof direct === "string" && direct.trim()) return direct.trim();

  const metadata = asRecord.metadata;
  if (!metadata || typeof metadata !== "object") return null;
  const metadataAddress = (metadata as Record<string, unknown>).address;
  if (typeof metadataAddress === "string" && metadataAddress.trim()) {
    return metadataAddress.trim();
  }

  return null;
}

function resolveProgramId(idlJson: unknown, fallback: string): PublicKey {
  const address = extractProgramAddressFromIdl(idlJson) || fallback;
  return new PublicKey(address);
}

function resolveConfiguredProgramId(
  configuredAddress: string,
  idlJson: unknown,
  fallback: string,
): PublicKey {
  const trimmedConfigured = configuredAddress.trim();
  if (trimmedConfigured.length > 0) {
    return new PublicKey(trimmedConfigured);
  }
  return resolveProgramId(idlJson, fallback);
}

function ensureIdlAddress(idlJson: unknown, programId: PublicKey): Idl {
  const idlWithMaybeAddress = idlJson as Idl & { address?: string };
  return {
    ...idlWithMaybeAddress,
    // Anchor Program constructor reads `idl.address` directly. Some generated
    // IDLs only include `metadata.address`, so mirror it here.
    address:
      idlWithMaybeAddress.address && idlWithMaybeAddress.address.trim()
        ? idlWithMaybeAddress.address
        : programId.toBase58(),
  } as Idl;
}

export const FIGHT_ORACLE_PROGRAM_ID = resolveConfiguredProgramId(
  CONFIG.fightOracleProgramId,
  fightOracleIdl,
  "",
);
export const GOLD_CLOB_MARKET_PROGRAM_ID = resolveConfiguredProgramId(
  CONFIG.goldClobMarketProgramId,
  goldClobMarketIdl,
  "",
);
export const GOLD_PERPS_MARKET_PROGRAM_ID = resolveConfiguredProgramId(
  CONFIG.goldPerpsMarketProgramId,
  goldPerpsMarketIdl,
  "",
);

const FIGHT_ORACLE_IDL = ensureIdlAddress(
  fightOracleIdl,
  FIGHT_ORACLE_PROGRAM_ID,
);
const GOLD_CLOB_MARKET_IDL = ensureIdlAddress(
  goldClobMarketIdl,
  GOLD_CLOB_MARKET_PROGRAM_ID,
);
const GOLD_PERPS_MARKET_IDL = ensureIdlAddress(
  goldPerpsMarketIdl,
  GOLD_PERPS_MARKET_PROGRAM_ID,
);

export type ProgramsBundle = {
  provider: AnchorProvider;
  fightOracle: Program<Idl>;
  goldClobMarket: Program<Idl>;
};

interface AnchorCompatibleWallet {
  payer: Wallet["payer"];
  publicKey: PublicKey;
  signTransaction: <T extends Transaction | VersionedTransaction>(
    tx: T,
  ) => Promise<T>;
  signAllTransactions: <T extends Array<Transaction | VersionedTransaction>>(
    txs: T,
  ) => Promise<T>;
}

function asAnchorWallet(wallet: WalletContextState): AnchorCompatibleWallet {
  if (
    !wallet.publicKey ||
    !wallet.signTransaction ||
    !wallet.signAllTransactions
  ) {
    throw new Error("Wallet does not support required signing methods");
  }

  const { publicKey, signTransaction, signAllTransactions } = wallet;
  return {
    payer: undefined as unknown as Wallet["payer"],
    publicKey,
    signTransaction: async <T extends Transaction | VersionedTransaction>(
      tx: T,
    ): Promise<T> => {
      return (await signTransaction(tx)) as T;
    },
    signAllTransactions: async <
      T extends Array<Transaction | VersionedTransaction>,
    >(
      txs: T,
    ): Promise<T> => {
      return (await signAllTransactions(txs)) as T;
    },
  };
}

function readonlyAnchorWallet(): AnchorCompatibleWallet {
  const readonlyPk = new PublicKey("11111111111111111111111111111111");
  return {
    payer: undefined as unknown as Wallet["payer"],
    publicKey: readonlyPk,
    signTransaction: async <T extends Transaction | VersionedTransaction>(
      tx: T,
    ): Promise<T> => tx,
    signAllTransactions: async <
      T extends Array<Transaction | VersionedTransaction>,
    >(
      txs: T,
    ): Promise<T> => txs,
  };
}

export function createAnchorWallet(
  wallet: WalletContextState,
): AnchorCompatibleWallet {
  return asAnchorWallet(wallet);
}

export function createReadonlyAnchorWallet(): AnchorCompatibleWallet {
  return readonlyAnchorWallet();
}

export function createGoldPerpsProgram(
  connection: Connection,
  wallet: WalletContextState,
): Program<Idl> {
  const provider = new AnchorProvider(connection, createAnchorWallet(wallet), {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });
  return new Program(GOLD_PERPS_MARKET_IDL, provider);
}

export function createPrograms(
  connection: Connection,
  wallet: WalletContextState,
): ProgramsBundle {
  const anchorWallet = asAnchorWallet(wallet);
  const provider = new AnchorProvider(connection, anchorWallet, {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });

  const fightOracle = new Program(FIGHT_ORACLE_IDL, provider);
  const goldClobMarket = new Program(GOLD_CLOB_MARKET_IDL, provider);

  return { provider, fightOracle, goldClobMarket };
}

export function createReadonlyPrograms(connection: Connection): ProgramsBundle {
  const provider = new AnchorProvider(connection, readonlyAnchorWallet(), {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });

  const fightOracle = new Program(FIGHT_ORACLE_IDL, provider);
  const goldClobMarket = new Program(GOLD_CLOB_MARKET_IDL, provider);

  return { provider, fightOracle, goldClobMarket };
}

export function toBnAmount(amount: bigint): BN {
  return new BN(amount.toString());
}

export function marketSideAEnum(): { a: Record<string, never> } {
  return { a: {} };
}

export function marketSideBEnum(): { b: Record<string, never> } {
  return { b: {} };
}

export function duelStatusBettingOpenEnum(): {
  bettingOpen: Record<string, never>;
} {
  return { bettingOpen: {} };
}

export function duelStatusLockedEnum(): { locked: Record<string, never> } {
  return { locked: {} };
}

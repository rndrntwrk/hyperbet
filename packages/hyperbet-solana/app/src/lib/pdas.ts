import { PublicKey } from "@solana/web3.js";
import { findProgramAddressSync } from "./programAddress";

export const DUEL_WINNER_MARKET_KIND = 1;

export function findOracleConfigPda(
  fightOracleProgramId: PublicKey,
): PublicKey {
  return findProgramAddressSync(
    [Buffer.from("oracle_config")],
    fightOracleProgramId,
  )[0];
}

export function findDuelStatePda(
  fightOracleProgramId: PublicKey,
  duelKey: Uint8Array,
): PublicKey {
  return findProgramAddressSync(
    [Buffer.from("duel"), duelKey],
    fightOracleProgramId,
  )[0];
}

export function findMarketConfigPda(marketProgramId: PublicKey): PublicKey {
  return findProgramAddressSync([Buffer.from("config")], marketProgramId)[0];
}

export function findMarketStatePda(
  marketProgramId: PublicKey,
  duelState: PublicKey,
  marketKind = DUEL_WINNER_MARKET_KIND,
): PublicKey {
  return findProgramAddressSync(
    [Buffer.from("market"), duelState.toBuffer(), Uint8Array.of(marketKind)],
    marketProgramId,
  )[0];
}

export function findClobVaultPda(
  marketProgramId: PublicKey,
  marketState: PublicKey,
): PublicKey {
  return findProgramAddressSync(
    [Buffer.from("vault"), marketState.toBuffer()],
    marketProgramId,
  )[0];
}

export function findUserBalancePda(
  marketProgramId: PublicKey,
  marketState: PublicKey,
  user: PublicKey,
): PublicKey {
  return findProgramAddressSync(
    [Buffer.from("balance"), marketState.toBuffer(), user.toBuffer()],
    marketProgramId,
  )[0];
}

export function findOrderPda(
  marketProgramId: PublicKey,
  marketState: PublicKey,
  orderId: bigint,
): PublicKey {
  const orderIdBytes = Buffer.alloc(8);
  orderIdBytes.writeBigUInt64LE(orderId);
  return findProgramAddressSync(
    [Buffer.from("order"), marketState.toBuffer(), orderIdBytes],
    marketProgramId,
  )[0];
}

export function findPriceLevelPda(
  marketProgramId: PublicKey,
  marketState: PublicKey,
  side: number,
  price: number,
): PublicKey {
  const priceBytes = Buffer.alloc(2);
  priceBytes.writeUInt16LE(price);
  return findProgramAddressSync(
    [
      Buffer.from("level"),
      marketState.toBuffer(),
      Uint8Array.of(side),
      priceBytes,
    ],
    marketProgramId,
  )[0];
}

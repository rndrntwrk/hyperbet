export type OrderSide = "buy" | "sell";

export interface CreateOrderParams {
  duelId: string;
  side: OrderSide;
  price: number;
  amount: bigint;
}

export interface CancelOrderParams {
  duelId: string;
  orderId: number;
}

export interface ClaimParams {
  duelId: string;
}

export interface SdkConfig {
  evmPrivateKey?: string;
  bscNetwork?: "bscTestnet" | "bsc";
  bscRpcUrl?: string; // Fallback to public node if missing
  avaxNetwork?: "avaxFuji" | "avax";
  avaxRpcUrl?: string; // Fallback to public node if missing
  solanaPrivateKey?: string; // Base58 encoded secret key
  solanaRpcUrl?: string; // Fallback to mainnet-beta if missing
  streamUrl?: string;
}

export const SIDE_BID = 1;
export const SIDE_ASK = 2;
export const MARKET_KIND_DUEL_WINNER = 0;

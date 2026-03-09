import type { Address, Hash, Hex } from "viem";
import type { EvmChainConfig } from "../../src/lib/chainConfig";

export type MarketStatus = "NULL" | "OPEN" | "LOCKED" | "RESOLVED" | "CANCELLED";
export type Side = "NONE" | "A" | "B";

export type MarketMeta = {
  exists: boolean;
  duelKey: Hex;
  marketKind: number;
  status: MarketStatus;
  winner: Side;
  nextOrderId: bigint;
  bestBid: number;
  bestAsk: number;
  totalAShares: bigint;
  totalBShares: bigint;
  marketKey: Hex;
};

export type Position = {
  aShares: bigint;
  bShares: bigint;
  aStake: bigint;
  bStake: bigint;
};

export const SIDE_ENUM = {
  NONE: 0,
  A: 1,
  B: 2,
  BUY: 1,
  SELL: 2,
} as const;

const MARKET_META: MarketMeta = {
  exists: true,
  duelKey:
    "0x1f1e1d1c1b1a19181716151413121110f1e2d3c4b5a697887766554433221100",
  marketKind: 0,
  status: "OPEN",
  winner: "NONE",
  nextOrderId: 19n,
  bestBid: 482,
  bestAsk: 518,
  totalAShares: 14_500_000_000_000_000_000n,
  totalBShares: 11_200_000_000_000_000_000n,
  marketKey:
    "0xa11ce00000000000000000000000000000000000000000000000000000000001",
};

export function toDuelKeyHex(duelKeyHex: string): Hex {
  return `0x${duelKeyHex}` as Hex;
}

export function createEvmPublicClient(_chainConfig: EvmChainConfig) {
  return {
    waitForTransactionReceipt: async () => ({ status: "success" }),
  };
}

export function createUnlockedRpcWalletClient(
  _chainConfig: EvmChainConfig,
  _account: Address,
) {
  return {
    chain: _chainConfig.wagmiChain,
    writeContract: async () =>
      "0xa11ce0000000000000000000000000000000000000000000000000000000000e" as Hash,
  };
}

export async function getMarketMeta() {
  return MARKET_META;
}

export async function getFeeBps() {
  return 150;
}

export async function getOrderBook() {
  return {
    bids: [
      { price: 0.482, amount: 2_200_000_000_000_000_000n, total: 2_200_000_000_000_000_000n },
      { price: 0.476, amount: 1_600_000_000_000_000_000n, total: 3_800_000_000_000_000_000n },
    ],
    asks: [
      { price: 0.518, amount: 1_400_000_000_000_000_000n, total: 1_400_000_000_000_000_000n },
      { price: 0.524, amount: 1_100_000_000_000_000_000n, total: 2_500_000_000_000_000_000n },
    ],
  };
}

export async function getRecentTrades() {
  const now = Date.now();
  return [
    { id: "evm-trade-1", side: "YES" as const, amount: 1_500_000_000_000_000_000n, price: 0.49, time: now - 45_000 },
    { id: "evm-trade-2", side: "NO" as const, amount: 900_000_000_000_000_000n, price: 0.51, time: now - 80_000 },
  ];
}

export async function getRecentOrders() {
  return [
    {
      orderId: 18n,
      maker: "0x1234567890abcdef1234567890abcdef12345678",
    },
  ];
}

export async function getPosition() {
  return {
    aShares: 3_200_000_000_000_000_000n,
    bShares: 1_100_000_000_000_000_000n,
    aStake: 2_100_000_000_000_000_000n,
    bStake: 700_000_000_000_000_000n,
  } satisfies Position;
}

export async function getNativeBalance() {
  return 8_240_000_000_000_000_000n;
}

export async function getOrder() {
  return {
    active: true,
    amount: 1_500_000_000_000_000_000n,
    filled: 0n,
  };
}

export async function syncMarketFromOracle(): Promise<Hash> {
  return "0xa11ce0000000000000000000000000000000000000000000000000000000000a" as Hash;
}

export async function placeOrder(): Promise<Hash> {
  return "0xa11ce0000000000000000000000000000000000000000000000000000000000b" as Hash;
}

export async function cancelOrder(): Promise<Hash> {
  return "0xa11ce0000000000000000000000000000000000000000000000000000000000c" as Hash;
}

export async function claimWinnings(): Promise<Hash> {
  return "0xa11ce0000000000000000000000000000000000000000000000000000000000d" as Hash;
}

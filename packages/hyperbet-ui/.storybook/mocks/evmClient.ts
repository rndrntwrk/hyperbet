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

export function toPerpAgentKey(characterId: string): Hex {
  return `0x${characterId.padEnd(64, "0").slice(0, 64)}` as Hex;
}

export function createEvmPublicClient(_chainConfig: EvmChainConfig) {
  return {
    readContract: async () => null,
    getBalance: async () => 8_240_000_000_000_000_000n,
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

export async function getPerpMarketConfig() {
  return {
    exists: true,
    status: 1,
    maxLeverageBps: 50_000n,
    maintenanceMarginBps: 1_000n,
    liquidationFeeBps: 50n,
    maxPositionSize: 50_000_000_000_000_000_000n,
    oracleMaxAge: 120_000n,
    skewScale: 10_000_000_000_000_000_000n,
  };
}

export async function getPerpMarketState() {
  return {
    indexPrice: 18_000_000_000_000_000_000n,
    lastOraclePrice: 18_000_000_000_000_000_000n,
    lastOracleTimestamp: BigInt(Math.floor(Date.now() / 1000)),
    totalLongSize: 8_000_000_000_000_000_000n,
    totalShortSize: 5_000_000_000_000_000_000n,
    cumulativeFundingRate: 100_000_000_000_000n,
    insuranceFund: 3_200_000_000_000_000_000n,
    vaultBalance: 15_000_000_000_000_000_000n,
    badDebt: 0n,
  };
}

export async function getPerpPosition() {
  return {
    size: 2_000_000_000_000_000_000n,
    margin: 1_100_000_000_000_000_000n,
    entryPrice: 17_500_000_000_000_000_000n,
    lastCumulativeFundingRate: 0n,
  };
}

export async function getPerpPositionHealth() {
  return {
    isOpen: true,
    notional: 2_050_000_000_000_000_000n,
    unrealizedPnl: 120_000_000_000_000_000n,
    accruedFunding: 5_000_000_000_000_000n,
    equity: 1_215_000_000_000_000_000n,
    maintenanceMargin: 205_000_000_000_000_000n,
    marginRatioBps: 5_926n,
    liquidationPrice: 14_200_000_000_000_000_000n,
  };
}

export async function ensureErc20Approval(): Promise<Hash | null> {
  return null;
}

export async function modifyPerpPosition(): Promise<Hash> {
  return "0xa11ce0000000000000000000000000000000000000000000000000000000000f" as Hash;
}

export function formatToken18(value: bigint): number {
  return Number(value) / 1e18;
}

export function parseToken18(value: string | number): bigint {
  return BigInt(Math.round(Number(value) * 1e18));
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

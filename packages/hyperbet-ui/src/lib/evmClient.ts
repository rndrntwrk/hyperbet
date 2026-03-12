import {
  createPublicClient,
  createWalletClient,
  custom,
  encodeFunctionData,
  formatUnits,
  http,
  maxUint256,
  parseUnits,
  parseAbiItem,
  toHex,
  stringToHex,
  type Address,
  type Hash,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";

import type { EvmChainConfig } from "./chainConfig";
import { GOLD_CLOB_ABI } from "./goldClobAbi";

type BrowserEthereumWindow = Window &
  typeof globalThis & {
    ethereum?: Parameters<typeof custom>[0];
  };

export type MarketStatus =
  | "NULL"
  | "OPEN"
  | "LOCKED"
  | "RESOLVED"
  | "CANCELLED";
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

export type OrderInfo = {
  id: bigint;
  side: number;
  price: number;
  maker: Address;
  amount: bigint;
  filled: bigint;
  prevOrderId: bigint;
  nextOrderId: bigint;
  active: boolean;
};

export type ContractWriteClient = {
  chain: WalletClient["chain"];
  writeContract: WalletClient["writeContract"];
};

export type PerpMarketConfig = {
  skewScale: bigint;
  maxLeverage: bigint;
  maintenanceMarginBps: bigint;
  liquidationRewardBps: bigint;
  maxOracleDelay: bigint;
  exists: boolean;
};

export type PerpMarketState = {
  totalLongOI: bigint;
  totalShortOI: bigint;
  currentFundingRate: bigint;
  cumulativeFundingRate: bigint;
  lastFundingTimestamp: bigint;
  lastOraclePrice: bigint;
  lastConservativeSkill: bigint;
  lastOracleTimestamp: bigint;
  vaultBalance: bigint;
  insuranceFund: bigint;
  badDebt: bigint;
  status: number;
};

export type PerpPosition = {
  size: bigint;
  margin: bigint;
  entryPrice: bigint;
  lastCumulativeFundingRate: bigint;
};

export type PerpPositionHealth = {
  markPrice: bigint;
  notional: bigint;
  unrealizedPnl: bigint;
  equity: bigint;
  maintenanceMargin: bigint;
  liquidatable: boolean;
};

export const SIDE_ENUM = {
  NONE: 0,
  A: 1,
  B: 2,
  BUY: 1,
  SELL: 2,
} as const;

const MARKET_STATUS_MAP: Record<number, MarketStatus> = {
  0: "NULL",
  1: "OPEN",
  2: "LOCKED",
  3: "RESOLVED",
  4: "CANCELLED",
};

const SIDE_MAP: Record<number, Side> = {
  0: "NONE",
  1: "A",
  2: "B",
};

const AGENT_PERP_ENGINE_ABI = [
  {
    type: "function",
    name: "marketConfigs",
    stateMutability: "view",
    inputs: [{ type: "bytes32" }],
    outputs: [
      {
        components: [
          { name: "skewScale", type: "uint256" },
          { name: "maxLeverage", type: "uint256" },
          { name: "maintenanceMarginBps", type: "uint256" },
          { name: "liquidationRewardBps", type: "uint256" },
          { name: "maxOracleDelay", type: "uint256" },
          { name: "exists", type: "bool" },
        ],
        type: "tuple",
      },
    ],
  },
  {
    type: "function",
    name: "markets",
    stateMutability: "view",
    inputs: [{ type: "bytes32" }],
    outputs: [
      {
        components: [
          { name: "totalLongOI", type: "uint256" },
          { name: "totalShortOI", type: "uint256" },
          { name: "currentFundingRate", type: "int256" },
          { name: "cumulativeFundingRate", type: "int256" },
          { name: "lastFundingTimestamp", type: "uint256" },
          { name: "lastOraclePrice", type: "uint256" },
          { name: "lastConservativeSkill", type: "int256" },
          { name: "lastOracleTimestamp", type: "uint256" },
          { name: "vaultBalance", type: "uint256" },
          { name: "insuranceFund", type: "uint256" },
          { name: "badDebt", type: "uint256" },
          { name: "status", type: "uint8" },
        ],
        type: "tuple",
      },
    ],
  },
  {
    type: "function",
    name: "positions",
    stateMutability: "view",
    inputs: [{ type: "bytes32" }, { type: "address" }],
    outputs: [
      {
        components: [
          { name: "size", type: "int256" },
          { name: "margin", type: "uint256" },
          { name: "entryPrice", type: "uint256" },
          { name: "lastCumulativeFundingRate", type: "int256" },
        ],
        type: "tuple",
      },
    ],
  },
  {
    type: "function",
    name: "getPositionHealth",
    stateMutability: "view",
    inputs: [{ type: "bytes32" }, { type: "address" }],
    outputs: [
      {
        components: [
          { name: "markPrice", type: "uint256" },
          { name: "notional", type: "uint256" },
          { name: "unrealizedPnl", type: "int256" },
          { name: "equity", type: "int256" },
          { name: "maintenanceMargin", type: "uint256" },
          { name: "liquidatable", type: "bool" },
        ],
        type: "tuple",
      },
    ],
  },
  {
    type: "function",
    name: "modifyPosition",
    stateMutability: "nonpayable",
    inputs: [
      { type: "bytes32" },
      { type: "int256" },
      { type: "int256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "withdrawMargin",
    stateMutability: "nonpayable",
    inputs: [{ type: "bytes32" }, { type: "uint256" }],
    outputs: [],
  },
] as const;

const ERC20_ABI = [
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [{ type: "address" }, { type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [{ type: "address" }, { type: "uint256" }],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

export function toDuelKeyHex(duelKeyHex: string): Hex {
  const normalized = duelKeyHex.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalized)) {
    throw new Error("duelKeyHex must be a 32-byte hex string");
  }
  return `0x${normalized}`;
}

export function toPerpAgentKey(characterId: string): Hex {
  const trimmed = characterId.trim();
  if (!trimmed) {
    throw new Error("characterId is required");
  }
  return stringToHex(trimmed, { size: 32 }) as Hex;
}

export function createEvmPublicClient(
  chainConfig: EvmChainConfig,
): PublicClient {
  return createPublicClient({
    chain: chainConfig.wagmiChain,
    transport: http(chainConfig.rpcUrl),
  });
}

export function createEvmWalletClient(
  chainConfig: EvmChainConfig,
): WalletClient | null {
  if (typeof window === "undefined") {
    return null;
  }

  const browserWindow = window as BrowserEthereumWindow;
  if (!browserWindow.ethereum) {
    return null;
  }

  return createWalletClient({
    chain: chainConfig.wagmiChain,
    transport: custom(browserWindow.ethereum),
  });
}

export function createUnlockedRpcWalletClient(
  chainConfig: EvmChainConfig,
  account: Address,
): ContractWriteClient {
  return {
    chain: chainConfig.wagmiChain,
    async writeContract(parameters) {
      const { address, abi, functionName, args, value } = parameters;
      const data = (encodeFunctionData as (parameters: unknown) => Hex)({
        abi,
        functionName,
        args: args ?? [],
      });
      const response = await fetch(chainConfig.rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: Date.now(),
          method: "eth_sendTransaction",
          params: [
            {
              from: account,
              to: address,
              data,
              ...(value !== undefined ? { value: toHex(value) } : {}),
            },
          ],
        }),
      });
      const payload = (await response.json()) as {
        result?: Hash;
        error?: { message?: string };
      };
      if (!response.ok || !payload.result) {
        throw new Error(payload.error?.message || "eth_sendTransaction failed");
      }
      return payload.result;
    },
  };
}

export async function marketKeyForDuel(
  client: PublicClient,
  contractAddress: Address,
  duelKey: Hex,
  marketKind: number,
): Promise<Hex> {
  return client.readContract({
    address: contractAddress,
    abi: GOLD_CLOB_ABI,
    functionName: "marketKey",
    args: [duelKey, marketKind],
  }) as Promise<Hex>;
}

export async function getMarketMeta(
  client: PublicClient,
  contractAddress: Address,
  duelKey: Hex,
  marketKind: number,
): Promise<MarketMeta> {
  const [resolvedMarketKey, rawResult] = await Promise.all([
    marketKeyForDuel(client, contractAddress, duelKey, marketKind),
    client.readContract({
      address: contractAddress,
      abi: GOLD_CLOB_ABI,
      functionName: "getMarket",
      args: [duelKey, marketKind],
    }),
  ]);

  const result = rawResult as {
    exists: boolean;
    duelKey: Hex;
    marketKind: number;
    status: number;
    winner: number;
    nextOrderId: bigint;
    bestBid: number;
    bestAsk: number;
    totalAShares: bigint;
    totalBShares: bigint;
  };

  return {
    exists: result.exists,
    duelKey: result.duelKey,
    marketKind: Number(result.marketKind),
    status: MARKET_STATUS_MAP[Number(result.status)] ?? "NULL",
    winner: SIDE_MAP[Number(result.winner)] ?? "NONE",
    nextOrderId: result.nextOrderId,
    bestBid: Number(result.bestBid),
    bestAsk: Number(result.bestAsk),
    totalAShares: result.totalAShares,
    totalBShares: result.totalBShares,
    marketKey: resolvedMarketKey,
  };
}

export async function getPosition(
  client: PublicClient,
  contractAddress: Address,
  marketKey: Hex,
  userAddress: Address,
): Promise<Position> {
  const result = (await client.readContract({
    address: contractAddress,
    abi: GOLD_CLOB_ABI,
    functionName: "positions",
    args: [marketKey, userAddress],
  })) as [bigint, bigint, bigint, bigint];

  return {
    aShares: result[0],
    bShares: result[1],
    aStake: result[2],
    bStake: result[3],
  };
}

export async function getOrder(
  client: PublicClient,
  contractAddress: Address,
  marketKey: Hex,
  orderId: bigint,
): Promise<OrderInfo> {
  const result = (await client.readContract({
    address: contractAddress,
    abi: GOLD_CLOB_ABI,
    functionName: "orders",
    args: [marketKey, orderId],
  })) as [
    bigint,
    number,
    number,
    Address,
    bigint,
    bigint,
    bigint,
    bigint,
    boolean,
  ];

  return {
    id: result[0],
    side: Number(result[1]),
    price: Number(result[2]),
    maker: result[3],
    amount: result[4],
    filled: result[5],
    prevOrderId: result[6],
    nextOrderId: result[7],
    active: result[8],
  };
}

export async function getOrderBook(
  client: PublicClient,
  contractAddress: Address,
  duelKey: Hex,
  marketKind: number,
  market: MarketMeta,
) {
  const bids: Array<{ price: number; amount: bigint; total: bigint }> = [];
  const asks: Array<{ price: number; amount: bigint; total: bigint }> = [];

  let runningBid = 0n;
  for (let price = market.bestBid; price > 0 && bids.length < 10; price -= 1) {
    const level = (await client.readContract({
      address: contractAddress,
      abi: GOLD_CLOB_ABI,
      functionName: "getPriceLevel",
      args: [duelKey, marketKind, SIDE_ENUM.BUY, price],
    })) as [bigint, bigint, bigint];
    if (level[2] <= 0n) continue;
    runningBid += level[2];
    bids.push({ price: price / 1000, amount: level[2], total: runningBid });
  }

  let runningAsk = 0n;
  for (
    let price = market.bestAsk;
    price < 1000 && asks.length < 10;
    price += 1
  ) {
    const level = (await client.readContract({
      address: contractAddress,
      abi: GOLD_CLOB_ABI,
      functionName: "getPriceLevel",
      args: [duelKey, marketKind, SIDE_ENUM.SELL, price],
    })) as [bigint, bigint, bigint];
    if (level[2] <= 0n) continue;
    runningAsk += level[2];
    asks.push({ price: price / 1000, amount: level[2], total: runningAsk });
  }

  return { bids, asks };
}

export async function getFeeBps(
  client: PublicClient,
  contractAddress: Address,
): Promise<number> {
  const [treasuryFee, marketMakerFee] = (await Promise.all([
    client.readContract({
      address: contractAddress,
      abi: GOLD_CLOB_ABI,
      functionName: "tradeTreasuryFeeBps",
    }),
    client.readContract({
      address: contractAddress,
      abi: GOLD_CLOB_ABI,
      functionName: "tradeMarketMakerFeeBps",
    }),
  ])) as [bigint, bigint];

  return Number(treasuryFee + marketMakerFee);
}

export async function getPerpMarketConfig(
  client: PublicClient,
  contractAddress: Address,
  agentKey: Hex,
): Promise<PerpMarketConfig> {
  return (await client.readContract({
    address: contractAddress,
    abi: AGENT_PERP_ENGINE_ABI,
    functionName: "marketConfigs",
    args: [agentKey],
  })) as PerpMarketConfig;
}

export async function getPerpMarketState(
  client: PublicClient,
  contractAddress: Address,
  agentKey: Hex,
): Promise<PerpMarketState> {
  return (await client.readContract({
    address: contractAddress,
    abi: AGENT_PERP_ENGINE_ABI,
    functionName: "markets",
    args: [agentKey],
  })) as PerpMarketState;
}

export async function getPerpPosition(
  client: PublicClient,
  contractAddress: Address,
  agentKey: Hex,
  trader: Address,
): Promise<PerpPosition> {
  return (await client.readContract({
    address: contractAddress,
    abi: AGENT_PERP_ENGINE_ABI,
    functionName: "positions",
    args: [agentKey, trader],
  })) as PerpPosition;
}

export async function getPerpPositionHealth(
  client: PublicClient,
  contractAddress: Address,
  agentKey: Hex,
  trader: Address,
): Promise<PerpPositionHealth> {
  return (await client.readContract({
    address: contractAddress,
    abi: AGENT_PERP_ENGINE_ABI,
    functionName: "getPositionHealth",
    args: [agentKey, trader],
  })) as PerpPositionHealth;
}

export async function getErc20Allowance(
  client: PublicClient,
  tokenAddress: Address,
  owner: Address,
  spender: Address,
): Promise<bigint> {
  return (await client.readContract({
    address: tokenAddress,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: [owner, spender],
  })) as bigint;
}

export async function getErc20Balance(
  client: PublicClient,
  tokenAddress: Address,
  owner: Address,
): Promise<bigint> {
  return (await client.readContract({
    address: tokenAddress,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [owner],
  })) as bigint;
}

export async function ensureErc20Approval(
  publicClient: PublicClient,
  walletClient: WalletClient,
  tokenAddress: Address,
  owner: Address,
  spender: Address,
  minimumAmount: bigint,
): Promise<Hash | null> {
  const allowance = await getErc20Allowance(
    publicClient,
    tokenAddress,
    owner,
    spender,
  );
  if (allowance >= minimumAmount) {
    return null;
  }
  return walletClient.writeContract({
    chain: walletClient.chain,
    account: owner,
    address: tokenAddress,
    abi: ERC20_ABI,
    functionName: "approve",
    args: [spender, maxUint256],
  });
}

export async function modifyPerpPosition(
  walletClient: WalletClient,
  contractAddress: Address,
  owner: Address,
  agentKey: Hex,
  marginDelta: bigint,
  sizeDelta: bigint,
): Promise<Hash> {
  return walletClient.writeContract({
    chain: walletClient.chain,
    account: owner,
    address: contractAddress,
    abi: AGENT_PERP_ENGINE_ABI,
    functionName: "modifyPosition",
    args: [agentKey, marginDelta, sizeDelta],
  });
}

export async function withdrawPerpMargin(
  walletClient: WalletClient,
  contractAddress: Address,
  owner: Address,
  agentKey: Hex,
  amount: bigint,
): Promise<Hash> {
  return walletClient.writeContract({
    chain: walletClient.chain,
    account: owner,
    address: contractAddress,
    abi: AGENT_PERP_ENGINE_ABI,
    functionName: "withdrawMargin",
    args: [agentKey, amount],
  });
}

export function formatToken18(value: bigint): number {
  return Number(formatUnits(value, 18));
}

export function parseToken18(value: string | number): bigint {
  return parseUnits(String(value), 18);
}

export async function getNativeBalance(
  client: PublicClient,
  userAddress: Address,
): Promise<bigint> {
  return client.getBalance({ address: userAddress });
}

export async function getRecentTrades(
  client: PublicClient,
  contractAddress: Address,
  marketKey: Hex,
  blocksToSearch = 100n,
): Promise<
  {
    time: number;
    price: number;
    amount: bigint;
    side: "YES" | "NO";
    id: string;
  }[]
> {
  const currentBlock = await client.getBlockNumber();
  const fromBlock =
    currentBlock > blocksToSearch ? currentBlock - blocksToSearch : 0n;

  const logs = await client.getLogs({
    address: contractAddress,
    event: parseAbiItem(
      "event OrderMatched(bytes32 indexed marketKey, uint64 makerOrderId, uint64 takerOrderId, uint256 matchedAmount, uint16 price)",
    ),
    args: { marketKey },
    fromBlock,
    toBlock: "latest",
  });

  const blockCache = new Map<bigint, number>();
  const trades = await Promise.all(
    logs.map(async (log) => {
      let time = Date.now();
      if (log.blockNumber) {
        if (!blockCache.has(log.blockNumber)) {
          const block = await client.getBlock({ blockNumber: log.blockNumber });
          blockCache.set(log.blockNumber, Number(block.timestamp) * 1000);
        }
        time = blockCache.get(log.blockNumber)!;
      }

      return {
        id: `${log.transactionHash}-${log.logIndex}`,
        time,
        price: Number(log.args.price!) / 1000,
        amount: log.args.matchedAmount!,
        side: (Number(log.args.price!) >= 500 ? "YES" : "NO") as "YES" | "NO",
      };
    }),
  );

  return trades.reverse();
}

export async function getRecentOrders(
  client: PublicClient,
  contractAddress: Address,
  marketKey: Hex,
  blocksToSearch = 100n,
) {
  const currentBlock = await client.getBlockNumber();
  const fromBlock =
    currentBlock > blocksToSearch ? currentBlock - blocksToSearch : 0n;

  const logs = await client.getLogs({
    address: contractAddress,
    event: parseAbiItem(
      "event OrderPlaced(bytes32 indexed marketKey, uint64 indexed orderId, address indexed maker, uint8 side, uint16 price, uint256 amount)",
    ),
    args: { marketKey },
    fromBlock,
    toBlock: "latest",
  });

  return logs
    .map((log) => ({
      orderId: log.args.orderId!,
      maker: log.args.maker!,
      price: Number(log.args.price!) / 1000,
      amount: log.args.amount!,
      side: Number(log.args.side!),
    }))
    .reverse();
}

export async function placeOrder(
  walletClient: ContractWriteClient,
  contractAddress: Address,
  duelKey: Hex,
  marketKind: number,
  side: number,
  price: number,
  amount: bigint,
  account: Address,
  value: bigint,
): Promise<Hash> {
  return walletClient.writeContract({
    address: contractAddress,
    abi: GOLD_CLOB_ABI,
    functionName: "placeOrder",
    args: [duelKey, marketKind, side, price, amount],
    account,
    chain: walletClient.chain,
    value,
  });
}

export async function cancelOrder(
  walletClient: ContractWriteClient,
  contractAddress: Address,
  duelKey: Hex,
  marketKind: number,
  orderId: bigint,
  account: Address,
): Promise<Hash> {
  return walletClient.writeContract({
    address: contractAddress,
    abi: GOLD_CLOB_ABI,
    functionName: "cancelOrder",
    args: [duelKey, marketKind, orderId],
    account,
    chain: walletClient.chain,
  });
}

export async function claimWinnings(
  walletClient: ContractWriteClient,
  contractAddress: Address,
  duelKey: Hex,
  marketKind: number,
  account: Address,
): Promise<Hash> {
  return walletClient.writeContract({
    address: contractAddress,
    abi: GOLD_CLOB_ABI,
    functionName: "claim",
    args: [duelKey, marketKind],
    account,
    chain: walletClient.chain,
  });
}

export async function syncMarketFromOracle(
  walletClient: ContractWriteClient,
  contractAddress: Address,
  duelKey: Hex,
  marketKind: number,
  account: Address,
): Promise<Hash> {
  return walletClient.writeContract({
    address: contractAddress,
    abi: GOLD_CLOB_ABI,
    functionName: "syncMarketFromOracle",
    args: [duelKey, marketKind],
    account,
    chain: walletClient.chain,
  });
}

import {
  type CSSProperties,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { createWalletTransactionSigner, toAddress } from "@solana/client";
import { useSolanaClient } from "@solana/react-hooks";
import { getTransferSolInstruction } from "@solana-program/system";
import {
  type AccountMeta,
  type Connection,
  LAMPORTS_PER_SOL,
  PublicKey,
} from "@solana/web3.js";

import { useAppConnection, useAppWallet } from "../lib/appWallet";
import { findClobConfigPda, findClobVaultPda } from "../lib/clobPdas";
import { CONFIG, GAME_API_URL } from "../lib/config";
import { duelKeyHexToBytes, shortDuelKey } from "../lib/duelKey";
import {
  DUEL_WINNER_MARKET_KIND,
  findDuelStatePda,
  findMarketStatePda,
  findOrderPda,
  findPriceLevelPda,
  findUserBalancePda,
} from "../lib/pdas";
import {
  FIGHT_ORACLE_PROGRAM_ID,
  GOLD_CLOB_MARKET_PROGRAM_ID,
} from "../lib/programIds";
import {
  appendRemainingAccounts,
  sendKitInstructions,
  toKitRemainingAccounts,
} from "../lib/kitTransactions";
import { useStreamingState } from "../spectator/useStreamingState";
import { getDuelStateDecoder } from "../generated/fight-oracle/accounts";
import {
  getMarketConfigDecoder,
  getMarketStateDecoder,
  getOrderDecoder,
  getPriceLevelDecoder,
  getUserBalanceDecoder,
  type Order,
} from "../generated/gold-clob-market/accounts";
import { getCancelOrderInstruction } from "../generated/gold-clob-market/instructions/cancelOrder";
import { getClaimInstruction } from "../generated/gold-clob-market/instructions/claim";
import { getPlaceOrderInstruction } from "../generated/gold-clob-market/instructions/placeOrder";
import {
  GoldClobMarketAccount,
  identifyGoldClobMarketAccount,
} from "../generated/gold-clob-market/programs";
import {
  PredictionMarketPanel,
  type ChartDataPoint,
} from "./PredictionMarketPanel";
import { type OrderLevel } from "./OrderBook";
import { PointsDisplay } from "./PointsDisplay";
import { type Trade } from "./RecentTrades";

type BetSide = "YES" | "NO";
type ClobProgramId = PublicKey;
type DecodedProgramAccount<T> = { publicKey: PublicKey; account: T };

type UserPosition = {
  aShares: bigint;
  bShares: bigint;
};

type MarketSnapshot = {
  duelId: string;
  duelKeyHex: string;
  duelState: PublicKey;
  marketState: PublicKey;
  vault: PublicKey;
  marketStatus: string;
  winner: string | null;
  nextOrderId: bigint;
  bestBid: number;
  bestAsk: number;
  betCloseTime: number | null;
};

const SIDE_BID = 1;
const SIDE_ASK = 2;
const MAX_MATCH_ACCOUNTS = 100;
const duelStateDecoder = getDuelStateDecoder();
const clobMarketConfigDecoder = getMarketConfigDecoder();
const clobMarketStateDecoder = getMarketStateDecoder();
const clobOrderDecoder = getOrderDecoder();
const clobPriceLevelDecoder = getPriceLevelDecoder();
const clobUserBalanceDecoder = getUserBalanceDecoder();

async function fetchMaybeDecodedAccount<T>(
  connection: Connection,
  pubkey: PublicKey,
  decode: (data: Buffer) => T,
): Promise<T | null> {
  const account = await connection.getAccountInfo(pubkey, "confirmed");
  if (!account) return null;
  return decode(account.data);
}

async function fetchDecodedProgramAccounts<T>(
  connection: Connection,
  programId: PublicKey,
  identify: (data: Uint8Array) => number,
  expectedAccount: number,
  decode: (data: Buffer) => T,
): Promise<Array<DecodedProgramAccount<T>>> {
  const accounts = await connection.getProgramAccounts(programId, "confirmed");
  return accounts.flatMap(
    (
      entry: Awaited<ReturnType<Connection["getProgramAccounts"]>>[number],
    ) => {
    try {
      if (identify(entry.account.data) !== expectedAccount) {
        return [];
      }
      return [{ publicKey: entry.pubkey, account: decode(entry.account.data) }];
    } catch {
      return [];
    }
    },
  );
}

function walletReady(wallet: ReturnType<typeof useAppWallet>): boolean {
  return Boolean(
    wallet.publicKey &&
      wallet.session &&
      wallet.signTransaction &&
      wallet.signAllTransactions,
  );
}

function asBigInt(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(Math.trunc(value));
  if (value && typeof value === "object" && "toString" in value) {
    return BigInt((value as { toString: () => string }).toString());
  }
  return 0n;
}

function enumName(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const [key] = Object.keys(value as Record<string, unknown>);
  return key ?? null;
}

function formatStatus(status: string | null): string {
  if (!status) return "unknown";
  return status.replace(/[A-Z]/g, (match, index) =>
    index === 0 ? match.toUpperCase() : ` ${match.toLowerCase()}`,
  );
}

function toBaseUnits(amountInput: string): bigint {
  const value = Number(amountInput.trim());
  if (!Number.isFinite(value) || value <= 0) return 0n;
  return BigInt(Math.floor(value * LAMPORTS_PER_SOL));
}

function clampPrice(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 500;
  return Math.min(999, Math.max(1, Math.floor(parsed)));
}

function fmtAmount(value: bigint): number {
  return Number(value) / LAMPORTS_PER_SOL;
}

function sumOrderLevels(levels: OrderLevel[]): number {
  return levels.reduce((total, level) => total + level.amount, 0);
}

function getCycleDuelStatusLabel(
  phase: string | undefined,
  duelKeyHex: string | null | undefined,
): string {
  if (!duelKeyHex) {
    return "Waiting for live Hyperscape duel";
  }
  if (phase === "ANNOUNCEMENT") {
    return "Betting open";
  }
  if (phase === "COUNTDOWN" || phase === "FIGHTING") {
    return "Betting locked";
  }
  if (phase === "RESOLUTION") {
    return "Awaiting result settlement";
  }
  return "Preparing duel market";
}

interface SolanaClobPanelProps {
  agent1Name: string;
  agent2Name: string;
  compact?: boolean;
  onMarketSnapshot?: (snapshot: SolanaClobMarketSnapshot) => void;
}

export interface SolanaClobMarketSnapshot {
  matchLabel: string;
  marketStatus: string;
  yesPool: bigint;
  noPool: bigint;
  bids: OrderLevel[];
  asks: OrderLevel[];
  recentTrades: Trade[];
  chartData: ChartDataPoint[];
}

export function SolanaClobPanel({
  agent1Name,
  agent2Name,
  compact = false,
  onMarketSnapshot,
}: SolanaClobPanelProps) {
  const { connection } = useAppConnection();
  const client = useSolanaClient();
  const wallet = useAppWallet();
  const { state: streamingState } = useStreamingState();

  const [status, setStatus] = useState("Waiting for live Hyperscape duel");
  const [side, setSide] = useState<BetSide>("YES");
  const [amountInput, setAmountInput] = useState("1");
  const [priceInput] = useState("500");
  const [activeMarket, setActiveMarket] = useState<MarketSnapshot | null>(null);
  const [position, setPosition] = useState<UserPosition>({
    aShares: 0n,
    bShares: 0n,
  });
  const [yesPool, setYesPool] = useState<bigint>(0n);
  const [noPool, setNoPool] = useState<bigint>(0n);
  const [bids, setBids] = useState<OrderLevel[]>([]);
  const [asks, setAsks] = useState<OrderLevel[]>([]);
  const [recentTrades, setRecentTrades] = useState<Trade[]>([]);
  const [chartData, setChartData] = useState<ChartDataPoint[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastOrderId, setLastOrderId] = useState<bigint | null>(null);

  const lastSnapshotRef = useRef<{ yes: bigint; no: bigint }>({
    yes: 0n,
    no: 0n,
  });

  const oracleProgramId = FIGHT_ORACLE_PROGRAM_ID;
  const clobProgramId = GOLD_CLOB_MARKET_PROGRAM_ID;

  const cycle = streamingState?.cycle ?? null;
  const duelKeyHex =
    typeof cycle?.duelKeyHex === "string" ? cycle.duelKeyHex : null;
  const cycleDuelId = typeof cycle?.duelId === "string" ? cycle.duelId : null;
  const duelLabel = cycleDuelId ?? shortDuelKey(duelKeyHex);
  const effectiveAgent1 = cycle?.agent1?.name ?? agent1Name;
  const effectiveAgent2 = cycle?.agent2?.name ?? agent2Name;

  const updateChartAndTrades = useCallback((nextYes: bigint, nextNo: bigint) => {
    const now = Date.now();
    const prev = lastSnapshotRef.current;
    const yesDelta = nextYes - prev.yes;
    const noDelta = nextNo - prev.no;

    const total = nextYes + nextNo;
    const pct = total > 0n ? Number((nextYes * 100n) / total) : 50;

    setChartData((prevChart) => {
      if (prevChart.length === 0) {
        return [{ time: now, pct }];
      }
      if (yesDelta === 0n && noDelta === 0n) {
        return prevChart;
      }
      const next = [...prevChart, { time: now, pct }];
      return next.length > 100 ? next.slice(next.length - 100) : next;
    });

    if (yesDelta > 0n) {
      setRecentTrades((prevTrades) =>
        [
          {
            id: `sol-a-${now}`,
            side: "YES" as const,
            amount: fmtAmount(yesDelta),
            price: pct / 100,
            time: now,
          },
          ...prevTrades,
        ].slice(0, 50),
      );
    }
    if (noDelta > 0n) {
      setRecentTrades((prevTrades) =>
        [
          {
            id: `sol-b-${now}`,
            side: "NO" as const,
            amount: fmtAmount(noDelta),
            price: 1 - pct / 100,
            time: now + 1,
          },
          ...prevTrades,
        ].slice(0, 50),
      );
    }

    lastSnapshotRef.current = { yes: nextYes, no: nextNo };
  }, []);

  const submitInstructions = useCallback(
    async (
      instructions: Parameters<typeof sendKitInstructions>[2],
      accountKeys: readonly string[],
      context: string,
    ): Promise<string> => {
      if (!wallet.publicKey || !wallet.session) {
        throw new Error("Connect wallet first");
      }

      return sendKitInstructions(client, wallet.session, instructions, {
        accountKeys,
        context,
        gameApiUrl:
          CONFIG.cluster === "mainnet-beta" ? GAME_API_URL : undefined,
        useHeliusSender: CONFIG.cluster === "mainnet-beta",
      });
    },
    [client, wallet.publicKey, wallet.session],
  );

  const ensureVaultRentExempt = useCallback(
    async (vault: PublicKey): Promise<void> => {
      if (!wallet.publicKey || !wallet.session) {
        throw new Error("Connect wallet first");
      }
      const walletSigner = createWalletTransactionSigner(wallet.session).signer;

      const minimumLamports =
        await connection.getMinimumBalanceForRentExemption(0, "confirmed");
      const currentLamports = await connection.getBalance(vault, "confirmed");
      if (currentLamports >= minimumLamports) {
        return;
      }

      await submitInstructions(
        [
          getTransferSolInstruction({
            amount: BigInt(minimumLamports - currentLamports),
            destination: toAddress(vault.toBase58()),
            source: walletSigner,
          }),
        ],
        [wallet.publicKey.toBase58(), vault.toBase58()],
        "funding duel vault rent",
      );
    },
    [connection, submitInstructions, wallet.publicKey, wallet.session],
  );

  const refreshData = useCallback(async () => {
    const runtimeConfigPda = findClobConfigPda(clobProgramId);
    setIsRefreshing(true);

    try {
      const config = await fetchMaybeDecodedAccount(
        connection,
        runtimeConfigPda,
        (data) => clobMarketConfigDecoder.decode(data),
      );
      if (!config) {
        setStatus("Market config not deployed");
        setActiveMarket(null);
        return;
      }

      if (!duelKeyHex) {
        setActiveMarket(null);
        setBids([]);
        setAsks([]);
        setYesPool(0n);
        setNoPool(0n);
        setPosition({ aShares: 0n, bShares: 0n });
        setStatus(getCycleDuelStatusLabel(cycle?.phase, duelKeyHex));
        return;
      }

      const duelKeyBytes = duelKeyHexToBytes(duelKeyHex);
      const duelState = findDuelStatePda(oracleProgramId, duelKeyBytes);
      const marketState = findMarketStatePda(
        clobProgramId,
        duelState,
        DUEL_WINNER_MARKET_KIND,
      );
      const vault = findClobVaultPda(clobProgramId, marketState);

      const [duelAccount, marketAccount, allLevels, allOrders, allBalances] =
        await Promise.all([
          fetchMaybeDecodedAccount(connection, duelState, (data) =>
            duelStateDecoder.decode(data),
          ),
          fetchMaybeDecodedAccount(connection, marketState, (data) =>
            clobMarketStateDecoder.decode(data),
          ),
          fetchDecodedProgramAccounts(
            connection,
            clobProgramId,
            identifyGoldClobMarketAccount,
            GoldClobMarketAccount.PriceLevel,
            (data) => clobPriceLevelDecoder.decode(data),
          ),
          fetchDecodedProgramAccounts(
            connection,
            clobProgramId,
            identifyGoldClobMarketAccount,
            GoldClobMarketAccount.Order,
            (data) => clobOrderDecoder.decode(data),
          ),
          fetchDecodedProgramAccounts(
            connection,
            clobProgramId,
            identifyGoldClobMarketAccount,
            GoldClobMarketAccount.UserBalance,
            (data) => clobUserBalanceDecoder.decode(data),
          ),
        ]);

      if (!duelAccount) {
        setStatus("Game announced duel; waiting for oracle reporter");
        setActiveMarket(null);
        return;
      }

      if (!marketAccount) {
        setStatus("Oracle is live; waiting for market operator");
        setActiveMarket(null);
        return;
      }

      const marketStatus = enumName(marketAccount.status);
      const winner = enumName(marketAccount.winner);

      const marketStateAddress = marketState.toBase58();
      const walletAddress = wallet.publicKey?.toBase58() ?? null;
      const levels = allLevels.filter((entry) =>
        entry.account.marketState === marketStateAddress,
      );
      const orders = allOrders.filter((entry) =>
        entry.account.marketState === marketStateAddress,
      );
      const balances = allBalances.filter((entry) =>
        entry.account.marketState === marketStateAddress,
      );

      const bidRows = levels
        .filter(
          (entry) =>
            Number(entry.account.side) === SIDE_BID &&
            asBigInt(entry.account.totalOpen) > 0n,
        )
        .sort((a, b) => Number(b.account.price) - Number(a.account.price))
        .map((entry) => ({
          price: Number(entry.account.price) / 1000,
          amount: fmtAmount(asBigInt(entry.account.totalOpen)),
          total: 0,
        }));

      const askRows = levels
        .filter(
          (entry) =>
            Number(entry.account.side) === SIDE_ASK &&
            asBigInt(entry.account.totalOpen) > 0n,
        )
        .sort((a, b) => Number(a.account.price) - Number(b.account.price))
        .map((entry) => ({
          price: Number(entry.account.price) / 1000,
          amount: fmtAmount(asBigInt(entry.account.totalOpen)),
          total: 0,
        }));

      let bidTotal = 0;
      const normalizedBids = bidRows.slice(0, 12).map((row) => {
        bidTotal += row.amount;
        return { ...row, total: bidTotal };
      });
      let askTotal = 0;
      const normalizedAsks = askRows.slice(0, 12).map((row) => {
        askTotal += row.amount;
        return { ...row, total: askTotal };
      });

      let nextYesPool = 0n;
      let nextNoPool = 0n;
      let userPosition: UserPosition = { aShares: 0n, bShares: 0n };
      for (const balance of balances) {
        const aShares = asBigInt(balance.account.aShares);
        const bShares = asBigInt(balance.account.bShares);
        nextYesPool += aShares;
        nextNoPool += bShares;
        if (
          walletAddress &&
          balance.account.user === walletAddress
        ) {
          userPosition = { aShares, bShares };
        }
      }

      const userOpenOrders = orders
        .filter(
          (entry) =>
            walletAddress &&
            entry.account.maker === walletAddress &&
            entry.account.active &&
            asBigInt(entry.account.amount) > asBigInt(entry.account.filled),
        )
        .sort((a, b) =>
          Number(asBigInt(b.account.id) - asBigInt(a.account.id)),
        );

      setActiveMarket({
        duelId: cycleDuelId ?? shortDuelKey(duelKeyHex),
        duelKeyHex,
        duelState,
        marketState,
        vault,
        marketStatus: marketStatus ?? "unknown",
        winner,
        nextOrderId: asBigInt(marketAccount.nextOrderId),
        bestBid: Number(marketAccount.bestBid ?? 0),
        bestAsk: Number(marketAccount.bestAsk ?? 1000),
        betCloseTime:
          typeof cycle?.betCloseTime === "number" ? cycle.betCloseTime : null,
      });
      setPosition(userPosition);
      setYesPool(nextYesPool);
      setNoPool(nextNoPool);
      setBids(normalizedBids);
      setAsks(normalizedAsks);
      setLastOrderId(
        userOpenOrders.length > 0 ? asBigInt(userOpenOrders[0].account.id) : null,
      );
      updateChartAndTrades(nextYesPool, nextNoPool);

      if (marketStatus === "resolved") {
        setStatus(
          winner === "a"
            ? `Resolved for ${effectiveAgent1}`
            : winner === "b"
              ? `Resolved for ${effectiveAgent2}`
              : "Resolved",
        );
      } else if (marketStatus === "locked") {
        setStatus("Betting locked");
      } else if (marketStatus === "open") {
        setStatus("Market open");
      } else {
        setStatus(formatStatus(marketStatus));
      }
    } catch (error) {
      setStatus(`Refresh failed: ${(error as Error).message}`);
    } finally {
      setIsRefreshing(false);
    }
  }, [
    cycle?.betCloseTime,
    cycle?.phase,
    cycleDuelId,
    duelKeyHex,
    effectiveAgent1,
    effectiveAgent2,
    clobProgramId,
    connection,
    oracleProgramId,
    updateChartAndTrades,
    wallet.publicKey,
  ]);

  useEffect(() => {
    void refreshData();
    const id = window.setInterval(() => void refreshData(), 5000);
    return () => window.clearInterval(id);
  }, [refreshData]);

  const buildPlaceOrderRemainingAccounts = useCallback(
    async (
      clobProgramId: ClobProgramId,
      market: MarketSnapshot,
      sideValue: number,
      price: number,
      amount: bigint,
    ): Promise<AccountMeta[]> => {
      const metas: AccountMeta[] = [];
      const oppositeSide = sideValue === SIDE_BID ? SIDE_ASK : SIDE_BID;
      let remaining = amount;
      let matches = 0;
      const oppositeLevels = (await fetchDecodedProgramAccounts(
        connection,
        clobProgramId,
        identifyGoldClobMarketAccount,
        GoldClobMarketAccount.PriceLevel,
        (data) => clobPriceLevelDecoder.decode(data),
      ))
        .filter((entry) => {
          const sameMarket = entry.account.marketState === market.marketState.toBase58();
          const sameSide = Number(entry.account.side) === oppositeSide;
          const hasLiquidity = asBigInt(entry.account.totalOpen) > 0n;
          if (!sameMarket || !sameSide || !hasLiquidity) {
            return false;
          }
          const levelPrice = Number(entry.account.price);
          return sideValue === SIDE_BID ? levelPrice <= price : levelPrice >= price;
        })
        .sort((a, b) =>
          sideValue === SIDE_BID
            ? Number(a.account.price) - Number(b.account.price)
            : Number(b.account.price) - Number(a.account.price),
        );

      for (const level of oppositeLevels) {
        if (remaining <= 0n || matches >= MAX_MATCH_ACCOUNTS) {
          break;
        }

        metas.push({
          pubkey: level.publicKey,
          isSigner: false,
          isWritable: true,
        });

        let currentHead = asBigInt(level.account.headOrderId);
        let currentLevelOpen = asBigInt(level.account.totalOpen);
        while (remaining > 0n && currentHead > 0n && currentLevelOpen > 0n) {
          const orderPda = findOrderPda(clobProgramId, market.marketState, currentHead);
          const order = await fetchMaybeDecodedAccount(connection, orderPda, (data) =>
            clobOrderDecoder.decode(data),
          );
          if (!order) {
            break;
          }
          const makerBalancePda = findUserBalancePda(
            clobProgramId,
            market.marketState,
            new PublicKey(order.maker),
          );

          metas.push(
            {
              pubkey: orderPda,
              isSigner: false,
              isWritable: true,
            },
            {
              pubkey: makerBalancePda,
              isSigner: false,
              isWritable: true,
            },
          );

          const orderRemaining =
            asBigInt(order.amount) - asBigInt(order.filled);
          if (orderRemaining <= 0n || !order.active) {
            break;
          }

          if (orderRemaining >= remaining) {
            remaining = 0n;
            break;
          }

          remaining -= orderRemaining;
          currentLevelOpen -= orderRemaining;
          currentHead = asBigInt(order.nextOrderId);
          matches += 1;
          if (remaining > 0n && currentHead > 0n && currentLevelOpen > 0n) {
            metas.push({
              pubkey: level.publicKey,
              isSigner: false,
              isWritable: true,
            });
          }
        }
        matches += 1;
      }

      const restingLevelPda = findPriceLevelPda(
        clobProgramId,
        market.marketState,
        sideValue,
        price,
      );
      const restingLevel =
        await fetchMaybeDecodedAccount(connection, restingLevelPda, (data) =>
          clobPriceLevelDecoder.decode(data),
        );
      if (restingLevel && asBigInt(restingLevel.tailOrderId) > 0n) {
        metas.push({
          pubkey: findOrderPda(
            clobProgramId,
            market.marketState,
            asBigInt(restingLevel.tailOrderId),
          ),
          isSigner: false,
          isWritable: true,
        });
      }

      return metas;
    },
    [connection],
  );

  const buildCancelRemainingAccounts = useCallback(
    async (
      clobProgramId: ClobProgramId,
      marketState: PublicKey,
      orderId: bigint,
    ): Promise<{
      order: Order;
      orderPda: PublicKey;
      priceLevelPda: PublicKey;
      metas: AccountMeta[];
    }> => {
      const orderPda = findOrderPda(clobProgramId, marketState, orderId);
      const order = await fetchMaybeDecodedAccount(connection, orderPda, (data) =>
        clobOrderDecoder.decode(data),
      );
      if (!order) {
        throw new Error("Order not found");
      }
      const priceLevelPda = findPriceLevelPda(
        clobProgramId,
        marketState,
        Number(order.side),
        Number(order.price),
      );
      const metas: AccountMeta[] = [];

      const prevOrderId = asBigInt(order.prevOrderId);
      if (prevOrderId > 0n) {
        metas.push({
          pubkey: findOrderPda(clobProgramId, marketState, prevOrderId),
          isSigner: false,
          isWritable: true,
        });
      }

      const nextOrderId = asBigInt(order.nextOrderId);
      if (nextOrderId > 0n) {
        metas.push({
          pubkey: findOrderPda(clobProgramId, marketState, nextOrderId),
          isSigner: false,
          isWritable: true,
        });
      }

      return { order, orderPda, priceLevelPda, metas };
    },
    [connection],
  );

  const handlePlaceOrder = useCallback(async () => {
    if (!wallet.publicKey || !activeMarket) {
      setStatus("Connect wallet to trade");
      return;
    }

    try {
      const amount = toBaseUnits(amountInput);
      if (amount <= 0n) {
        setStatus("Amount must be greater than zero");
        return;
      }
      if (!wallet.session) {
        setStatus("Connect wallet to trade");
        return;
      }
      const walletSigner = createWalletTransactionSigner(wallet.session).signer;

      const latestMarketAccount = await fetchMaybeDecodedAccount(
        connection,
        activeMarket.marketState,
        (data) => clobMarketStateDecoder.decode(data),
      );
      if (!latestMarketAccount) {
        throw new Error("Market state not found");
      }

      const price = clampPrice(priceInput);
      const sideValue = side === "YES" ? SIDE_BID : SIDE_ASK;
      const orderId = asBigInt(latestMarketAccount.nextOrderId);
      const userBalance = findUserBalancePda(
        clobProgramId,
        activeMarket.marketState,
        wallet.publicKey,
      );
      const newOrder = findOrderPda(
        clobProgramId,
        activeMarket.marketState,
        orderId,
      );
      const restingLevel = findPriceLevelPda(
        clobProgramId,
        activeMarket.marketState,
        sideValue,
        price,
      );
      const remainingAccounts = await buildPlaceOrderRemainingAccounts(
        clobProgramId,
        activeMarket,
        sideValue,
        price,
        amount,
      );

      await ensureVaultRentExempt(activeMarket.vault);

      const configPda = findClobConfigPda(clobProgramId);
      const config = await fetchMaybeDecodedAccount(connection, configPda, (data) =>
        clobMarketConfigDecoder.decode(data),
      );
      if (!config) {
        throw new Error("Market config not found");
      }
      const instruction = appendRemainingAccounts(
        getPlaceOrderInstruction({
          amount,
          config: toAddress(configPda.toBase58()),
          duelState: toAddress(activeMarket.duelState.toBase58()),
          marketMaker: toAddress(config.marketMaker),
          marketState: toAddress(activeMarket.marketState.toBase58()),
          newOrder: toAddress(newOrder.toBase58()),
          orderId,
          price,
          restingLevel: toAddress(restingLevel.toBase58()),
          side: sideValue,
          treasury: toAddress(config.treasury),
          user: walletSigner,
          userBalance: toAddress(userBalance.toBase58()),
          vault: toAddress(activeMarket.vault.toBase58()),
        }),
        toKitRemainingAccounts(remainingAccounts),
      );

      await submitInstructions(
        [instruction],
        [
          wallet.publicKey.toBase58(),
          activeMarket.marketState.toBase58(),
          activeMarket.vault.toBase58(),
        ],
        "placing order",
      );
      setStatus("Order placed");
      await refreshData();
    } catch (error) {
      setStatus(`Order failed: ${(error as Error).message}`);
    }
  }, [
    activeMarket,
    amountInput,
    buildPlaceOrderRemainingAccounts,
    ensureVaultRentExempt,
    priceInput,
    refreshData,
    side,
    submitInstructions,
    clobProgramId,
    connection,
    wallet.publicKey,
    wallet.session,
  ]);

  const handleCancelLastOrder = useCallback(async () => {
    if (!wallet.publicKey || !activeMarket || !lastOrderId) {
      setStatus("No active order to cancel");
      return;
    }

    try {
      if (!wallet.session) {
        setStatus("Connect wallet to trade");
        return;
      }
      const walletSigner = createWalletTransactionSigner(wallet.session).signer;
      const { order, orderPda, priceLevelPda, metas } =
        await buildCancelRemainingAccounts(
          clobProgramId,
          activeMarket.marketState,
          lastOrderId,
        );

      const instruction = appendRemainingAccounts(
        getCancelOrderInstruction({
          duelState: toAddress(activeMarket.duelState.toBase58()),
          marketState: toAddress(activeMarket.marketState.toBase58()),
          order: toAddress(orderPda.toBase58()),
          orderId: lastOrderId,
          price: Number(order.price),
          priceLevel: toAddress(priceLevelPda.toBase58()),
          side: Number(order.side),
          user: walletSigner,
          vault: toAddress(activeMarket.vault.toBase58()),
        }),
        toKitRemainingAccounts(metas),
      );

      await submitInstructions(
        [instruction],
        [
          wallet.publicKey.toBase58(),
          activeMarket.marketState.toBase58(),
          orderPda.toBase58(),
        ],
        "cancelling order",
      );
      setStatus("Order cancelled");
      await refreshData();
    } catch (error) {
      setStatus(`Cancel failed: ${(error as Error).message}`);
    }
  }, [
    activeMarket,
    buildCancelRemainingAccounts,
    lastOrderId,
    refreshData,
    submitInstructions,
    clobProgramId,
    wallet.publicKey,
    wallet.session,
  ]);

  const handleClaim = useCallback(async () => {
    if (!wallet.publicKey || !activeMarket) {
      setStatus("Connect wallet to claim");
      return;
    }

    try {
      if (!wallet.session) {
        setStatus("Connect wallet to claim");
        return;
      }
      const walletSigner = createWalletTransactionSigner(wallet.session).signer;
      const userBalance = findUserBalancePda(
        clobProgramId,
        activeMarket.marketState,
        wallet.publicKey,
      );
      const configPda = findClobConfigPda(clobProgramId);
      const config = await fetchMaybeDecodedAccount(connection, configPda, (data) =>
        clobMarketConfigDecoder.decode(data),
      );
      if (!config) {
        throw new Error("Market config not found");
      }

      const instruction = getClaimInstruction({
        config: toAddress(configPda.toBase58()),
        duelState: toAddress(activeMarket.duelState.toBase58()),
        marketMaker: toAddress(config.marketMaker),
        marketState: toAddress(activeMarket.marketState.toBase58()),
        user: walletSigner,
        userBalance: toAddress(userBalance.toBase58()),
        vault: toAddress(activeMarket.vault.toBase58()),
      });

      await submitInstructions(
        [instruction],
        [
          wallet.publicKey.toBase58(),
          activeMarket.marketState.toBase58(),
          activeMarket.vault.toBase58(),
        ],
        "claiming winnings",
      );
      setStatus("Claim complete");
      await refreshData();
    } catch (error) {
      setStatus(`Claim failed: ${(error as Error).message}`);
    }
  }, [activeMarket, refreshData, submitInstructions, clobProgramId, connection, wallet.publicKey, wallet.session]);

  useEffect(() => {
    if (!onMarketSnapshot) {
      return;
    }

    onMarketSnapshot({
      matchLabel: duelLabel,
      marketStatus: activeMarket?.marketStatus ?? "unavailable",
      yesPool,
      noPool,
      bids,
      asks,
      recentTrades,
      chartData,
    });
  }, [
    activeMarket?.marketStatus,
    asks,
    bids,
    chartData,
    duelLabel,
    noPool,
    onMarketSnapshot,
    recentTrades,
    yesPool,
  ]);

  const walletAddress = wallet.publicKey?.toBase58() ?? null;
  const yesPercent =
    yesPool + noPool > 0n ? Number((yesPool * 100n) / (yesPool + noPool)) : 50;
  const noPercent = 100 - yesPercent;
  const resolvedWinner =
    activeMarket?.winner === "a"
      ? "YES"
      : activeMarket?.winner === "b"
        ? "NO"
        : null;

  return (
    <PredictionMarketPanel
      yesPercent={yesPercent}
      noPercent={noPercent}
      yesPool={`${fmtAmount(yesPool).toFixed(3)} SOL`}
      noPool={`${fmtAmount(noPool).toFixed(3)} SOL`}
      side={side}
      setSide={setSide}
      amountInput={amountInput}
      setAmountInput={setAmountInput}
      onPlaceBet={() => void handlePlaceOrder()}
      isWalletReady={walletReady(wallet)}
      programsReady={Boolean(activeMarket)}
      agent1Name={effectiveAgent1}
      agent2Name={effectiveAgent2}
      supportsSell
      chartData={chartData}
      bids={bids}
      asks={asks}
      recentTrades={recentTrades}
      currencySymbol="SOL"
      compact={compact}
      pointsDisplay={
        <PointsDisplay walletAddress={walletAddress} compact={compact} />
      }
    >
      <div
        style={{
          display: "grid",
          gap: 10,
          padding: compact ? "0 16px 14px" : "12px 0 0",
          color: "#d4d4d8",
          fontFamily: "'Inter', system-ui, sans-serif",
          fontSize: 12,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <span data-testid="solana-clob-status">{status}</span>
          <span>{isRefreshing ? "Refreshing..." : duelLabel}</span>
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: compact ? "1fr" : "repeat(3, minmax(0, 1fr))",
            gap: 8,
          }}
        >
          <div>duel key: {shortDuelKey(duelKeyHex)}</div>
          <div>
            close:{" "}
            {activeMarket?.betCloseTime
              ? new Date(activeMarket.betCloseTime).toLocaleTimeString()
              : "pending"}
          </div>
          <div>
            spread:{" "}
            {activeMarket
              ? `${(activeMarket.bestBid / 10).toFixed(1)} / ${(activeMarket.bestAsk / 10).toFixed(1)}`
              : "pending"}
          </div>
          <div>
            your A shares: {fmtAmount(position.aShares).toFixed(3)} SOL
          </div>
          <div>
            your B shares: {fmtAmount(position.bShares).toFixed(3)} SOL
          </div>
          <div>
            depth: {sumOrderLevels(bids).toFixed(3)} /{" "}
            {sumOrderLevels(asks).toFixed(3)} SOL
          </div>
        </div>
        <div
          style={{
            display: "flex",
            gap: 8,
            flexWrap: "wrap",
          }}
        >
          <button
            type="button"
            onClick={() => void refreshData()}
            style={buttonStyle("#171717", "rgba(255,255,255,0.14)")}
          >
            Refresh
          </button>
          <button
            type="button"
            onClick={() => void handleCancelLastOrder()}
            disabled={!lastOrderId}
            style={buttonStyle("#1f2937", "rgba(148,163,184,0.32)", !lastOrderId)}
          >
            Cancel Last Order
          </button>
          <button
            type="button"
            onClick={() => void handleClaim()}
            disabled={resolvedWinner === null}
            style={buttonStyle(
              "#0f3f2b",
              "rgba(34,197,94,0.35)",
              resolvedWinner === null,
            )}
          >
            Claim
          </button>
        </div>
      </div>
    </PredictionMarketPanel>
  );
}

function buttonStyle(
  background: string,
  border: string,
  disabled = false,
): CSSProperties {
  return {
    padding: "8px 12px",
    borderRadius: 10,
    border: `1px solid ${border}`,
    background,
    color: disabled ? "rgba(255,255,255,0.45)" : "#f4f4f5",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.65 : 1,
  };
}

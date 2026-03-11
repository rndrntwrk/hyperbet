import {
  type CSSProperties,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  getLocaleTag,
  resolveUiLocale,
  type UiLocale,
} from "@hyperbet/ui/i18n";
import { BN } from "@coral-xyz/anchor";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import {
  type AccountMeta,
  ComputeBudgetProgram,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";

import { findClobConfigPda, findClobVaultPda } from "../lib/clobPdas";
import { duelKeyHexToBytes, shortDuelKey } from "../lib/duelKey";
import {
  DUEL_WINNER_MARKET_KIND,
  findDuelStatePda,
  findMarketStatePda,
  findOrderPda,
  findPriceLevelPda,
  findUserBalancePda,
} from "../lib/pdas";
import { createPrograms, createReadonlyPrograms } from "../lib/programs";
import {
  confirmSignatureViaRpc,
  fetchPriorityFeeEstimate,
  getLatestBlockhashViaRpc,
  HELIUS_SENDER_MIN_TIP_LAMPORTS,
  randomJitoTipAccount,
  sendViaHeliusSender,
  startHeliusSenderWarmup,
} from "../lib/solanaRpc";
import { useStreamingState } from "../spectator/useStreamingState";
import {
  PredictionMarketPanel,
  type ChartDataPoint,
} from "./PredictionMarketPanel";
import { type OrderLevel } from "./OrderBook";
import { PointsDisplay } from "./PointsDisplay";
import { type Trade } from "./RecentTrades";

type BetSide = "YES" | "NO";

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

type PriceLevelAccount = {
  publicKey: PublicKey;
  account: {
    side: number;
    price: number;
    headOrderId: BN | bigint | number;
    tailOrderId: BN | bigint | number;
    totalOpen: BN | bigint | number;
    marketState: PublicKey;
  };
};

type OrderAccount = {
  publicKey: PublicKey;
  account: {
    id: BN | bigint | number;
    side: number;
    price: number;
    maker: PublicKey;
    amount: BN | bigint | number;
    filled: BN | bigint | number;
    prevOrderId: BN | bigint | number;
    nextOrderId: BN | bigint | number;
    active: boolean;
    marketState: PublicKey;
  };
};

type BalanceAccount = {
  publicKey: PublicKey;
  account: {
    user: PublicKey;
    marketState: PublicKey;
    aShares: BN | bigint | number;
    bShares: BN | bigint | number;
  };
};

const SIDE_BID = 1;
const SIDE_ASK = 2;
const MAX_MATCH_ACCOUNTS = 100;

function walletReady(wallet: ReturnType<typeof useWallet>): boolean {
  return Boolean(
    wallet.publicKey && wallet.signTransaction && wallet.signAllTransactions,
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

function formatStatus(status: string | null, locale: UiLocale): string {
  if (!status) return locale === "zh" ? "未知" : "unknown";
  if (locale === "zh") {
    const normalized = status.toLowerCase();
    if (normalized === "unknown") return "未知";
    return status.replace(/[A-Z]/g, (match, index) =>
      index === 0 ? match.toUpperCase() : ` ${match.toLowerCase()}`,
    );
  }
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function isRetryableRefreshError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /failed to fetch|fetch failed|networkerror|load failed|429/i.test(
    message,
  );
}

function getCycleDuelStatusLabel(
  phase: string | undefined,
  duelKeyHex: string | null | undefined,
  locale: UiLocale,
): string {
  if (locale === "zh") {
    if (!duelKeyHex) {
      return "等待实时 Hyperscape 对决";
    }
    if (phase === "ANNOUNCEMENT") {
      return "下注开放中";
    }
    if (phase === "COUNTDOWN" || phase === "FIGHTING") {
      return "下注已锁定";
    }
    if (phase === "RESOLUTION") {
      return "等待结果结算";
    }
    return "正在准备对决市场";
  }
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
  locale?: UiLocale;
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
  locale,
}: SolanaClobPanelProps) {
  const resolvedLocale = resolveUiLocale(locale);
  const isE2eMode = import.meta.env.MODE === "e2e";
  const { connection } = useConnection();
  const wallet = useWallet();
  const { state: streamingState } = useStreamingState();

  const [status, setStatus] = useState(
    getCycleDuelStatusLabel(undefined, null, resolvedLocale),
  );
  const [side, setSide] = useState<BetSide>("YES");
  const [amountInput, setAmountInput] = useState("1");
  const [priceInput, setPriceInput] = useState("500");
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
  const [lastPlaceOrderTx, setLastPlaceOrderTx] = useState("-");
  const [showAdminPanel, setShowAdminPanel] = useState(false);

  const lastSnapshotRef = useRef<{ yes: bigint; no: bigint }>({
    yes: 0n,
    no: 0n,
  });
  const refreshPromiseRef = useRef<Promise<void> | null>(null);

  // Warm Helius Sender on mount to avoid first-transaction cold-start latency.
  useEffect(() => startHeliusSenderWarmup(), []);

  const writablePrograms = useMemo(
    () => (walletReady(wallet) ? createPrograms(connection, wallet) : null),
    [connection, wallet],
  );
  const readonlyPrograms = useMemo(
    () => createReadonlyPrograms(connection),
    [connection],
  );

  const cycle = streamingState?.cycle ?? null;
  const duelKeyHex =
    typeof cycle?.duelKeyHex === "string" ? cycle.duelKeyHex : null;
  const cycleDuelId = typeof cycle?.duelId === "string" ? cycle.duelId : null;
  const duelLabel = cycleDuelId ?? shortDuelKey(duelKeyHex);
  const effectiveAgent1 = cycle?.agent1?.name ?? agent1Name;
  const effectiveAgent2 = cycle?.agent2?.name ?? agent2Name;
  const copy =
    resolvedLocale === "zh"
      ? {
        unknown: "未知",
        connectWalletFirst: "请先连接钱包",
        fundingVaultRent: "补充对局金库租金",
        marketConfigNotDeployed: "市场配置尚未部署",
        waitingOracleReporter: "对局已公布，等待预言机上报",
        waitingMarketOperator: "预言机已上线，等待市场运营方开启",
        resolvedFor: (name: string) => `${name} 已结算获胜`,
        resolved: "已结算",
        marketCancelled: "市场已取消",
        bettingLocked: "下注已锁定",
        marketOpen: "市场开放中",
        refreshFailed: (message: string) => `刷新失败：${message}`,
        connectWalletToTrade: "连接钱包后即可交易",
        amountTooLow: "数量必须大于 0",
        orderPlaced: "订单已提交",
        orderFailed: (message: string) => `下单失败：${message}`,
        connectWalletToClaim: "连接钱包后即可领取",
        claimComplete: "领取完成",
        claimFailed: (message: string) => `领取失败：${message}`,
        claim: "领取",
        limitPrice: "限价",
        hideAdminPanel: "隐藏管理面板",
        showAdminPanel: "显示管理面板",
        match: "市场",
        adminStatus: "状态",
        adminDuel: "对局",
        adminPosition: "持仓",
        adminPools: "资金池",
        adminLastOrder: "最近订单",
        stageBlockhash: "获取区块哈希",
        stageSigning: "签名交易",
        stageSending: "发送交易",
        stageConfirming: "确认交易",
        placingOrderContext: "下单",
        claimingWinningsContext: "领取收益",
      }
      : {
        unknown: "unknown",
        connectWalletFirst: "Connect wallet first",
        fundingVaultRent: "funding duel vault rent",
        marketConfigNotDeployed: "Market config not deployed",
        waitingOracleReporter: "Game announced duel; waiting for oracle reporter",
        waitingMarketOperator: "Oracle is live; waiting for market operator",
        resolvedFor: (name: string) => `Resolved for ${name}`,
        resolved: "Resolved",
        marketCancelled: "Market cancelled",
        bettingLocked: "Betting locked",
        marketOpen: "Market open",
        refreshFailed: (message: string) => `Refresh failed: ${message}`,
        connectWalletToTrade: "Connect wallet to trade",
        amountTooLow: "Amount must be greater than zero",
        orderPlaced: "Order placed",
        orderFailed: (message: string) => `Order failed: ${message}`,
        connectWalletToClaim: "Connect wallet to claim",
        claimComplete: "Claim complete",
        claimFailed: (message: string) => `Claim failed: ${message}`,
        claim: "Claim",
        limitPrice: "Limit price",
        hideAdminPanel: "Hide Admin Panel",
        showAdminPanel: "Show Admin Panel",
        match: "Match",
        adminStatus: "Status",
        adminDuel: "Duel",
        adminPosition: "Position",
        adminPools: "Pools",
        adminLastOrder: "Last order",
        stageBlockhash: "fetching blockhash",
        stageSigning: "signing transaction",
        stageSending: "sending transaction",
        stageConfirming: "confirming transaction",
        placingOrderContext: "placing order",
        claimingWinningsContext: "claiming winnings",
      };

  const updateChartAndTrades = useCallback(
    (nextYes: bigint, nextNo: bigint) => {
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
    },
    [],
  );

  const submitTransaction = useCallback(
    async (transaction: Transaction, context: string): Promise<string> => {
      if (!wallet.publicKey || !wallet.signTransaction) {
        throw new Error(copy.connectWalletFirst);
      }

      let stage = copy.stageBlockhash;
      try {
        transaction.feePayer = wallet.publicKey;

        // Fetch blockhash and dynamic priority fee in parallel.
        const [latest, priorityFeeEstimate] = await Promise.all([
          getLatestBlockhashViaRpc(connection),
          fetchPriorityFeeEstimate(connection.rpcEndpoint, [
            wallet.publicKey.toBase58(),
          ]),
        ]);
        transaction.recentBlockhash = latest.blockhash;

        // Prepend ComputeBudget instructions so validators correctly budget CUs.
        // setComputeUnitLimit MUST come before other instructions.
        transaction.instructions = [
          ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
          ComputeBudgetProgram.setComputeUnitPrice({
            microLamports: priorityFeeEstimate,
          }),
          // Jito tip transfer — required by Helius Sender dual-routing.
          SystemProgram.transfer({
            fromPubkey: wallet.publicKey,
            toPubkey: new PublicKey(randomJitoTipAccount()),
            lamports: HELIUS_SENDER_MIN_TIP_LAMPORTS,
          }),
          ...transaction.instructions,
        ];

        stage = copy.stageSigning;
        const signed = await wallet.signTransaction(transaction);

        stage = copy.stageSending;
        const wireBase64 = Buffer.from(signed.serialize()).toString("base64");
        const signature = await sendViaHeliusSender(wireBase64);

        stage = copy.stageConfirming;
        await confirmSignatureViaRpc(connection, signature);
        return signature;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`${context}: ${stage}: ${message}`, { cause: error });
      }
    },
    [
      connection,
      copy.connectWalletFirst,
      copy.stageBlockhash,
      copy.stageConfirming,
      copy.stageSending,
      copy.stageSigning,
      wallet.publicKey,
      wallet.signTransaction,
    ],
  );

  const ensureVaultRentExempt = useCallback(
    async (vault: PublicKey): Promise<void> => {
      if (!wallet.publicKey) {
        throw new Error(copy.connectWalletFirst);
      }

      const minimumLamports =
        await connection.getMinimumBalanceForRentExemption(0, "confirmed");
      const currentLamports = await connection.getBalance(vault, "confirmed");
      if (currentLamports >= minimumLamports) {
        return;
      }

      const transaction = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: wallet.publicKey,
          toPubkey: vault,
          lamports: minimumLamports - currentLamports,
        }),
      );
      await submitTransaction(transaction, copy.fundingVaultRent);
    },
    [
      connection,
      copy.connectWalletFirst,
      copy.fundingVaultRent,
      submitTransaction,
      wallet.publicKey,
    ],
  );

  const runRefreshData = useCallback(async () => {
    const clobProgram: any = readonlyPrograms.goldClobMarket;
    const oracleProgram: any = readonlyPrograms.fightOracle;
    const runtimeConfigPda = findClobConfigPda(clobProgram.programId);

    const config =
      await clobProgram.account.marketConfig.fetchNullable(runtimeConfigPda);
    if (!config) {
      setStatus(copy.marketConfigNotDeployed);
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
      setStatus(getCycleDuelStatusLabel(cycle?.phase, duelKeyHex, resolvedLocale));
      return;
    }

    const duelKeyBytes = duelKeyHexToBytes(duelKeyHex);
    const duelState = findDuelStatePda(oracleProgram.programId, duelKeyBytes);
    const marketState = findMarketStatePda(
      clobProgram.programId,
      duelState,
      DUEL_WINNER_MARKET_KIND,
    );
    const vault = findClobVaultPda(clobProgram.programId, marketState);

    const [duelAccount, marketAccount, allLevels, allOrders, allBalances] =
      await Promise.all([
        oracleProgram.account.duelState.fetchNullable(duelState),
        clobProgram.account.marketState.fetchNullable(marketState),
        clobProgram.account.priceLevel.all(),
        clobProgram.account.order.all(),
        clobProgram.account.userBalance.all(),
      ]);

    if (!duelAccount) {
      setStatus(copy.waitingOracleReporter);
      setActiveMarket(null);
      return;
    }

    if (!marketAccount) {
      setStatus(copy.waitingMarketOperator);
      setActiveMarket(null);
      return;
    }

    const marketStatus = enumName(marketAccount.status);
    const winner = enumName(marketAccount.winner);

    const levels = (allLevels as PriceLevelAccount[]).filter((entry) =>
      (entry.account.marketState as PublicKey).equals(marketState),
    );
    const orders = (allOrders as OrderAccount[]).filter((entry) =>
      (entry.account.marketState as PublicKey).equals(marketState),
    );
    const balances = (allBalances as BalanceAccount[]).filter((entry) =>
      (entry.account.marketState as PublicKey).equals(marketState),
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
        wallet.publicKey &&
        (balance.account.user as PublicKey).equals(wallet.publicKey)
      ) {
        userPosition = { aShares, bShares };
      }
    }

    const userOpenOrders = orders
      .filter(
        (entry) =>
          wallet.publicKey &&
          (entry.account.maker as PublicKey).equals(wallet.publicKey) &&
          entry.account.active &&
          asBigInt(entry.account.amount) > asBigInt(entry.account.filled),
      )
      .sort((a, b) => Number(asBigInt(b.account.id) - asBigInt(a.account.id)));

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
      userOpenOrders.length > 0
        ? asBigInt(userOpenOrders[0].account.id)
        : null,
    );
    updateChartAndTrades(nextYesPool, nextNoPool);

    if (marketStatus === "resolved") {
      setStatus(
        winner === "a"
          ? copy.resolvedFor(effectiveAgent1)
          : winner === "b"
            ? copy.resolvedFor(effectiveAgent2)
            : copy.resolved,
      );
    } else if (marketStatus === "cancelled") {
      setStatus(copy.marketCancelled);
    } else if (marketStatus === "locked") {
      setStatus(copy.bettingLocked);
    } else if (marketStatus === "open") {
      setStatus(copy.marketOpen);
    } else {
      setStatus(formatStatus(marketStatus, resolvedLocale));
    }
  }, [
    cycle?.betCloseTime,
    cycle?.phase,
    cycleDuelId,
    copy,
    duelKeyHex,
    effectiveAgent1,
    effectiveAgent2,
    readonlyPrograms.fightOracle,
    readonlyPrograms.goldClobMarket,
    resolvedLocale,
    updateChartAndTrades,
    wallet.publicKey,
  ]);

  const refreshData = useCallback(async () => {
    if (refreshPromiseRef.current) {
      return refreshPromiseRef.current;
    }

    const promise = (async () => {
      setIsRefreshing(true);
      try {
        for (let attempt = 0; attempt < 3; attempt += 1) {
          try {
            await runRefreshData();
            return;
          } catch (error) {
            if (!isRetryableRefreshError(error) || attempt === 2) {
              throw error;
            }
            await sleep(250 * (attempt + 1));
          }
        }
      } catch (error) {
        setStatus(copy.refreshFailed((error as Error).message));
      } finally {
        setIsRefreshing(false);
        refreshPromiseRef.current = null;
      }
    })();

    refreshPromiseRef.current = promise;
    return promise;
  }, [copy, runRefreshData]);

  useEffect(() => {
    void refreshData();
    const id = window.setInterval(() => void refreshData(), 5000);
    return () => window.clearInterval(id);
  }, [refreshData]);

  const buildPlaceOrderRemainingAccounts = useCallback(
    async (
      clobProgram: any,
      market: MarketSnapshot,
      sideValue: number,
      price: number,
      amount: bigint,
    ): Promise<AccountMeta[]> => {
      const metas: AccountMeta[] = [];
      const marketAccount = await clobProgram.account.marketState.fetch(
        market.marketState,
      );
      const oppositeSide = sideValue === SIDE_BID ? SIDE_ASK : SIDE_BID;
      let remaining = amount;
      let boundary =
        sideValue === SIDE_BID
          ? Number(marketAccount.bestAsk)
          : Number(marketAccount.bestBid);
      let matches = 0;

      while (remaining > 0n && matches < MAX_MATCH_ACCOUNTS) {
        const crosses =
          sideValue === SIDE_BID
            ? boundary <= price && boundary > 0 && boundary < 1000
            : boundary >= price && boundary > 0 && boundary < 1000;
        if (!crosses) {
          break;
        }

        const levelPda = findPriceLevelPda(
          clobProgram.programId,
          market.marketState,
          oppositeSide,
          boundary,
        );
        const level =
          await clobProgram.account.priceLevel.fetchNullable(levelPda);
        if (!level) {
          break;
        }

        metas.push({
          pubkey: levelPda,
          isSigner: false,
          isWritable: true,
        });

        const levelOpen = asBigInt(level.totalOpen);
        const headOrderId = asBigInt(level.headOrderId);
        if (levelOpen === 0n || headOrderId === 0n) {
          boundary = sideValue === SIDE_BID ? boundary + 1 : boundary - 1;
          matches += 1;
          continue;
        }

        let currentHead = headOrderId;
        let currentLevelOpen = levelOpen;
        while (remaining > 0n && currentHead > 0n && currentLevelOpen > 0n) {
          const orderPda = findOrderPda(
            clobProgram.programId,
            market.marketState,
            currentHead,
          );
          const order = await clobProgram.account.order.fetch(orderPda);
          const makerBalancePda = findUserBalancePda(
            clobProgram.programId,
            market.marketState,
            order.maker as PublicKey,
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
              pubkey: levelPda,
              isSigner: false,
              isWritable: true,
            });
          }
        }

        boundary = sideValue === SIDE_BID ? boundary + 1 : boundary - 1;
        matches += 1;
      }

      const restingLevelPda = findPriceLevelPda(
        clobProgram.programId,
        market.marketState,
        sideValue,
        price,
      );
      const restingLevel =
        await clobProgram.account.priceLevel.fetchNullable(restingLevelPda);
      if (restingLevel && asBigInt(restingLevel.tailOrderId) > 0n) {
        metas.push({
          pubkey: findOrderPda(
            clobProgram.programId,
            market.marketState,
            asBigInt(restingLevel.tailOrderId),
          ),
          isSigner: false,
          isWritable: true,
        });
      }

      return metas;
    },
    [],
  );



  const handlePlaceOrder = useCallback(async () => {
    const clobProgram: any = writablePrograms?.goldClobMarket;
    if (!clobProgram || !wallet.publicKey || !activeMarket) {
      setStatus(copy.connectWalletToTrade);
      return;
    }

    try {
      const amount = toBaseUnits(amountInput);
      if (amount <= 0n) {
        setStatus(copy.amountTooLow);
        return;
      }

      const price = clampPrice(priceInput);
      const sideValue = side === "YES" ? SIDE_BID : SIDE_ASK;
      const orderId = activeMarket.nextOrderId;
      const userBalance = findUserBalancePda(
        clobProgram.programId,
        activeMarket.marketState,
        wallet.publicKey,
      );
      const newOrder = findOrderPda(
        clobProgram.programId,
        activeMarket.marketState,
        orderId,
      );
      const restingLevel = findPriceLevelPda(
        clobProgram.programId,
        activeMarket.marketState,
        sideValue,
        price,
      );
      const remainingAccounts = await buildPlaceOrderRemainingAccounts(
        clobProgram,
        activeMarket,
        sideValue,
        price,
        amount,
      );

      await ensureVaultRentExempt(activeMarket.vault);

      const tx = await clobProgram.methods
        .placeOrder(
          new BN(orderId.toString()),
          sideValue,
          price,
          new BN(amount.toString()),
        )
        .accountsPartial({
          marketState: activeMarket.marketState,
          duelState: activeMarket.duelState,
          userBalance,
          newOrder,
          restingLevel,
          config: findClobConfigPda(clobProgram.programId),
          treasury: (
            await clobProgram.account.marketConfig.fetch(
              findClobConfigPda(clobProgram.programId),
            )
          ).treasury as PublicKey,
          marketMaker: (
            await clobProgram.account.marketConfig.fetch(
              findClobConfigPda(clobProgram.programId),
            )
          ).marketMaker as PublicKey,
          vault: activeMarket.vault,
          user: wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .remainingAccounts(remainingAccounts)
        .transaction();

      const signature = await submitTransaction(tx, copy.placingOrderContext);
      setLastPlaceOrderTx(signature);
      setActiveMarket((current) =>
        current
          ? {
            ...current,
            nextOrderId: orderId + 1n,
          }
          : current,
      );
      setStatus(copy.orderPlaced);
      await refreshData();
    } catch (error) {
      setStatus(copy.orderFailed((error as Error).message));
    }
  }, [
    activeMarket,
    amountInput,
    buildPlaceOrderRemainingAccounts,
    copy,
    ensureVaultRentExempt,
    priceInput,
    refreshData,
    side,
    submitTransaction,
    wallet.publicKey,
    writablePrograms,
  ]);



  const handleClaim = useCallback(async () => {
    const clobProgram: any = writablePrograms?.goldClobMarket;
    if (!clobProgram || !wallet.publicKey || !activeMarket) {
      setStatus(copy.connectWalletToClaim);
      return;
    }

    try {
      const userBalance = findUserBalancePda(
        clobProgram.programId,
        activeMarket.marketState,
        wallet.publicKey,
      );
      const configPda = findClobConfigPda(clobProgram.programId);
      const config = await clobProgram.account.marketConfig.fetch(configPda);

      const tx = await clobProgram.methods
        .claim()
        .accountsPartial({
          marketState: activeMarket.marketState,
          duelState: activeMarket.duelState,
          userBalance,
          config: configPda,
          marketMaker: config.marketMaker as PublicKey,
          vault: activeMarket.vault,
          user: wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .transaction();

      await submitTransaction(tx, copy.claimingWinningsContext);
      setStatus(copy.claimComplete);
      await refreshData();
    } catch (error) {
      setStatus(copy.claimFailed((error as Error).message));
    }
  }, [
    activeMarket,
    copy,
    refreshData,
    submitTransaction,
    wallet.publicKey,
    writablePrograms,
  ]);

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
  const canClaim =
    activeMarket?.marketStatus === "resolved" ||
    activeMarket?.marketStatus === "cancelled";
  const marketStateText = activeMarket?.marketState.toBase58() ?? "-";
  const adminPanelText = [
    `${copy.adminStatus} ${status}`,
    `${copy.match} ${marketStateText}`,
    `${copy.adminDuel} ${duelLabel}`,
    `${copy.adminPosition} YES ${fmtAmount(position.aShares).toFixed(6)} | NO ${fmtAmount(position.bShares).toFixed(6)}`,
    `${copy.adminPools} YES ${fmtAmount(yesPool).toFixed(6)} | NO ${fmtAmount(noPool).toFixed(6)}`,
    `${copy.adminLastOrder} ${lastOrderId?.toString() ?? "-"}`,
  ].join("\n");

  return (
    <div data-testid={isE2eMode ? "solana-clob-panel" : undefined}>
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
        isEvm={false}
        supportsSell
        chartData={chartData}
        bids={bids}
        asks={asks}
        recentTrades={recentTrades}
        currencySymbol="SOL"
        compact={compact}
        pointsDisplay={
          <PointsDisplay
            walletAddress={walletAddress}
            compact={compact}
            locale={resolvedLocale}
          />
        }
        locale={resolvedLocale}
      >
        <div
          style={{
            display: "grid",
            gap: 10,
            padding: compact ? "0 16px 14px" : "12px 0 0",
            color: "#d4d4d8",
            fontFamily: "var(--hm-font-body)",
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
            <span>{status}</span>
            <span>{duelLabel}</span>
          </div>

          <button
            type="button"
            onClick={() => void handleClaim()}
            disabled={!canClaim}
            style={buttonStyle(
              "#0f3f2b",
              "rgba(34,197,94,0.35)",
              !canClaim,
            )}
          >
            {copy.claim}
          </button>
        </div>
      </PredictionMarketPanel>
      <div
        style={{
          marginTop: 12,
          display: "flex",
          alignItems: "center",
          gap: 10,
          color: "#d4d4d8",
          fontFamily: "var(--hm-font-body)",
          fontSize: 12,
        }}
      >
        <span>{copy.limitPrice}</span>
        <input
          data-testid="solana-clob-price-input"
          value={priceInput}
          onChange={(event) => setPriceInput(event.target.value)}
          inputMode="numeric"
          style={{
            width: 88,
            padding: "6px 8px",
            borderRadius: 8,
            border: "1px solid rgba(255,255,255,0.14)",
            background: "rgba(17,24,39,0.65)",
            color: "#f4f4f5",
          }}
        />
      </div>
      {isE2eMode ? (
        <div
          style={{
            marginTop: 12,
            display: "grid",
            gap: 8,
          }}
        >
          <button
            type="button"
            data-testid="solana-clob-admin-toggle"
            aria-expanded={showAdminPanel ? "true" : "false"}
            onClick={() => setShowAdminPanel((open) => !open)}
            style={buttonStyle("#111827", "rgba(148,163,184,0.28)")}
          >
            {showAdminPanel ? copy.hideAdminPanel : copy.showAdminPanel}
          </button>
          <button
            type="button"
            data-testid="solana-clob-create-match"
            onClick={() => void refreshData()}
            style={buttonStyle("#1e3a5f", "rgba(59,130,246,0.35)")}
          >
            Create Match
          </button>
          <div data-testid="solana-clob-match">
            {copy.match}: {marketStateText}
          </div>
          <div data-testid="solana-clob-status">{status}</div>
          <div data-testid="solana-clob-place-order-tx">{lastPlaceOrderTx}</div>
          <div data-testid="solana-clob-init-config-tx">-</div>
          <div data-testid="solana-clob-create-match-tx">-</div>
          <div data-testid="solana-clob-init-orderbook-tx">-</div>
          {showAdminPanel ? (
            <pre
              data-testid="solana-clob-admin-panel"
              style={{
                margin: 0,
                padding: 12,
                borderRadius: 10,
                border: "1px solid rgba(148,163,184,0.22)",
                background: "rgba(10,10,10,0.45)",
                color: "#d4d4d8",
                whiteSpace: "pre-wrap",
                fontSize: 12,
                lineHeight: 1.5,
              }}
            >
              {adminPanelText}
            </pre>
          ) : null}
        </div>
      ) : null}
    </div>
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

import {
  type CSSProperties,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { resolveUiLocale, type UiLocale } from "@hyperbet/ui/i18n";
import { useAccount, useChainId, useSwitchChain, useWalletClient } from "wagmi";
import {
  createWalletClient,
  formatUnits,
  hexToBytes,
  http,
  parseUnits,
  type Address,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { useChain } from "../lib/ChainContext";
import { getEvmChainConfig } from "../lib/chainConfig";
import {
  cancelOrder,
  claimWinnings,
  createEvmPublicClient,
  createUnlockedRpcWalletClient,
  getFeeBps,
  getMarketMeta,
  getNativeBalance,
  getOrder,
  getOrderBook,
  getPosition,
  getRecentOrders,
  getRecentTrades,
  syncMarketFromOracle,
  placeOrder,
  toDuelKeyHex,
  type MarketMeta,
  type Position,
  SIDE_ENUM,
} from "../lib/evmClient";
import { useStreamingState } from "../spectator/useStreamingState";
import {
  PredictionMarketPanel,
  type ChartDataPoint,
} from "./PredictionMarketPanel";
import { type OrderLevel } from "./OrderBook";
import { PointsDisplay } from "./PointsDisplay";
import { type Trade } from "./RecentTrades";

type BetSide = "YES" | "NO";

const MARKET_KIND_DUEL_WINNER = 0;

function normalizePrivateKey(value: string): `0x${string}` | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const withPrefix = trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(withPrefix)) return null;
  return withPrefix as `0x${string}`;
}

function normalizeAddress(value: string): Address | null {
  const trimmed = value.trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(trimmed)) return null;
  return trimmed as Address;
}

interface EvmBettingPanelProps {
  agent1Name: string;
  agent2Name: string;
  compact?: boolean;
  locale?: UiLocale;
}

function getEvmPanelCopy(locale: UiLocale) {
  if (locale === "zh") {
    return {
      waitingForLiveDuel: "等待实时 Hyperscape 对决",
      waitingForMarketOperator: "等待市场运营方开启",
      resolvedFor: (name: string) => `${name} 已结算获胜`,
      resolved: "已结算",
      bettingLocked: "下注已锁定",
      marketOpen: "市场开放中",
      refreshFailed: (message: string) => `刷新失败：${message}`,
      headlessWalletPinned: "无头 EVM 钱包已固定到配置的 RPC",
      chainSwitchFailed: (message: string) => `切换网络失败：${message}`,
      syncingMarket: "正在从对决预言机同步市场...",
      walletNotConnected: "钱包未连接",
      syncFailed: (message: string) => `同步失败：${message}`,
      amountTooLow: "数量必须大于 0",
      placingOrder: "正在下单...",
      orderPlaced: "订单已提交",
      orderFailed: (message: string) => `下单失败：${message}`,
      noActiveOrder: "没有可取消的活动订单",
      cancellingOrder: "正在取消订单...",
      orderCancelled: "订单已取消",
      cancelFailed: (message: string) => `取消失败：${message}`,
      claimingSettlement: "正在领取结算...",
      claimComplete: "领取完成",
      claimFailed: (message: string) => `领取失败：${message}`,
      switchToChain: (name: string) => `切换到 ${name}`,
      duel: "对局",
      pending: "待定",
      wallet: "钱包",
      disconnected: "未连接",
      price: "价格",
      balance: "余额",
      yourShares: "你的 A / B 份额",
      refreshing: "刷新中...",
      refresh: "刷新",
      syncOracle: "同步预言机",
      cancelLastOrder: "取消上一笔订单",
      claim: "领取",
    };
  }

  return {
    waitingForLiveDuel: "Waiting for live Hyperscape duel",
    waitingForMarketOperator: "Waiting for market operator",
    resolvedFor: (name: string) => `Resolved for ${name}`,
    resolved: "Resolved",
    bettingLocked: "Betting locked",
    marketOpen: "Market open",
    refreshFailed: (message: string) => `Refresh failed: ${message}`,
    headlessWalletPinned: "Headless EVM wallet is pinned to configured RPC",
    chainSwitchFailed: (message: string) => `Chain switch failed: ${message}`,
    syncingMarket: "Syncing market from duel oracle...",
    walletNotConnected: "Wallet not connected",
    syncFailed: (message: string) => `Sync failed: ${message}`,
    amountTooLow: "Amount must be greater than zero",
    placingOrder: "Placing order...",
    orderPlaced: "Order placed",
    orderFailed: (message: string) => `Order failed: ${message}`,
    noActiveOrder: "No active order to cancel",
    cancellingOrder: "Cancelling order...",
    orderCancelled: "Order cancelled",
    cancelFailed: (message: string) => `Cancel failed: ${message}`,
    claimingSettlement: "Claiming settlement...",
    claimComplete: "Claim complete",
    claimFailed: (message: string) => `Claim failed: ${message}`,
    switchToChain: (name: string) => `Switch to ${name}`,
    duel: "Duel",
    pending: "pending",
    wallet: "Wallet",
    disconnected: "disconnected",
    price: "Price",
    balance: "Balance",
    yourShares: "Your A / B",
    refreshing: "Refreshing...",
    refresh: "Refresh",
    syncOracle: "Sync Oracle",
    cancelLastOrder: "Cancel Last Order",
    claim: "Claim",
  };
}

export function EvmBettingPanel({
  agent1Name,
  agent2Name,
  compact = false,
  locale,
}: EvmBettingPanelProps) {
  const resolvedLocale = resolveUiLocale(locale);
  const copy = getEvmPanelCopy(resolvedLocale);
  const { activeChain } = useChain();
  const { address } = useAccount();
  const connectedChainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const { data: walletClient } = useWalletClient();
  const { state: streamingState } = useStreamingState();
  const isE2eMode = import.meta.env.MODE === "e2e";

  const chainConfig = useMemo(
    () =>
      activeChain === "bsc" || activeChain === "base" || activeChain === "avax"
        ? getEvmChainConfig(activeChain)
        : null,
    [activeChain],
  );

  const configuredHeadlessPrivateKey = normalizePrivateKey(
    (import.meta.env.VITE_EVM_PRIVATE_KEY as string | undefined) ??
      (import.meta.env.VITE_HEADLESS_EVM_PRIVATE_KEY as string | undefined) ??
      (import.meta.env.VITE_E2E_EVM_PRIVATE_KEY as string | undefined) ??
      "",
  );
  const configuredHeadlessAddress = normalizeAddress(
    (import.meta.env.VITE_E2E_EVM_ADDRESS as string | undefined) ??
      (import.meta.env.VITE_HEADLESS_EVM_ADDRESS as string | undefined) ??
      "",
  );

  const e2eAccountResult = useMemo(() => {
    if (isE2eMode && configuredHeadlessAddress) {
      return { account: configuredHeadlessAddress, error: null };
    }

    if (configuredHeadlessPrivateKey) {
      try {
        return {
          account: privateKeyToAccount(configuredHeadlessPrivateKey),
          error: null,
        };
      } catch (stringError) {
        try {
          return {
            account: privateKeyToAccount(
              hexToBytes(
                configuredHeadlessPrivateKey,
              ) as unknown as `0x${string}`,
            ),
            error: null,
          };
        } catch (bytesError) {
          const error =
            bytesError instanceof Error
              ? bytesError.message
              : stringError instanceof Error
                ? stringError.message
                : "failed to create e2e account";
          return { account: null, error };
        }
      }
    }

    return { account: null, error: "missing private key" };
  }, [configuredHeadlessAddress, configuredHeadlessPrivateKey, isE2eMode]);

  const e2eAccount = e2eAccountResult.account;
  const e2eWalletClient = useMemo(() => {
    if (!chainConfig || !e2eAccount) return null;
    if (typeof e2eAccount === "string") {
      return createUnlockedRpcWalletClient(chainConfig, e2eAccount);
    }
    return createWalletClient({
      account: e2eAccount,
      chain: chainConfig.wagmiChain,
      transport: http(chainConfig.rpcUrl),
    });
  }, [chainConfig, e2eAccount]);

  const headlessAccountAddress =
    typeof e2eAccount === "string" ? e2eAccount : e2eAccount?.address;
  const effectiveWalletClient = isE2eMode
    ? (e2eWalletClient ?? walletClient)
    : (walletClient ?? e2eWalletClient);
  const effectiveAddress = (address ?? headlessAccountAddress) as
    | Address
    | undefined;
  const walletConnected = Boolean(effectiveWalletClient && effectiveAddress);

  const [status, setStatus] = useState(copy.waitingForLiveDuel);
  const [side, setSide] = useState<BetSide>("YES");
  const [amountInput, setAmountInput] = useState("1");
  const [priceInput, setPriceInput] = useState("500");
  const [marketMeta, setMarketMeta] = useState<MarketMeta | null>(null);
  const [position, setPosition] = useState<Position | null>(null);
  const [nativeBalance, setNativeBalance] = useState<bigint>(0n);
  const [tradeFeeBps, setTradeFeeBps] = useState(200);
  const [recentTrades, setRecentTrades] = useState<Trade[]>([]);
  const [bids, setBids] = useState<OrderLevel[]>([]);
  const [asks, setAsks] = useState<OrderLevel[]>([]);
  const [chartData, setChartData] = useState<ChartDataPoint[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastOrderId, setLastOrderId] = useState<bigint | null>(null);
  const [lastOrderTx, setLastOrderTx] = useState("-");
  const [lastResolveTx, setLastResolveTx] = useState("-");
  const [lastClaimTx, setLastClaimTx] = useState("-");

  const lastSnapshotRef = useRef<{ a: bigint; b: bigint }>({ a: 0n, b: 0n });

  const cycle = streamingState?.cycle ?? null;
  const duelKeyHex =
    typeof cycle?.duelKeyHex === "string" ? cycle.duelKeyHex : null;
  const duelId = typeof cycle?.duelId === "string" ? cycle.duelId : null;
  const cycleAgent1 = cycle?.agent1?.name ?? agent1Name;
  const cycleAgent2 = cycle?.agent2?.name ?? agent2Name;
  const nativeDecimals = chainConfig?.nativeCurrency.decimals ?? 18;
  const nativeSymbol = chainConfig?.nativeCurrency.symbol ?? "ETH";

  const publicClient = useMemo(() => {
    if (!chainConfig) return null;
    return createEvmPublicClient(chainConfig);
  }, [chainConfig]);

  const isWrongChain = e2eWalletClient
    ? false
    : chainConfig
      ? connectedChainId !== chainConfig.evmChainId
      : false;

  const updateChartAndTrades = useCallback(
    (nextA: bigint, nextB: bigint) => {
      const now = Date.now();
      const prev = lastSnapshotRef.current;
      const aDelta = nextA - prev.a;
      const bDelta = nextB - prev.b;
      const total = nextA + nextB;
      const pct = total > 0n ? Number((nextA * 100n) / total) : 50;

      setChartData((prevChart) => {
        if (prevChart.length === 0) {
          return [{ time: now, pct }];
        }
        if (aDelta === 0n && bDelta === 0n) {
          return prevChart;
        }
        const next = [...prevChart, { time: now, pct }];
        return next.length > 100 ? next.slice(next.length - 100) : next;
      });

      if (aDelta > 0n) {
        setRecentTrades((prevTrades) =>
          [
            {
              id: `evm-a-${now}`,
              side: "YES" as const,
              amount: Number(formatUnits(aDelta, nativeDecimals)),
              price: pct / 100,
              time: now,
            },
            ...prevTrades,
          ].slice(0, 50),
        );
      }
      if (bDelta > 0n) {
        setRecentTrades((prevTrades) =>
          [
            {
              id: `evm-b-${now}`,
              side: "NO" as const,
              amount: Number(formatUnits(bDelta, nativeDecimals)),
              price: 1 - pct / 100,
              time: now + 1,
            },
            ...prevTrades,
          ].slice(0, 50),
        );
      }

      lastSnapshotRef.current = { a: nextA, b: nextB };
    },
    [nativeDecimals],
  );

  const refreshData = useCallback(async () => {
    if (!publicClient || !chainConfig) return;
    setIsRefreshing(true);

    try {
      if (!duelKeyHex) {
        setMarketMeta(null);
        setPosition(null);
        setBids([]);
        setAsks([]);
        setStatus(copy.waitingForLiveDuel);
        return;
      }

      const duelKey = toDuelKeyHex(duelKeyHex);
      const contractAddr = chainConfig.goldClobAddress as Address;

      const market = await getMarketMeta(
        publicClient,
        contractAddr,
        duelKey,
        MARKET_KIND_DUEL_WINNER,
      );

      if (!market.exists) {
        setMarketMeta(null);
        setPosition(null);
        setBids([]);
        setAsks([]);
        setStatus(copy.waitingForMarketOperator);
        return;
      }

      setMarketMeta(market);
      updateChartAndTrades(market.totalAShares, market.totalBShares);
      const [feeBpsResult, orderBookResult, tradesResult, ordersResult] =
        await Promise.allSettled([
          getFeeBps(publicClient, contractAddr),
          getOrderBook(
            publicClient,
            contractAddr,
            duelKey,
            MARKET_KIND_DUEL_WINNER,
            market,
          ),
          getRecentTrades(publicClient, contractAddr, market.marketKey),
          getRecentOrders(publicClient, contractAddr, market.marketKey),
        ]);

      if (feeBpsResult.status === "fulfilled") {
        setTradeFeeBps(feeBpsResult.value);
      }

      if (orderBookResult.status === "fulfilled") {
        setBids(
          orderBookResult.value.bids.map((entry) => ({
            price: entry.price,
            amount: Number(formatUnits(entry.amount, nativeDecimals)),
            total: Number(formatUnits(entry.total, nativeDecimals)),
          })),
        );
        setAsks(
          orderBookResult.value.asks.map((entry) => ({
            price: entry.price,
            amount: Number(formatUnits(entry.amount, nativeDecimals)),
            total: Number(formatUnits(entry.total, nativeDecimals)),
          })),
        );
      } else {
        setBids([]);
        setAsks([]);
      }

      if (tradesResult.status === "fulfilled") {
        setRecentTrades(
          tradesResult.value.map((trade) => ({
            id: trade.id,
            side: trade.side,
            amount: Number(formatUnits(trade.amount, nativeDecimals)),
            price: trade.price,
            time: trade.time,
          })),
        );
      } else {
        setRecentTrades([]);
      }

      const orders =
        ordersResult.status === "fulfilled" ? ordersResult.value : [];

      if (effectiveAddress) {
        const [userPosition, balance] = await Promise.all([
          getPosition(
            publicClient,
            contractAddr,
            market.marketKey,
            effectiveAddress,
          ),
          getNativeBalance(publicClient, effectiveAddress),
        ]);
        setPosition(userPosition);
        setNativeBalance(balance);

        const candidateOrders = orders
          .filter((order) => order.maker === effectiveAddress)
          .map((order) => order.orderId);
        let nextLastOrderId: bigint | null = null;
        for (const orderId of candidateOrders) {
          const order = await getOrder(
            publicClient,
            contractAddr,
            market.marketKey,
            orderId,
          );
          if (order.active && order.amount > order.filled) {
            nextLastOrderId = orderId;
            break;
          }
        }
        setLastOrderId(nextLastOrderId);
      } else {
        setPosition(null);
        setNativeBalance(0n);
        setLastOrderId(null);
      }

      if (market.status === "RESOLVED") {
        setStatus(
          market.winner === "A"
            ? copy.resolvedFor(cycleAgent1)
            : market.winner === "B"
              ? copy.resolvedFor(cycleAgent2)
              : copy.resolved,
        );
      } else if (market.status === "LOCKED") {
        setStatus(copy.bettingLocked);
      } else if (market.status === "OPEN") {
        setStatus(copy.marketOpen);
      } else {
        setStatus(copy.waitingForMarketOperator);
      }
    } catch (error) {
      setStatus(copy.refreshFailed((error as Error).message));
    } finally {
      setIsRefreshing(false);
    }
  }, [
    chainConfig,
    copy,
    cycleAgent1,
    cycleAgent2,
    duelKeyHex,
    effectiveAddress,
    nativeDecimals,
    publicClient,
    updateChartAndTrades,
  ]);

  useEffect(() => {
    void refreshData();
    const id = setInterval(() => void refreshData(), 5000);
    return () => clearInterval(id);
  }, [refreshData]);

  const handleSwitchChain = async () => {
    if (!chainConfig) return;
    if (e2eWalletClient) {
      setStatus(copy.headlessWalletPinned);
      return;
    }
    try {
      await switchChainAsync({ chainId: chainConfig.evmChainId });
    } catch (error) {
      setStatus(copy.chainSwitchFailed((error as Error).message));
    }
  };

  const handleSyncMarket = useCallback(async () => {
    if (
      !effectiveWalletClient ||
      !effectiveAddress ||
      !chainConfig ||
      !duelKeyHex
    ) {
      setStatus(copy.walletNotConnected);
      return;
    }

    try {
      const duelKey = toDuelKeyHex(duelKeyHex);
      setStatus(copy.syncingMarket);
      const tx = await syncMarketFromOracle(
        effectiveWalletClient,
        chainConfig.goldClobAddress as Address,
        duelKey,
        MARKET_KIND_DUEL_WINNER,
        effectiveAddress,
      );
      setLastResolveTx(tx);
      await publicClient?.waitForTransactionReceipt({ hash: tx });
      await refreshData();
    } catch (error) {
      setStatus(copy.syncFailed((error as Error).message));
    }
  }, [
    chainConfig,
    copy,
    duelKeyHex,
    effectiveAddress,
    effectiveWalletClient,
    publicClient,
    refreshData,
  ]);

  const handlePlaceOrder = useCallback(async () => {
    if (
      !effectiveWalletClient ||
      !effectiveAddress ||
      !chainConfig ||
      !duelKeyHex
    ) {
      setStatus(copy.walletNotConnected);
      return;
    }

    try {
      const amount = parseUnits(amountInput, nativeDecimals);
      if (amount <= 0n) {
        setStatus(copy.amountTooLow);
        return;
      }

      const duelKey = toDuelKeyHex(duelKeyHex);
      const price = Math.min(999, Math.max(1, Math.floor(Number(priceInput))));
      const orderSide = side === "YES" ? SIDE_ENUM.BUY : SIDE_ENUM.SELL;
      const priceComponent = BigInt(
        orderSide === SIDE_ENUM.BUY ? price : 1000 - price,
      );
      const cost = (amount * priceComponent) / 1000n;
      const tradeFee = (cost * BigInt(Math.max(0, tradeFeeBps))) / 10_000n;
      const totalValue = cost + tradeFee;

      setStatus(copy.placingOrder);
      const tx = await placeOrder(
        effectiveWalletClient,
        chainConfig.goldClobAddress as Address,
        duelKey,
        MARKET_KIND_DUEL_WINNER,
        orderSide,
        price,
        amount,
        effectiveAddress,
        totalValue,
      );
      setLastOrderTx(tx);
      await publicClient?.waitForTransactionReceipt({ hash: tx });
      setStatus(copy.orderPlaced);
      await refreshData();
    } catch (error) {
      setStatus(copy.orderFailed((error as Error).message));
    }
  }, [
    amountInput,
    chainConfig,
    copy,
    duelKeyHex,
    effectiveAddress,
    effectiveWalletClient,
    nativeDecimals,
    priceInput,
    publicClient,
    refreshData,
    side,
    tradeFeeBps,
  ]);

  const handleCancelLastOrder = useCallback(async () => {
    if (
      !effectiveWalletClient ||
      !effectiveAddress ||
      !chainConfig ||
      !duelKeyHex ||
      lastOrderId === null
    ) {
      setStatus(copy.noActiveOrder);
      return;
    }

    try {
      const duelKey = toDuelKeyHex(duelKeyHex);
      setStatus(copy.cancellingOrder);
      const tx = await cancelOrder(
        effectiveWalletClient,
        chainConfig.goldClobAddress as Address,
        duelKey,
        MARKET_KIND_DUEL_WINNER,
        lastOrderId,
        effectiveAddress,
      );
      await publicClient?.waitForTransactionReceipt({ hash: tx });
      setStatus(copy.orderCancelled);
      await refreshData();
    } catch (error) {
      setStatus(copy.cancelFailed((error as Error).message));
    }
  }, [
    chainConfig,
    copy,
    duelKeyHex,
    effectiveAddress,
    effectiveWalletClient,
    lastOrderId,
    publicClient,
    refreshData,
  ]);

  const handleClaim = useCallback(async () => {
    if (
      !effectiveWalletClient ||
      !effectiveAddress ||
      !chainConfig ||
      !duelKeyHex
    ) {
      setStatus(copy.walletNotConnected);
      return;
    }

    try {
      const duelKey = toDuelKeyHex(duelKeyHex);
      setStatus(copy.claimingSettlement);
      const tx = await claimWinnings(
        effectiveWalletClient,
        chainConfig.goldClobAddress as Address,
        duelKey,
        MARKET_KIND_DUEL_WINNER,
        effectiveAddress,
      );
      setLastClaimTx(tx);
      await publicClient?.waitForTransactionReceipt({ hash: tx });
      setStatus(copy.claimComplete);
      await refreshData();
    } catch (error) {
      setStatus(copy.claimFailed((error as Error).message));
    }
  }, [
    chainConfig,
    copy,
    duelKeyHex,
    effectiveAddress,
    effectiveWalletClient,
    publicClient,
    refreshData,
  ]);

  const yesPercent =
    marketMeta && marketMeta.totalAShares + marketMeta.totalBShares > 0n
      ? Number(
          (marketMeta.totalAShares * 100n) /
            (marketMeta.totalAShares + marketMeta.totalBShares),
        )
      : 50;
  const noPercent = 100 - yesPercent;
  const walletAddress = effectiveAddress ?? null;
  const canClaim =
    marketMeta?.status === "RESOLVED" || marketMeta?.status === "CANCELLED";
  const e2eWalletDebug = isE2eMode
    ? [
        `key=${configuredHeadlessPrivateKey ? "yes" : "no"}`,
        `addrEnv=${configuredHeadlessAddress ? "yes" : "no"}`,
        `acct=${e2eAccount ? (typeof e2eAccount === "string" ? "rpc" : "local") : "none"}`,
        `wallet=${effectiveWalletClient ? "yes" : "no"}`,
        `addr=${headlessAccountAddress ?? "-"}`,
        `err=${e2eAccountResult.error ?? "-"}`,
      ].join(" ")
    : "";

  return (
    <div data-testid={isE2eMode ? "evm-panel" : undefined}>
      <PredictionMarketPanel
        yesPercent={yesPercent}
        noPercent={noPercent}
        yesPool={`${marketMeta ? Number(formatUnits(marketMeta.totalAShares, nativeDecimals)).toFixed(3) : "0.000"} ${nativeSymbol}`}
        noPool={`${marketMeta ? Number(formatUnits(marketMeta.totalBShares, nativeDecimals)).toFixed(3) : "0.000"} ${nativeSymbol}`}
        side={side}
        setSide={setSide}
        amountInput={amountInput}
        setAmountInput={setAmountInput}
        onPlaceBet={() => void handlePlaceOrder()}
        isWalletReady={walletConnected}
        programsReady={Boolean(chainConfig && duelKeyHex)}
        agent1Name={cycleAgent1}
        agent2Name={cycleAgent2}
        isEvm
        supportsSell
        chartData={chartData}
        bids={bids}
        asks={asks}
        recentTrades={recentTrades}
        currencySymbol={nativeSymbol}
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
            fontFamily: "'Inter', system-ui, sans-serif",
            fontSize: 12,
          }}
        >
          {isWrongChain && (
            <button
              type="button"
              onClick={() => void handleSwitchChain()}
              style={buttonStyle("#1f2937", "rgba(148,163,184,0.32)")}
            >
              {copy.switchToChain(chainConfig?.shortName ?? "EVM")}
            </button>
          )}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: compact
                ? "1fr"
                : "repeat(3, minmax(0, 1fr))",
              gap: 8,
            }}
          >
            <div data-testid={isE2eMode ? "evm-status" : undefined}>
              {status}
            </div>
            <div>
              {copy.duel}:{" "}
              {duelId ??
                (duelKeyHex ? `${duelKeyHex.slice(0, 8)}...` : copy.pending)}
            </div>
            <div>
              {copy.wallet}:{" "}
              {walletAddress
                ? `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`
                : copy.disconnected}
            </div>
            <div>
              {copy.price}:{" "}
              <input
                data-testid={isE2eMode ? "evm-price-input" : undefined}
                value={priceInput}
                onChange={(event) => setPriceInput(event.target.value)}
                inputMode="numeric"
                style={inputStyle}
              />
            </div>
            <div>
              {copy.balance}:{" "}
              {Number(formatUnits(nativeBalance, nativeDecimals)).toFixed(3)}{" "}
              {nativeSymbol}
            </div>
            <div>
              {copy.yourShares}:{" "}
              {position
                ? `${Number(formatUnits(position.aShares, nativeDecimals)).toFixed(3)} / ${Number(formatUnits(position.bShares, nativeDecimals)).toFixed(3)}`
                : "0 / 0"}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              data-testid={isE2eMode ? "evm-refresh-market" : undefined}
              type="button"
              onClick={() => void refreshData()}
              style={buttonStyle("#171717", "rgba(255,255,255,0.14)")}
            >
              {isRefreshing ? copy.refreshing : copy.refresh}
            </button>
            <button
              data-testid={isE2eMode ? "evm-resolve-match" : undefined}
              type="button"
              onClick={() => void handleSyncMarket()}
              disabled={!walletConnected || !duelKeyHex}
              style={buttonStyle(
                "#1f2937",
                "rgba(148,163,184,0.32)",
                !walletConnected || !duelKeyHex,
              )}
            >
              {copy.syncOracle}
            </button>
            <button
              type="button"
              onClick={() => void handleCancelLastOrder()}
              disabled={lastOrderId === null}
              style={buttonStyle(
                "#1f2937",
                "rgba(148,163,184,0.32)",
                lastOrderId === null,
              )}
            >
              {copy.cancelLastOrder}
            </button>
            <button
              data-testid={isE2eMode ? "evm-claim-payout" : undefined}
              type="button"
              onClick={() => void handleClaim()}
              disabled={!canClaim}
              style={buttonStyle("#0f3f2b", "rgba(34,197,94,0.35)", !canClaim)}
            >
              {copy.claim}
            </button>
          </div>
          {isE2eMode ? (
            <div data-testid="evm-wallet-debug">{e2eWalletDebug}</div>
          ) : null}
        </div>
      </PredictionMarketPanel>
      {isE2eMode ? (
        <div
          style={{
            marginTop: 12,
            display: "grid",
            gap: 4,
          }}
        >
          <div data-testid="evm-last-order-tx">{lastOrderTx}</div>
          <div data-testid="evm-last-resolve-tx">{lastResolveTx}</div>
          <div data-testid="evm-last-claim-tx">{lastClaimTx}</div>
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

const inputStyle: CSSProperties = {
  width: 78,
  marginLeft: 8,
  padding: "6px 8px",
  borderRadius: 8,
  border: "1px solid rgba(255,255,255,0.14)",
  background: "rgba(17,24,39,0.65)",
  color: "#f4f4f5",
};

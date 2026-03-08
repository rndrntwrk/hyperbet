import {
  type CSSProperties,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
}

export function EvmBettingPanel({
  agent1Name,
  agent2Name,
  compact = false,
}: EvmBettingPanelProps) {
  const { activeChain } = useChain();
  const { address } = useAccount();
  const connectedChainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const { data: walletClient } = useWalletClient();
  const { state: streamingState } = useStreamingState();
  const isE2eMode = import.meta.env.MODE === "e2e";

  const chainConfig = useMemo(
    () =>
      activeChain === "bsc" || activeChain === "base"
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
    if (!configuredHeadlessPrivateKey) {
      return { account: null, error: "missing private key" };
    }
    try {
      return { account: privateKeyToAccount(configuredHeadlessPrivateKey), error: null };
    } catch (stringError) {
      try {
        return {
          account: privateKeyToAccount(
            hexToBytes(configuredHeadlessPrivateKey) as unknown as `0x${string}`,
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
  }, [configuredHeadlessAddress, configuredHeadlessPrivateKey, isE2eMode]);

  const e2eAccount = e2eAccountResult.account;
  const e2eWalletClient = useMemo(() => {
    if (!chainConfig || !e2eAccount) return null;
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

  const [status, setStatus] = useState("Waiting for live Hyperscape duel");
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

  const updateChartAndTrades = useCallback((nextA: bigint, nextB: bigint) => {
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
  }, [nativeDecimals]);

  const refreshData = useCallback(async () => {
    if (!publicClient || !chainConfig) return;
    setIsRefreshing(true);

    try {
      if (!duelKeyHex) {
        setMarketMeta(null);
        setPosition(null);
        setBids([]);
        setAsks([]);
        setStatus("Waiting for live Hyperscape duel");
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
        setStatus("Waiting for market operator");
        return;
      }

      const [feeBps, orderBook, trades, orders] = await Promise.all([
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

      setTradeFeeBps(feeBps);
      setMarketMeta(market);
      updateChartAndTrades(market.totalAShares, market.totalBShares);

      setBids(
        orderBook.bids.map((entry) => ({
          price: entry.price,
          amount: Number(formatUnits(entry.amount, nativeDecimals)),
          total: Number(formatUnits(entry.total, nativeDecimals)),
        })),
      );
      setAsks(
        orderBook.asks.map((entry) => ({
          price: entry.price,
          amount: Number(formatUnits(entry.amount, nativeDecimals)),
          total: Number(formatUnits(entry.total, nativeDecimals)),
        })),
      );
      setRecentTrades(
        trades.map((trade) => ({
          id: trade.id,
          side: trade.side,
          amount: Number(formatUnits(trade.amount, nativeDecimals)),
          price: trade.price,
          time: trade.time,
        })),
      );

      if (effectiveAddress) {
        const [userPosition, balance] = await Promise.all([
          getPosition(publicClient, contractAddr, market.marketKey, effectiveAddress),
          getNativeBalance(publicClient, effectiveAddress),
        ]);
        setPosition(userPosition);
        setNativeBalance(balance);

        const candidateOrders = orders
          .filter((order) => order.maker === effectiveAddress)
          .map((order) => order.orderId);
        let nextLastOrderId: bigint | null = null;
        for (const orderId of candidateOrders) {
          const order = await getOrder(publicClient, contractAddr, market.marketKey, orderId);
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
            ? `Resolved for ${cycleAgent1}`
            : market.winner === "B"
              ? `Resolved for ${cycleAgent2}`
              : "Resolved",
        );
      } else if (market.status === "LOCKED") {
        setStatus("Betting locked");
      } else if (market.status === "OPEN") {
        setStatus("Market open");
      } else {
        setStatus("Waiting for market operator");
      }
    } catch (error) {
      setStatus(`Refresh failed: ${(error as Error).message}`);
    } finally {
      setIsRefreshing(false);
    }
  }, [
    chainConfig,
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
      setStatus("Headless EVM wallet is pinned to configured RPC");
      return;
    }
    try {
      await switchChainAsync({ chainId: chainConfig.evmChainId });
    } catch (error) {
      setStatus(`Chain switch failed: ${(error as Error).message}`);
    }
  };

  const handleSyncMarket = useCallback(async () => {
    if (!effectiveWalletClient || !effectiveAddress || !chainConfig || !duelKeyHex) {
      setStatus("Wallet not connected");
      return;
    }

    try {
      const duelKey = toDuelKeyHex(duelKeyHex);
      setStatus("Syncing market from duel oracle...");
      const tx = await syncMarketFromOracle(
        effectiveWalletClient,
        chainConfig.goldClobAddress as Address,
        duelKey,
        MARKET_KIND_DUEL_WINNER,
        effectiveAddress,
      );
      await publicClient?.waitForTransactionReceipt({ hash: tx });
      await refreshData();
    } catch (error) {
      setStatus(`Sync failed: ${(error as Error).message}`);
    }
  }, [chainConfig, duelKeyHex, effectiveAddress, effectiveWalletClient, publicClient, refreshData]);

  const handlePlaceOrder = useCallback(async () => {
    if (
      !effectiveWalletClient ||
      !effectiveAddress ||
      !chainConfig ||
      !duelKeyHex
    ) {
      setStatus("Wallet not connected");
      return;
    }

    try {
      const amount = parseUnits(amountInput, nativeDecimals);
      if (amount <= 0n) {
        setStatus("Amount must be greater than zero");
        return;
      }

      const duelKey = toDuelKeyHex(duelKeyHex);
      const price = Math.min(999, Math.max(1, Math.floor(Number(priceInput))));
      const orderSide = side === "YES" ? SIDE_ENUM.BUY : SIDE_ENUM.SELL;
      const priceComponent = BigInt(orderSide === SIDE_ENUM.BUY ? price : 1000 - price);
      const cost = (amount * priceComponent) / 1000n;
      const tradeFee = (cost * BigInt(Math.max(0, tradeFeeBps))) / 10_000n;
      const totalValue = cost + tradeFee;

      setStatus("Placing order...");
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
      await publicClient?.waitForTransactionReceipt({ hash: tx });
      setStatus("Order placed");
      await refreshData();
    } catch (error) {
      setStatus(`Order failed: ${(error as Error).message}`);
    }
  }, [
    amountInput,
    chainConfig,
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
      setStatus("No active order to cancel");
      return;
    }

    try {
      const duelKey = toDuelKeyHex(duelKeyHex);
      setStatus("Cancelling order...");
      const tx = await cancelOrder(
        effectiveWalletClient,
        chainConfig.goldClobAddress as Address,
        duelKey,
        MARKET_KIND_DUEL_WINNER,
        lastOrderId,
        effectiveAddress,
      );
      await publicClient?.waitForTransactionReceipt({ hash: tx });
      setStatus("Order cancelled");
      await refreshData();
    } catch (error) {
      setStatus(`Cancel failed: ${(error as Error).message}`);
    }
  }, [
    chainConfig,
    duelKeyHex,
    effectiveAddress,
    effectiveWalletClient,
    lastOrderId,
    publicClient,
    refreshData,
  ]);

  const handleClaim = useCallback(async () => {
    if (!effectiveWalletClient || !effectiveAddress || !chainConfig || !duelKeyHex) {
      setStatus("Wallet not connected");
      return;
    }

    try {
      const duelKey = toDuelKeyHex(duelKeyHex);
      setStatus("Claiming settlement...");
      const tx = await claimWinnings(
        effectiveWalletClient,
        chainConfig.goldClobAddress as Address,
        duelKey,
        MARKET_KIND_DUEL_WINNER,
        effectiveAddress,
      );
      await publicClient?.waitForTransactionReceipt({ hash: tx });
      setStatus("Claim complete");
      await refreshData();
    } catch (error) {
      setStatus(`Claim failed: ${(error as Error).message}`);
    }
  }, [chainConfig, duelKeyHex, effectiveAddress, effectiveWalletClient, publicClient, refreshData]);

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

  return (
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
      programsReady={Boolean(marketMeta)}
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
        {isWrongChain && (
          <button
            type="button"
            onClick={() => void handleSwitchChain()}
            style={buttonStyle("#1f2937", "rgba(148,163,184,0.32)")}
          >
            Switch to {chainConfig?.shortName}
          </button>
        )}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: compact ? "1fr" : "repeat(3, minmax(0, 1fr))",
            gap: 8,
          }}
        >
          <div>{status}</div>
          <div>duel: {duelId ?? (duelKeyHex ? `${duelKeyHex.slice(0, 8)}...` : "pending")}</div>
          <div>
            wallet:{" "}
            {walletAddress
              ? `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`
              : "disconnected"}
          </div>
          <div>
            price:{" "}
            <input
              value={priceInput}
              onChange={(event) => setPriceInput(event.target.value)}
              inputMode="numeric"
              style={inputStyle}
            />
          </div>
          <div>
            balance: {Number(formatUnits(nativeBalance, nativeDecimals)).toFixed(3)}{" "}
            {nativeSymbol}
          </div>
          <div>
            your A / B:{" "}
            {position
              ? `${Number(formatUnits(position.aShares, nativeDecimals)).toFixed(3)} / ${Number(formatUnits(position.bShares, nativeDecimals)).toFixed(3)}`
              : "0 / 0"}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={() => void refreshData()}
            style={buttonStyle("#171717", "rgba(255,255,255,0.14)")}
          >
            {isRefreshing ? "Refreshing..." : "Refresh"}
          </button>
          <button
            type="button"
            onClick={() => void handleSyncMarket()}
            disabled={!walletConnected || !duelKeyHex}
            style={buttonStyle(
              "#1f2937",
              "rgba(148,163,184,0.32)",
              !walletConnected || !duelKeyHex,
            )}
          >
            Sync Oracle
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
            Cancel Last Order
          </button>
          <button
            type="button"
            onClick={() => void handleClaim()}
            disabled={!canClaim}
            style={buttonStyle("#0f3f2b", "rgba(34,197,94,0.35)", !canClaim)}
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

const inputStyle: CSSProperties = {
  width: 78,
  marginLeft: 8,
  padding: "6px 8px",
  borderRadius: 8,
  border: "1px solid rgba(255,255,255,0.14)",
  background: "rgba(17,24,39,0.65)",
  color: "#f4f4f5",
};

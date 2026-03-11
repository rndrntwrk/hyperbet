import type {
  BettingChainKey,
  PredictionMarketLifecycleStatus,
} from "@hyperbet/chain-registry";

export interface MarketMakerConfig {
  targetSpreadBps: number;
  toxicSpreadMultiplier: number;
  toxicityThresholdBps: number;
  minQuotePrice: number;
  maxQuotePrice: number;
  minQuoteUnits: number;
  maxQuoteUnits: number;
  maxInventoryPerSide: number;
  maxNetExposure: number;
  maxDrawdownBps: number;
  staleStreamAfterMs: number;
  staleOracleAfterMs: number;
  staleRpcAfterMs: number;
  minRefreshIntervalMs: number;
  maxQuoteAgeMs: number;
  betCloseGuardMs: number;
  inventorySkewBps: number;
}

export interface MarketHealthSnapshot {
  chainKey: BettingChainKey;
  duelKey: string | null;
  marketRef: string | null;
  lifecycleStatus: PredictionMarketLifecycleStatus;
  inventoryYes: number;
  inventoryNo: number;
  openOrderCount: number;
  quoteAgeMs: number | null;
  drawdownBps: number;
  lastStreamAtMs: number | null;
  lastOracleAtMs: number | null;
  lastRpcAtMs: number | null;
  circuitBreaker: CircuitBreakerState;
}

export interface QuotePlacementResult {
  orderId: string;
  txRef: string | null;
  placedAtMs: number;
}

export interface MarketAdapter {
  discoverOpenMarket(): Promise<MarketSnapshot | null>;
  getMarketSnapshot(duelKey: string, marketRef: string): Promise<MarketSnapshot>;
  placeQuote(
    duelKey: string,
    side: "BID" | "ASK",
    price: number,
    units: number,
  ): Promise<QuotePlacementResult>;
  cancelQuote(duelKey: string, orderId: string): Promise<void>;
  syncMarket(duelKey: string): Promise<void>;
  claim(duelKey: string): Promise<void>;
  getOpenOrders(duelKey: string): Promise<readonly string[]>;
  getPosition(duelKey: string): Promise<MarketExposure>;
  health(): Promise<MarketHealthSnapshot>;
}

export interface MarketExposure {
  yes: number;
  no: number;
  openYes: number;
  openNo: number;
  realizedPnl?: number;
  unrealizedPnl?: number;
  drawdownBps?: number;
}

export interface MarketSnapshot {
  chainKey: BettingChainKey;
  lifecycleStatus: PredictionMarketLifecycleStatus;
  duelKey: string | null;
  marketRef: string | null;
  bestBid: number | null;
  bestAsk: number | null;
  betCloseTimeMs?: number | null;
  lastStreamAtMs?: number | null;
  lastOracleAtMs?: number | null;
  lastRpcAtMs?: number | null;
  quoteAgeMs?: number | null;
  exposure: MarketExposure;
}

export interface FairValueInput {
  bookBid?: number | null;
  bookAsk?: number | null;
  signalPrice?: number | null;
  signalWeight?: number | null;
  fallbackPrice?: number;
  inventorySkew?: number;
  inventorySkewBps?: number;
  minPrice?: number;
  maxPrice?: number;
}

export interface CircuitBreakerState {
  active: boolean;
  reason: string | null;
}

export interface RiskState {
  yesExposure: number;
  noExposure: number;
  netExposure: number;
  drawdownBps: number;
  toxicityBps: number;
  staleStream: boolean;
  staleOracle: boolean;
  staleRpc: boolean;
  closingSoon: boolean;
  canBid: boolean;
  canAsk: boolean;
  circuitBreaker: CircuitBreakerState;
}

export interface QuotePlan {
  fairValue: number;
  bidPrice: number | null;
  askPrice: number | null;
  bidUnits: number;
  askUnits: number;
  replaceQuotes: boolean;
  risk: RiskState;
}

export interface AgentActionTrace {
  actor: string;
  action: string;
  chainKey: BettingChainKey;
  duelKey: string | null;
  marketRef: string | null;
  price: number | null;
  units: number | null;
  txRef: string | null;
  ok: boolean;
  message?: string;
}

export interface MitigationGate {
  name: string;
  passed: boolean;
  reason: string | null;
}

export interface ScenarioResult {
  name: string;
  seed: string;
  chainKey: BettingChainKey;
  attackerPnl: number;
  marketMakerPnl: number;
  maxDrawdownBps: number;
  peakInventory: number;
  quoteUptimeRatio: number;
  spreadWidthBps: number;
  orderChurn: number;
  lockTransitionLatencyMs: number | null;
  resolvedCorrectly: boolean;
  claimCorrectly: boolean;
  gates: MitigationGate[];
  traces: AgentActionTrace[];
}

export const DEFAULT_MARKET_MAKER_CONFIG: MarketMakerConfig = {
  targetSpreadBps: 200,
  toxicSpreadMultiplier: 2,
  toxicityThresholdBps: 1000,
  minQuotePrice: 1,
  maxQuotePrice: 999,
  minQuoteUnits: 25,
  maxQuoteUnits: 100,
  maxInventoryPerSide: 500_000,
  maxNetExposure: 250_000,
  maxDrawdownBps: 2_000,
  staleStreamAfterMs: 3_000,
  staleOracleAfterMs: 5_000,
  staleRpcAfterMs: 5_000,
  minRefreshIntervalMs: 1_000,
  maxQuoteAgeMs: 12_000,
  betCloseGuardMs: 5_000,
  inventorySkewBps: 750,
};

export function clampPrice(
  value: number,
  min = DEFAULT_MARKET_MAKER_CONFIG.minQuotePrice,
  max = DEFAULT_MARKET_MAKER_CONFIG.maxQuotePrice,
): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

export function computeBookMid(
  bestBid: number | null | undefined,
  bestAsk: number | null | undefined,
): number | null {
  if (
    !Number.isFinite(bestBid) ||
    !Number.isFinite(bestAsk) ||
    bestBid == null ||
    bestAsk == null ||
    bestBid <= 0 ||
    bestAsk <= 0 ||
    bestAsk < bestBid
  ) {
    return null;
  }
  return (bestBid + bestAsk) / 2;
}

export function computeToxicityBps(
  bestBid: number | null | undefined,
  bestAsk: number | null | undefined,
): number {
  const mid = computeBookMid(bestBid, bestAsk);
  if (!mid || mid <= 0 || bestBid == null || bestAsk == null) {
    return 10_000;
  }
  return Math.round(((bestAsk - bestBid) * 10_000) / mid);
}

export function computeInventorySkew(exposure: MarketExposure): number {
  const yesExposure = exposure.yes + exposure.openYes;
  const noExposure = exposure.no + exposure.openNo;
  const denominator = Math.max(1, yesExposure + noExposure);
  return (yesExposure - noExposure) / denominator;
}

export function computeFairValue(input: FairValueInput): number {
  const fallbackPrice = clampPrice(input.fallbackPrice ?? 500);
  const bookMid = computeBookMid(input.bookBid ?? null, input.bookAsk ?? null);
  const signalPrice = Number.isFinite(input.signalPrice)
    ? clampPrice(
        Number(input.signalPrice),
        input.minPrice ?? DEFAULT_MARKET_MAKER_CONFIG.minQuotePrice,
        input.maxPrice ?? DEFAULT_MARKET_MAKER_CONFIG.maxQuotePrice,
      )
    : null;
  const signalWeight = Math.min(
    1,
    Math.max(0, Number.isFinite(input.signalWeight) ? Number(input.signalWeight) : 0),
  );

  let fairValue = fallbackPrice;
  if (bookMid != null && signalPrice != null) {
    fairValue = bookMid * (1 - signalWeight) + signalPrice * signalWeight;
  } else if (bookMid != null) {
    fairValue = bookMid;
  } else if (signalPrice != null) {
    fairValue = signalPrice;
  }

  const skew = Math.max(-1, Math.min(1, input.inventorySkew ?? 0));
  const inventorySkewBps = Math.max(0, input.inventorySkewBps ?? 0);
  const inventoryShift = (fairValue * inventorySkewBps * skew) / 10_000;
  return clampPrice(
    fairValue - inventoryShift,
    input.minPrice ?? DEFAULT_MARKET_MAKER_CONFIG.minQuotePrice,
    input.maxPrice ?? DEFAULT_MARKET_MAKER_CONFIG.maxQuotePrice,
  );
}

export function buildRiskState(
  snapshot: MarketSnapshot,
  config: MarketMakerConfig = DEFAULT_MARKET_MAKER_CONFIG,
  now = Date.now(),
): RiskState {
  const yesExposure = snapshot.exposure.yes + snapshot.exposure.openYes;
  const noExposure = snapshot.exposure.no + snapshot.exposure.openNo;
  const netExposure = yesExposure - noExposure;
  const drawdownBps = Math.max(0, snapshot.exposure.drawdownBps ?? 0);
  const staleStream =
    snapshot.lastStreamAtMs == null || now - snapshot.lastStreamAtMs > config.staleStreamAfterMs;
  const staleOracle =
    snapshot.lastOracleAtMs == null || now - snapshot.lastOracleAtMs > config.staleOracleAfterMs;
  const staleRpc =
    snapshot.lastRpcAtMs == null || now - snapshot.lastRpcAtMs > config.staleRpcAfterMs;
  const closingSoon =
    snapshot.betCloseTimeMs != null &&
    snapshot.betCloseTimeMs - now <= config.betCloseGuardMs;
  const toxicityBps = computeToxicityBps(snapshot.bestBid, snapshot.bestAsk);

  let reason: string | null = null;
  if (snapshot.lifecycleStatus !== "OPEN") {
    reason = `market:${snapshot.lifecycleStatus.toLowerCase()}`;
  } else if (closingSoon) {
    reason = "bet-close-guard";
  } else if (staleStream) {
    reason = "stale-stream";
  } else if (staleOracle) {
    reason = "stale-oracle";
  } else if (staleRpc) {
    reason = "stale-rpc";
  } else if (drawdownBps >= config.maxDrawdownBps) {
    reason = "drawdown-limit";
  }

  const canBid =
    yesExposure < config.maxInventoryPerSide &&
    netExposure < config.maxNetExposure &&
    reason == null;
  const canAsk =
    noExposure < config.maxInventoryPerSide &&
    -netExposure < config.maxNetExposure &&
    reason == null;

  return {
    yesExposure,
    noExposure,
    netExposure,
    drawdownBps,
    toxicityBps,
    staleStream,
    staleOracle,
    staleRpc,
    closingSoon,
    canBid,
    canAsk,
    circuitBreaker: {
      active: reason != null,
      reason,
    },
  };
}

export function buildQuotePlan(
  snapshot: MarketSnapshot,
  signal: Pick<FairValueInput, "signalPrice" | "signalWeight"> = {},
  config: MarketMakerConfig = DEFAULT_MARKET_MAKER_CONFIG,
  now = Date.now(),
): QuotePlan {
  const risk = buildRiskState(snapshot, config, now);
  const fairValue = computeFairValue({
    bookBid: snapshot.bestBid,
    bookAsk: snapshot.bestAsk,
    signalPrice: signal.signalPrice,
    signalWeight: signal.signalWeight,
    fallbackPrice: 500,
    inventorySkew: computeInventorySkew(snapshot.exposure),
    inventorySkewBps: config.inventorySkewBps,
    minPrice: config.minQuotePrice,
    maxPrice: config.maxQuotePrice,
  });

  if (risk.circuitBreaker.active) {
    return {
      fairValue,
      bidPrice: null,
      askPrice: null,
      bidUnits: 0,
      askUnits: 0,
      replaceQuotes: true,
      risk,
    };
  }

  let quoteWidth = Math.max(
    5,
    Math.ceil((config.targetSpreadBps * fairValue) / 10_000),
  );
  if (risk.toxicityBps >= config.toxicityThresholdBps) {
    quoteWidth *= Math.max(1, config.toxicSpreadMultiplier);
  }

  let baseUnits = Math.max(
    config.minQuoteUnits,
    Math.min(
      config.maxQuoteUnits,
      Math.round(
        config.maxQuoteUnits *
          (1 -
            Math.max(risk.yesExposure, risk.noExposure) /
              Math.max(1, config.maxInventoryPerSide)),
      ),
    ),
  );
  if (risk.toxicityBps >= config.toxicityThresholdBps) {
    baseUnits = Math.max(config.minQuoteUnits, Math.floor(baseUnits / 2));
  }

  const imbalance = Math.max(-1, Math.min(1, computeInventorySkew(snapshot.exposure)));
  const bidUnits = risk.canBid
    ? Math.max(
        config.minQuoteUnits,
        Math.round(baseUnits * Math.max(0.25, 1 - Math.max(0, imbalance))),
      )
    : 0;
  const askUnits = risk.canAsk
    ? Math.max(
        config.minQuoteUnits,
        Math.round(baseUnits * Math.max(0.25, 1 + Math.min(0, imbalance))),
      )
    : 0;

  let bidPrice = clampPrice(
    fairValue - quoteWidth / 2,
    config.minQuotePrice,
    config.maxQuotePrice,
  );
  let askPrice = clampPrice(
    fairValue + quoteWidth / 2,
    config.minQuotePrice,
    config.maxQuotePrice,
  );
  if (bidPrice >= askPrice) {
    bidPrice = Math.max(config.minQuotePrice, askPrice - 1);
    askPrice = Math.min(config.maxQuotePrice, bidPrice + 1);
  }

  return {
    fairValue,
    bidPrice: bidUnits > 0 ? bidPrice : null,
    askPrice: askUnits > 0 ? askPrice : null,
    bidUnits,
    askUnits,
    replaceQuotes:
      snapshot.quoteAgeMs == null || snapshot.quoteAgeMs >= config.minRefreshIntervalMs,
    risk,
  };
}

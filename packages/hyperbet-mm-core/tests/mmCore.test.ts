import { describe, expect, test } from "bun:test";

import {
  DEFAULT_MARKET_MAKER_CONFIG,
  buildQuotePlan,
  buildRiskState,
  computeFairValue,
  evaluateQuoteDecision,
} from "../src/index.ts";

describe("mm-core", () => {
  test("blends book mid and duel signal and shifts away from inventory", () => {
    const fairValue = computeFairValue({
      bookBid: 450,
      bookAsk: 550,
      signalPrice: 800,
      signalWeight: 0.5,
      inventorySkew: 0.5,
      inventorySkewBps: 1_000,
    });
    expect(fairValue).toBeLessThan(650);
    expect(fairValue).toBeGreaterThan(500);
  });

  test("halts quoting when market is stale", () => {
    const now = 1_000_000;
    const risk = buildRiskState(
      {
        chainKey: "bsc",
        lifecycleStatus: "OPEN",
        duelKey: "0xabc",
        marketRef: "0xdef",
        bestBid: 480,
        bestAsk: 520,
        lastStreamAtMs: now - 10_000,
        lastOracleAtMs: now - 100,
        lastRpcAtMs: now - 100,
        exposure: { yes: 0, no: 0, openYes: 0, openNo: 0 },
      },
      DEFAULT_MARKET_MAKER_CONFIG,
      now,
    );
    expect(risk.circuitBreaker.active).toBe(true);
    expect(risk.circuitBreaker.reason).toBe("stale-stream");
  });

  test("widens and shrinks quotes under toxic flow", () => {
    const plan = buildQuotePlan(
      {
        chainKey: "avax",
        lifecycleStatus: "OPEN",
        duelKey: "0xabc",
        marketRef: "0xdef",
        bestBid: 300,
        bestAsk: 700,
        lastStreamAtMs: 10_000,
        lastOracleAtMs: 10_000,
        lastRpcAtMs: 10_000,
        exposure: { yes: 100, no: 100, openYes: 0, openNo: 0 },
      },
      { signalPrice: 500, signalWeight: 0.5 },
      DEFAULT_MARKET_MAKER_CONFIG,
      12_000,
    );
    expect(plan.bidPrice).not.toBeNull();
    expect(plan.askPrice).not.toBeNull();
    expect((plan.askPrice as number) - (plan.bidPrice as number)).toBeGreaterThanOrEqual(20);
    expect(plan.bidUnits).toBeLessThanOrEqual(DEFAULT_MARKET_MAKER_CONFIG.maxQuoteUnits);
  });

  test("stops the overloaded side when exposure is too large", () => {
    const plan = buildQuotePlan(
      {
        chainKey: "bsc",
        lifecycleStatus: "OPEN",
        duelKey: "0xabc",
        marketRef: "0xdef",
        bestBid: 490,
        bestAsk: 510,
        lastStreamAtMs: 10_000,
        lastOracleAtMs: 10_000,
        lastRpcAtMs: 10_000,
        exposure: {
          yes: DEFAULT_MARKET_MAKER_CONFIG.maxInventoryPerSide,
          no: 10,
          openYes: 0,
          openNo: 0,
        },
      },
      {},
      DEFAULT_MARKET_MAKER_CONFIG,
      10_500,
    );
    expect(plan.bidUnits).toBe(0);
    expect(plan.askUnits).toBeGreaterThan(0);
  });

  test("caps quoting when gross market exposure breaches the per-market limit", () => {
    const risk = buildRiskState(
      {
        chainKey: "bsc",
        lifecycleStatus: "OPEN",
        duelKey: "0xabc",
        marketRef: "0xdef",
        bestBid: 490,
        bestAsk: 510,
        lastStreamAtMs: 10_000,
        lastOracleAtMs: 10_000,
        lastRpcAtMs: 10_000,
        exposure: {
          yes: DEFAULT_MARKET_MAKER_CONFIG.maxGrossExposure / 2,
          no: DEFAULT_MARKET_MAKER_CONFIG.maxGrossExposure / 2,
          openYes: 10,
          openNo: 10,
        },
      },
      DEFAULT_MARKET_MAKER_CONFIG,
      10_500,
    );
    expect(risk.circuitBreaker.active).toBe(true);
    expect(risk.circuitBreaker.reason).toBe("market-notional-limit");
  });

  test("enters reduce-only mode on severe side imbalance", () => {
    const plan = buildQuotePlan(
      {
        chainKey: "solana",
        lifecycleStatus: "OPEN",
        duelKey: "0xabc",
        marketRef: "market",
        bestBid: 495,
        bestAsk: 505,
        lastStreamAtMs: 10_000,
        lastOracleAtMs: 10_000,
        lastRpcAtMs: 10_000,
        exposure: {
          yes: 300,
          no: 10,
          openYes: 0,
          openNo: 0,
        },
      },
      {},
      {
        ...DEFAULT_MARKET_MAKER_CONFIG,
        minQuoteUnits: 10,
        maxQuoteUnits: 40,
        maxInventoryPerSide: 500,
        maxNetExposure: 500,
        maxGrossExposure: 700,
        maxSideImbalanceBps: 6_000,
      },
      10_500,
    );
    expect(plan.risk.reduceOnly).toBe(true);
    expect(plan.bidUnits).toBe(0);
    expect(plan.askUnits).toBeGreaterThan(0);
  });

  test("refreshes a quote when target size changes after the refresh window opens", () => {
    const plan = buildQuotePlan(
      {
        chainKey: "solana",
        lifecycleStatus: "OPEN",
        duelKey: "0xabc",
        marketRef: "market",
        bestBid: 490,
        bestAsk: 510,
        quoteAgeMs: 2_000,
        lastStreamAtMs: 10_000,
        lastOracleAtMs: 10_000,
        lastRpcAtMs: 10_000,
        exposure: {
          yes: 0,
          no: 0,
          openYes: 0,
          openNo: 0,
        },
      },
      {},
      {
        ...DEFAULT_MARKET_MAKER_CONFIG,
        minQuoteUnits: 10,
        maxQuoteUnits: 40,
        minRefreshIntervalMs: 1_000,
      },
      10_500,
    );
    const decision = evaluateQuoteDecision(
      "BID",
      plan,
      {
        price: plan.bidPrice as number,
        units: (plan.bidUnits || 0) + 5,
        placedAtMs: 8_000,
      },
      {
        ...DEFAULT_MARKET_MAKER_CONFIG,
        minQuoteUnits: 10,
        maxQuoteUnits: 40,
        minRefreshIntervalMs: 1_000,
      },
      10_500,
    );
    expect(decision.shouldCancel).toBe(true);
    expect(decision.shouldPlace).toBe(true);
    expect(decision.reason).toBe("size-refresh");
  });

  test("keeps an active quote before the refresh interval even if targets moved", () => {
    const config = {
      ...DEFAULT_MARKET_MAKER_CONFIG,
      minQuoteUnits: 10,
      maxQuoteUnits: 40,
      minRefreshIntervalMs: 5_000,
    };
    const plan = buildQuotePlan(
      {
        chainKey: "bsc",
        lifecycleStatus: "OPEN",
        duelKey: "0xabc",
        marketRef: "0xdef",
        bestBid: 480,
        bestAsk: 520,
        quoteAgeMs: 2_000,
        lastStreamAtMs: 10_000,
        lastOracleAtMs: 10_000,
        lastRpcAtMs: 10_000,
        exposure: {
          yes: 0,
          no: 0,
          openYes: 0,
          openNo: 0,
        },
      },
      { signalPrice: 600, signalWeight: 0.5 },
      config,
      10_500,
    );
    const decision = evaluateQuoteDecision(
      "ASK",
      plan,
      {
        price: Math.max(1, (plan.askPrice as number) - 10),
        units: plan.askUnits,
        placedAtMs: 9_000,
      },
      config,
      10_500,
    );
    expect(decision.shouldKeep).toBe(true);
    expect(decision.shouldCancel).toBe(false);
  });
});

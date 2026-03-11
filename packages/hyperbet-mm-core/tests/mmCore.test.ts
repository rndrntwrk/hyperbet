import { describe, expect, test } from "bun:test";

import {
  DEFAULT_MARKET_MAKER_CONFIG,
  buildQuotePlan,
  buildRiskState,
  computeFairValue,
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
});

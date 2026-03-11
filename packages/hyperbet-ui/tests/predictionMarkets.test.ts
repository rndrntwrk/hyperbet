import { describe, expect, it } from "bun:test";

import {
  normalizePredictionMarketDuelKeyHex,
  parsePredictionMarketsResponse,
  selectPredictionMarketLifecycleRecord,
} from "../src/lib/predictionMarkets";

describe("prediction market lifecycle helpers", () => {
  it("normalizes duel keys from bare and 0x-prefixed hex", () => {
    const duelKey = "ab".repeat(32);

    expect(normalizePredictionMarketDuelKeyHex(duelKey)).toBe(duelKey);
    expect(normalizePredictionMarketDuelKeyHex(`0x${duelKey}`)).toBe(duelKey);
    expect(normalizePredictionMarketDuelKeyHex("not-a-duel-key")).toBeNull();
  });

  it("parses and normalizes keeper lifecycle payloads", () => {
    const duelKey = "cd".repeat(32);
    const parsed = parsePredictionMarketsResponse({
      duel: {
        duelKey: `0x${duelKey}`,
        duelId: "duel-42",
        phase: "ANNOUNCEMENT",
        winner: "NONE",
        betCloseTime: 12345,
      },
      markets: [
        {
          chainKey: "solana",
          duelKey: duelKey.toUpperCase(),
          duelId: "duel-42",
          marketId: "market-a",
          marketRef: "market-a",
          lifecycleStatus: "OPEN",
          winner: "NONE",
          betCloseTime: 12345,
          contractAddress: null,
          programId: "program-a",
          txRef: null,
          syncedAt: 999,
        },
        {
          chainKey: "bsc",
          duelKey: "bad-key",
          duelId: "duel-42",
          marketId: "market-b",
          marketRef: "market-b",
          lifecycleStatus: "LOCKED",
          winner: "A",
          betCloseTime: null,
          contractAddress: "0xabc",
          programId: null,
          txRef: "0xdef",
          syncedAt: 1000,
        },
      ],
      updatedAt: 555,
    });

    expect(parsed).not.toBeNull();
    expect(parsed?.duel.duelKey).toBe(duelKey);
    expect(parsed?.markets).toHaveLength(2);
    expect(parsed?.markets[0]?.duelKey).toBe(duelKey);
    expect(parsed?.markets[1]?.duelKey).toBeNull();
    expect(parsed?.markets[1]?.lifecycleStatus).toBe("LOCKED");
  });

  it("selects the lifecycle record for a target chain", () => {
    const payload = parsePredictionMarketsResponse({
      duel: {
        duelKey: "ef".repeat(32),
        duelId: "duel-7",
        phase: "COUNTDOWN",
        winner: "NONE",
        betCloseTime: 456,
      },
      markets: [
        {
          chainKey: "solana",
          duelKey: "ef".repeat(32),
          duelId: "duel-7",
          marketId: "sol-market",
          marketRef: "sol-market",
          lifecycleStatus: "LOCKED",
          winner: "NONE",
          betCloseTime: 456,
          contractAddress: null,
          programId: "program-a",
          txRef: null,
          syncedAt: 1,
        },
        {
          chainKey: "avax",
          duelKey: "ef".repeat(32),
          duelId: "duel-7",
          marketId: "avax:12",
          marketRef: "avax:12",
          lifecycleStatus: "OPEN",
          winner: "NONE",
          betCloseTime: 456,
          contractAddress: "0x123",
          programId: null,
          txRef: null,
          syncedAt: 2,
        },
      ],
      updatedAt: 999,
    });

    expect(selectPredictionMarketLifecycleRecord(payload, "avax")?.marketRef).toBe(
      "avax:12",
    );
    expect(selectPredictionMarketLifecycleRecord(payload, "base")).toBeNull();
  });
});

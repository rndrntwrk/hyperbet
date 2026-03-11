import { describe, expect, it } from "bun:test";

import {
  normalizePredictionMarketDuelKeyHex,
  parsePredictionMarketsResponse,
  selectPredictionMarketLifecycleRecord,
} from "../src/lib/predictionMarkets";
import {
  derivePredictionMarketUiState,
  EMPTY_PREDICTION_MARKET_WALLET_SNAPSHOT,
} from "../src/lib/predictionMarketUiState";

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

describe("prediction market ui state", () => {
  it("allows trading but not claims while a market is open", () => {
    const payload = parsePredictionMarketsResponse({
      duel: {
        duelKey: "aa".repeat(32),
        duelId: "duel-open",
        phase: "ANNOUNCEMENT",
        winner: "NONE",
        betCloseTime: 123,
      },
      markets: [
        {
          chainKey: "bsc",
          duelKey: "aa".repeat(32),
          duelId: "duel-open",
          marketId: "market-open",
          marketRef: "market-open",
          lifecycleStatus: "OPEN",
          winner: "NONE",
          betCloseTime: 123,
          contractAddress: "0x123",
          programId: null,
          txRef: null,
          syncedAt: 1,
        },
      ],
      updatedAt: 1,
    });

    const uiState = derivePredictionMarketUiState(
      selectPredictionMarketLifecycleRecord(payload, "bsc"),
      EMPTY_PREDICTION_MARKET_WALLET_SNAPSHOT,
    );

    expect(uiState.canTrade).toBe(true);
    expect(uiState.canClaim).toBe(false);
    expect(uiState.claimKind).toBe("NONE");
  });

  it("keeps locked markets non-tradable and non-claimable", () => {
    const payload = parsePredictionMarketsResponse({
      duel: {
        duelKey: "bb".repeat(32),
        duelId: "duel-locked",
        phase: "COUNTDOWN",
        winner: "NONE",
        betCloseTime: 456,
      },
      markets: [
        {
          chainKey: "solana",
          duelKey: "bb".repeat(32),
          duelId: "duel-locked",
          marketId: "market-locked",
          marketRef: "market-locked",
          lifecycleStatus: "LOCKED",
          winner: "NONE",
          betCloseTime: 456,
          contractAddress: null,
          programId: "program-a",
          txRef: null,
          syncedAt: 2,
        },
      ],
      updatedAt: 2,
    });

    const uiState = derivePredictionMarketUiState(
      selectPredictionMarketLifecycleRecord(payload, "solana"),
      {
        aShares: 10n,
        bShares: 20n,
        refundableAmount: 30n,
      },
    );

    expect(uiState.canTrade).toBe(false);
    expect(uiState.canClaim).toBe(false);
    expect(uiState.claimableAmount).toBe(0n);
  });

  it("enables claims for resolved winner A balances", () => {
    const payload = parsePredictionMarketsResponse({
      duel: {
        duelKey: "cc".repeat(32),
        duelId: "duel-a",
        phase: "RESOLUTION",
        winner: "A",
        betCloseTime: 789,
      },
      markets: [
        {
          chainKey: "avax",
          duelKey: "cc".repeat(32),
          duelId: "duel-a",
          marketId: "market-a",
          marketRef: "market-a",
          lifecycleStatus: "RESOLVED",
          winner: "A",
          betCloseTime: 789,
          contractAddress: "0xabc",
          programId: null,
          txRef: null,
          syncedAt: 3,
        },
      ],
      updatedAt: 3,
    });

    const uiState = derivePredictionMarketUiState(
      selectPredictionMarketLifecycleRecord(payload, "avax"),
      {
        aShares: 25n,
        bShares: 0n,
        refundableAmount: 0n,
      },
    );

    expect(uiState.canTrade).toBe(false);
    expect(uiState.canClaim).toBe(true);
    expect(uiState.claimKind).toBe("WINNER_A");
    expect(uiState.claimableAmount).toBe(25n);
  });

  it("enables claims for resolved winner B balances", () => {
    const payload = parsePredictionMarketsResponse({
      duel: {
        duelKey: "dd".repeat(32),
        duelId: "duel-b",
        phase: "RESOLUTION",
        winner: "B",
        betCloseTime: 999,
      },
      markets: [
        {
          chainKey: "bsc",
          duelKey: "dd".repeat(32),
          duelId: "duel-b",
          marketId: "market-b",
          marketRef: "market-b",
          lifecycleStatus: "RESOLVED",
          winner: "B",
          betCloseTime: 999,
          contractAddress: "0xdef",
          programId: null,
          txRef: null,
          syncedAt: 4,
        },
      ],
      updatedAt: 4,
    });

    const uiState = derivePredictionMarketUiState(
      selectPredictionMarketLifecycleRecord(payload, "bsc"),
      {
        aShares: 0n,
        bShares: 42n,
        refundableAmount: 0n,
      },
    );

    expect(uiState.canClaim).toBe(true);
    expect(uiState.claimKind).toBe("WINNER_B");
    expect(uiState.claimableAmount).toBe(42n);
  });

  it("enables cancelled-market refunds from refundable balances", () => {
    const payload = parsePredictionMarketsResponse({
      duel: {
        duelKey: "ee".repeat(32),
        duelId: "duel-cancelled",
        phase: "RESOLUTION",
        winner: "NONE",
        betCloseTime: 1000,
      },
      markets: [
        {
          chainKey: "solana",
          duelKey: "ee".repeat(32),
          duelId: "duel-cancelled",
          marketId: "market-cancelled",
          marketRef: "market-cancelled",
          lifecycleStatus: "CANCELLED",
          winner: "NONE",
          betCloseTime: 1000,
          contractAddress: null,
          programId: "program-b",
          txRef: null,
          syncedAt: 5,
        },
      ],
      updatedAt: 5,
    });

    const uiState = derivePredictionMarketUiState(
      selectPredictionMarketLifecycleRecord(payload, "solana"),
      {
        aShares: 0n,
        bShares: 0n,
        refundableAmount: 11n,
      },
    );

    expect(uiState.canClaim).toBe(true);
    expect(uiState.claimKind).toBe("REFUND");
    expect(uiState.claimableAmount).toBe(11n);
  });

  it("falls back to chain-local lifecycle state when normalized state is missing", () => {
    const uiState = derivePredictionMarketUiState(
      null,
      EMPTY_PREDICTION_MARKET_WALLET_SNAPSHOT,
      {
        lifecycleStatus: "OPEN",
        winner: "NONE",
      },
    );

    expect(uiState.hasCanonicalLifecycle).toBe(false);
    expect(uiState.lifecycleStatus).toBe("OPEN");
    expect(uiState.canTrade).toBe(true);
  });

  it("keeps resolved EVM markets non-claimable when the winner has no shares", () => {
    const uiState = derivePredictionMarketUiState(
      null,
      {
        aShares: 0n,
        bShares: 0n,
        refundableAmount: 0n,
      },
      {
        lifecycleStatus: "RESOLVED",
        winner: "A",
      },
    );

    expect(uiState.canTrade).toBe(false);
    expect(uiState.canClaim).toBe(false);
    expect(uiState.claimableAmount).toBe(0n);
  });

  it("treats cancelled Solana locked lamports as refundable even without winning shares", () => {
    const uiState = derivePredictionMarketUiState(
      null,
      {
        aShares: 0n,
        bShares: 0n,
        refundableAmount: 9n,
      },
      {
        lifecycleStatus: "CANCELLED",
        winner: "NONE",
      },
    );

    expect(uiState.canClaim).toBe(true);
    expect(uiState.claimKind).toBe("REFUND");
    expect(uiState.claimableAmount).toBe(9n);
  });
});

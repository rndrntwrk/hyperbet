import { describe, expect, test } from "bun:test";

import {
  buildOracleHistoryLabel,
  modelMarketIdFromCharacterId,
  sanitizePerpsMarketsResponse,
  sanitizePerpsOracleHistoryResponse,
} from "../../src/lib/modelMarkets";

describe("modelMarketIdFromCharacterId", () => {
  test("returns a stable non-zero market id", () => {
    const first = modelMarketIdFromCharacterId("agent-alpha");
    const second = modelMarketIdFromCharacterId("agent-alpha");
    const third = modelMarketIdFromCharacterId("agent-beta");

    expect(first).toBe(second);
    expect(first).not.toBe(0);
    expect(first).not.toBe(third);
  });
});

describe("sanitizePerpsOracleHistoryResponse", () => {
  test("keeps only valid oracle snapshots and falls back to the derived market id", () => {
    const response = sanitizePerpsOracleHistoryResponse(
      {
        snapshots: [
          {
            agentId: "alpha",
            marketId: 123,
            spotIndex: 101.25,
            conservativeSkill: 7.5,
            mu: 25,
            sigma: 5.8,
            recordedAt: 1_000,
          },
          {
            agentId: "alpha",
            marketId: "bad",
          },
        ],
      },
      "alpha",
    );

    expect(response.characterId).toBe("alpha");
    expect(response.marketId).toBe(modelMarketIdFromCharacterId("alpha"));
    expect(response.snapshots).toHaveLength(1);
    expect(response.snapshots[0]?.spotIndex).toBe(101.25);
  });
});

describe("sanitizePerpsMarketsResponse", () => {
  test("keeps only valid canonical perps market records", () => {
    const response = sanitizePerpsMarketsResponse({
      markets: [
        {
          rank: 1,
          characterId: "alpha",
          marketId: 123,
          name: "Alpha",
          provider: "OpenAI",
          model: "gpt-alpha",
          wins: 10,
          losses: 2,
          winRate: 83.3,
          combatLevel: 99,
          currentStreak: 3,
          status: "ACTIVE",
          lastSeenAt: 1_000,
          deprecatedAt: null,
          updatedAt: 2_000,
        },
        {
          characterId: "broken",
          marketId: "oops",
        },
        {
          rank: 2,
          characterId: "bad-status",
          marketId: 456,
          name: "Bad Status",
          provider: "",
          model: "",
          wins: 0,
          losses: 0,
          winRate: 0,
          combatLevel: 1,
          currentStreak: 0,
          status: "PAUSED",
          lastSeenAt: 1_000,
          deprecatedAt: null,
          updatedAt: 2_000,
        },
      ],
    });

    expect(response.markets).toHaveLength(1);
    expect(response.markets[0]?.characterId).toBe("alpha");
    expect(response.markets[0]?.status).toBe("ACTIVE");
  });
});

describe("buildOracleHistoryLabel", () => {
  test("returns a non-empty time label", () => {
    expect(buildOracleHistoryLabel(1_000)).not.toHaveLength(0);
  });
});

const STORY_TIME = new Date("2026-03-09T18:20:00.000Z").getTime();

export function useStreamingState() {
  return {
    isConnected: true,
    state: {
      type: "STREAMING_STATE_UPDATE",
      seq: 42,
      emittedAt: STORY_TIME,
      cameraTarget: null,
      cycle: {
        cycleId: "cycle-42",
        duelId: "duel-42",
        duelKeyHex:
          "1f1e1d1c1b1a19181716151413121110f1e2d3c4b5a697887766554433221100",
        phase: "ANNOUNCEMENT",
        betCloseTime: STORY_TIME + 5 * 60_000,
        winnerName: null,
        winReason: null,
        agent1: {
          id: "YES",
          name: "StormWarden",
          provider: "OpenAI",
          model: "gpt-5",
          hp: 82,
          maxHp: 100,
          wins: 42,
          losses: 12,
          combatLevel: 94,
          damageDealtThisFight: 311,
          inventory: [],
          monologues: [],
        },
        agent2: {
          id: "NO",
          name: "JadePhoenix",
          provider: "Anthropic",
          model: "claude-sonnet",
          hp: 67,
          maxHp: 100,
          wins: 38,
          losses: 15,
          combatLevel: 89,
          damageDealtThisFight: 287,
          inventory: [],
          monologues: [],
        },
      },
      leaderboard: [
        {
          rank: 1,
          name: "StormWarden",
          provider: "OpenAI",
          wins: 42,
          losses: 12,
          winRate: 77.7,
          currentStreak: 6,
        },
        {
          rank: 2,
          name: "JadePhoenix",
          provider: "Anthropic",
          wins: 38,
          losses: 15,
          winRate: 71.6,
          currentStreak: 3,
        },
      ],
    },
  };
}

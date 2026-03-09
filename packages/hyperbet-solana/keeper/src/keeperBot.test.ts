import { expect, test } from "bun:test";

import { buildKeeperBotChildEnv } from "./keeperBot";

test("buildKeeperBotChildEnv forces loop mode and preserves explicit GAME_URL", () => {
  const env = buildKeeperBotChildEnv(
    {
      BOT_LOOP: "false",
      GAME_URL: "https://example.test/game",
      ENABLE_KEEPER_BOT: "true",
    },
    5555,
  );

  expect(env.BOT_LOOP).toBe("true");
  expect(env.GAME_URL).toBe("https://example.test/game");
  expect(env.ENABLE_KEEPER_BOT).toBe("true");
});

test("buildKeeperBotChildEnv defaults GAME_URL to the local service port", () => {
  const env = buildKeeperBotChildEnv({}, 7000);
  expect(env.BOT_LOOP).toBe("true");
  expect(env.GAME_URL).toBe("http://127.0.0.1:7000");
});

export function buildKeeperBotChildEnv(
  baseEnv: Record<string, string | undefined>,
  port: number,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries({
      ...baseEnv,
      BOT_LOOP: "true",
      GAME_URL: baseEnv.GAME_URL || `http://127.0.0.1:${port}`,
    }).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}

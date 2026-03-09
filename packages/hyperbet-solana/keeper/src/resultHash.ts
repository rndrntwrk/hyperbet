import { createHash } from "node:crypto";

export function buildResultHash(
  duelKeyHex: string,
  winnerSide: "A" | "B",
  seed: string,
  replayHashHex: string,
): number[] {
  return Array.from(
    createHash("sha256")
      .update(
        JSON.stringify({
          duelKeyHex: duelKeyHex.trim().toLowerCase(),
          winnerSide,
          seed,
          replayHashHex: replayHashHex.trim().toLowerCase(),
        }),
      )
      .digest(),
  );
}

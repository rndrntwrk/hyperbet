import { expect, test } from "bun:test";

import { buildResultHash } from "./resultHash";

test("buildResultHash normalizes duel and replay hashes into the canonical schema", () => {
  const canonical = buildResultHash(
    "ab".repeat(32),
    "A",
    "42",
    "cd".repeat(32),
  );
  const mixedCase = buildResultHash(
    "AB".repeat(32),
    "A",
    "42",
    "CD".repeat(32),
  );

  expect(mixedCase).toEqual(canonical);
});

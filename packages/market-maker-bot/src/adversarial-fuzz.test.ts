import { describe, expect, it } from "vitest";

import { runAdversarialSuite, SCENARIOS } from "./simulate-adversarial.js";
import { evaluateRegressionSeeds, readRegressionSeeds } from "./adversarial/regression-seeds.js";

function seedWindow(start: number, count: number): number[] {
  return Array.from({ length: count }, (_, index) => start + index);
}

describe("adversarial long-horizon fuzz and seed corpus", () => {
  it("maintains full mitigation coverage across long deterministic seed windows", () => {
    const seeds = seedWindow(20260311, 48);

    for (const seed of seeds) {
      const report = runAdversarialSuite(seed);
      expect(report.summary.totalScenarios).toBe(3 * SCENARIOS.length);
      expect(report.summary.mitigationPasses).toBe(3 * SCENARIOS.length);
    }
  });

  it("passes curated known-bad regression seed corpus per chain", () => {
    const scopes: Array<"solana" | "bsc" | "avax"> = ["solana", "bsc", "avax"];
    for (const scope of scopes) {
      const seeds = readRegressionSeeds(undefined, scope);
      const failures = evaluateRegressionSeeds(seeds, scope);
      expect(failures).toEqual([]);
    }
  });

  it("passes global seed corpus for all-chain gate replay", () => {
    const seeds = readRegressionSeeds();
    expect(evaluateRegressionSeeds(seeds)).toEqual([]);
  });
});

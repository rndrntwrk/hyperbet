import { describe, expect, it } from "vitest";

import { runAdversarialSuite } from "./simulate-adversarial.js";
import { evaluateBoundedLossBreaches } from "./adversarial/bounded-loss.js";

describe("adversarial bounded-loss gates", () => {
  it("passes bounded-loss budgets on baseline hardened suite", () => {
    const report = runAdversarialSuite(20260311);
    const breaches = evaluateBoundedLossBreaches(report);

    expect(breaches).toEqual([]);
  });

  it("flags single-scenario loss budget blowout", () => {
    const report = runAdversarialSuite(20260311);
    const candidate = structuredClone(report);
    candidate.chains[0]!.scenarios[0]!.mitigated.attackerPnl += 120;

    const breaches = evaluateBoundedLossBreaches(candidate);
    expect(breaches.some((entry) => entry.scope === "scenario")).toBe(true);
  });

  it("flags chain aggregate risk budget blowout", () => {
    const report = runAdversarialSuite(20260311);
    const candidate = structuredClone(report);
    for (const scenario of candidate.chains[2]!.scenarios) {
      scenario.mitigated.attackerPnl += 45;
    }

    const breaches = evaluateBoundedLossBreaches(candidate);
    expect(breaches.some((entry) => entry.scope === "chain_aggregate")).toBe(true);
  });
});


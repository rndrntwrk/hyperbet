import { describe, expect, it } from "vitest";

import { runAdversarialSuite } from "./simulate-adversarial.js";
import { evaluateChaosBreaches } from "./adversarial/chaos.js";

describe("adversarial chaos-resilience gates", () => {
  it("passes chaos controls on hardened suite", () => {
    const report = runAdversarialSuite(20260311);
    const breaches = evaluateChaosBreaches(report);

    expect(breaches).toEqual([]);
  });

  it("flags oracle outage damage regression", () => {
    const report = runAdversarialSuite(20260311);
    const candidate = structuredClone(report);
    const scenario = candidate.chains[0]?.scenarios.find(
      (entry) => entry.scenario === "stale_signal_arbitrage",
    );
    expect(scenario).toBeDefined();
    scenario!.mitigated.attackerPnl += 120;

    const breaches = evaluateChaosBreaches(candidate);
    expect(
      breaches.some(
        (entry) => entry.control === "chaos.oracle_outage.max_damage_score",
      ),
    ).toBe(true);
  });

  it("flags finality jitter damage regression", () => {
    const report = runAdversarialSuite(20260311);
    const candidate = structuredClone(report);
    const scenario = candidate.chains[1]?.scenarios.find(
      (entry) => entry.scenario === "gas_auction_backrun",
    );
    expect(scenario).toBeDefined();
    scenario!.mitigated.avgAdverseSlippageBps += 300;

    const breaches = evaluateChaosBreaches(candidate);
    expect(
      breaches.some(
        (entry) => entry.control === "chaos.finality_jitter.max_damage_score",
      ),
    ).toBe(true);
  });

  it("flags liquidity cliff inventory stress regression", () => {
    const report = runAdversarialSuite(20260311);
    const candidate = structuredClone(report);
    const liquidation = candidate.chains[2]?.scenarios.find(
      (entry) => entry.scenario === "liquidation_cascade",
    );
    const resolution = candidate.chains[2]?.scenarios.find(
      (entry) => entry.scenario === "coordinated_resolution_push",
    );
    expect(liquidation).toBeDefined();
    expect(resolution).toBeDefined();
    liquidation!.mitigated.inventoryPeak += 30;
    resolution!.mitigated.inventoryPeak += 10;

    const breaches = evaluateChaosBreaches(candidate);
    expect(
      breaches.some(
        (entry) => entry.control === "chaos.liquidity_cliff.max_inventory_stress",
      ),
    ).toBe(true);
  });
});

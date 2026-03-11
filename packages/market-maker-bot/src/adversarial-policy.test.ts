import { describe, expect, it } from "vitest";

import { runAdversarialSuite } from "./simulate-adversarial.js";
import { evaluatePolicyBreaches } from "./adversarial/policy.js";

describe("adversarial policy gates", () => {
  it("passes oracle/finality/dispute policies across all chains", () => {
    const report = runAdversarialSuite(20260311);
    const breaches = evaluatePolicyBreaches(report);

    expect(breaches).toEqual([]);
  });

  it("flags stale-oracle execution regression", () => {
    const report = runAdversarialSuite(20260311);
    const candidate = structuredClone(report);
    const stale = candidate.chains[0]?.scenarios.find(
      (entry) => entry.scenario === "stale_signal_arbitrage",
    );
    expect(stale).toBeDefined();
    stale!.mitigated.exploitEvents += 80;

    const breaches = evaluatePolicyBreaches(candidate);
    expect(
      breaches.some((entry) => entry.control === "oracle.max_age_seconds"),
    ).toBe(true);
  });

  it("flags unfinalized settlement risk in gas-backrun conditions", () => {
    const report = runAdversarialSuite(20260311);
    const candidate = structuredClone(report);
    const gas = candidate.chains[2]?.scenarios.find(
      (entry) => entry.scenario === "gas_auction_backrun",
    );
    expect(gas).toBeDefined();
    gas!.mitigated.exploitEvents += 40;

    const breaches = evaluatePolicyBreaches(candidate);
    expect(
      breaches.some(
        (entry) =>
          entry.control === "settlement.required_commitment" ||
          entry.control === "oracle.max_same_slot_round_trips",
      ),
    ).toBe(true);
  });

  it("flags dispute liveness compression under liquidation pressure", () => {
    const report = runAdversarialSuite(20260311);
    const candidate = structuredClone(report);
    const liquidation = candidate.chains[1]?.scenarios.find(
      (entry) => entry.scenario === "liquidation_cascade",
    );
    expect(liquidation).toBeDefined();
    liquidation!.mitigated.exploitEvents += 40;

    const breaches = evaluatePolicyBreaches(candidate);
    expect(
      breaches.some(
        (entry) => entry.control === "resolution.min_dispute_liveness_seconds",
      ),
    ).toBe(true);
  });
});

import { describe, expect, it } from "vitest";

import { runAdversarialSuite } from "./simulate-adversarial.js";
import { evaluateMatrixBreaches } from "./adversarial/matrix.js";
import { SCENARIO_RISK_BUDGETS } from "./adversarial/spec.js";

describe("adversarial deterministic matrix gate", () => {
  it("passes matrix budgets on hardened suite", () => {
    const report = runAdversarialSuite(20260311);
    const breaches = evaluateMatrixBreaches(report);

    expect(breaches).toEqual([]);
  });

  it("flags scenario budget regressions deterministically", () => {
    const report = runAdversarialSuite(20260311);
    const candidate = structuredClone(report);
    const scenario = candidate.chains[2]?.scenarios.find(
      (entry) => entry.scenario === "coordinated_resolution_push",
    );
    expect(scenario).toBeDefined();
    scenario!.mitigated.exploitEvents =
      SCENARIO_RISK_BUDGETS.coordinated_resolution_push.maxExploitEvents + 5;

    const breaches = evaluateMatrixBreaches(candidate);
    expect(
      breaches.some(
        (entry) =>
          entry.scenario === "coordinated_resolution_push" &&
          entry.control === "matrix.scenario.max_exploit_events",
      ),
    ).toBe(true);
  });
});

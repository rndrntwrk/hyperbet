import { describe, expect, it } from "vitest";

import { runAdversarialSuite } from "./simulate-adversarial.js";
import {
  evaluateSettlementBreaches,
  validateSettlementTrace,
} from "./adversarial/settlement.js";

describe("adversarial settlement gates", () => {
  it("passes inferred settlement traces for all chains", () => {
    const report = runAdversarialSuite(20260311);
    const breaches = evaluateSettlementBreaches(report);

    expect(breaches).toEqual([]);
  });

  it("rejects invalid state machine transitions", () => {
    const breaches = validateSettlementTrace(
      "solana",
      [
        { state: "open", atSeconds: 0 },
        { state: "finalized", atSeconds: 40 },
      ],
      300,
    );

    expect(
      breaches.some((entry) => entry.control === "state_machine.transition"),
    ).toBe(true);
  });

  it("flags finalize-before-dispute-window under stress regression", () => {
    const report = runAdversarialSuite(20260311);
    const candidate = structuredClone(report);
    const gas = candidate.chains[2]?.scenarios.find(
      (entry) => entry.scenario === "gas_auction_backrun",
    );
    expect(gas).toBeDefined();
    gas!.mitigated.exploitEvents += 55;

    const breaches = evaluateSettlementBreaches(candidate);
    expect(
      breaches.some(
        (entry) =>
          entry.control === "state_machine.finalize_after_dispute_window",
      ),
    ).toBe(true);
  });
});


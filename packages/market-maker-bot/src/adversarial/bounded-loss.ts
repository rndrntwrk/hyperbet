import { CHAIN_PROFILES, MITIGATED_GUARDS, SCENARIOS } from "./config.js";
import type { ChainId, ChainProfile, ScenarioRun, SuiteReport } from "./types.js";

export type BoundedLossBudget = {
  perScenarioCap: number;
  chainAggregateCap: number;
};

export type BoundedLossBreach = {
  chain: ChainId;
  scope: "scenario" | "chain_aggregate";
  scenario?: ScenarioRun["scenario"];
  expected: string;
  actual: number;
};

function chainProfile(chain: ChainId): ChainProfile {
  const profile = CHAIN_PROFILES.find((entry) => entry.chain === chain);
  if (!profile) {
    throw new Error(`missing chain profile for ${chain}`);
  }
  return profile;
}

function computeBudget(chain: ChainProfile): BoundedLossBudget {
  const perScenarioCap =
    MITIGATED_GUARDS.inventoryCap *
      (0.2 + chain.riskMultiplier * 0.12 + chain.mevRisk * 0.1) +
    chain.baseSpreadBps * 0.25;
  const chainAggregateCap = perScenarioCap * SCENARIOS.length * 0.55;
  return {
    perScenarioCap: Number(perScenarioCap.toFixed(2)),
    chainAggregateCap: Number(chainAggregateCap.toFixed(2)),
  };
}

export function evaluateBoundedLossBreaches(report: SuiteReport): BoundedLossBreach[] {
  const breaches: BoundedLossBreach[] = [];

  for (const chainReport of report.chains) {
    const profile = chainProfile(chainReport.chain);
    const budget = computeBudget(profile);

    for (const scenario of chainReport.scenarios) {
      if (scenario.mitigated.attackerPnl > budget.perScenarioCap) {
        breaches.push({
          chain: chainReport.chain,
          scope: "scenario",
          scenario: scenario.scenario,
          expected: `<= ${budget.perScenarioCap}`,
          actual: scenario.mitigated.attackerPnl,
        });
      }
    }

    const aggregateLoss = chainReport.scenarios.reduce(
      (acc, scenario) => acc + scenario.mitigated.attackerPnl,
      0,
    );
    if (aggregateLoss > budget.chainAggregateCap) {
      breaches.push({
        chain: chainReport.chain,
        scope: "chain_aggregate",
        expected: `<= ${budget.chainAggregateCap}`,
        actual: Number(aggregateLoss.toFixed(6)),
      });
    }
  }

  return breaches;
}


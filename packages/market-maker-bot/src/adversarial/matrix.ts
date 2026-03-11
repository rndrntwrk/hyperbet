import { CHAIN_RISK_BUDGETS, SCENARIO_RISK_BUDGETS } from "./spec.js";
import type { ChainId, ScenarioRun, SuiteReport } from "./types.js";

export type MatrixBreach = {
  chain: ChainId;
  scenario: ScenarioRun["scenario"] | "aggregate";
  control: string;
  expected: string;
  actual: number;
};

function pctReduction(run: ScenarioRun): number {
  if (run.baseline.attackerPnl <= 0) {
    return 1;
  }
  return 1 - run.mitigated.attackerPnl / run.baseline.attackerPnl;
}

function round(value: number): number {
  return Number(value.toFixed(4));
}

export function evaluateMatrixBreaches(report: SuiteReport): MatrixBreach[] {
  const breaches: MatrixBreach[] = [];

  for (const chainReport of report.chains) {
    const chainBudget = CHAIN_RISK_BUDGETS[chainReport.chain];
    const aggregateAttackerPnl = chainReport.scenarios.reduce(
      (sum, entry) => sum + entry.mitigated.attackerPnl,
      0,
    );
    const aggregateExploitEvents = chainReport.scenarios.reduce(
      (sum, entry) => sum + entry.mitigated.exploitEvents,
      0,
    );
    const aggregateInventoryPeak = chainReport.scenarios.reduce(
      (sum, entry) => sum + entry.mitigated.inventoryPeak,
      0,
    );

    if (aggregateAttackerPnl > chainBudget.maxAggregateMitigatedAttackerPnl) {
      breaches.push({
        chain: chainReport.chain,
        scenario: "aggregate",
        control: "matrix.chain.max_aggregate_mitigated_attacker_pnl",
        expected: `<= ${chainBudget.maxAggregateMitigatedAttackerPnl}`,
        actual: round(aggregateAttackerPnl),
      });
    }
    if (aggregateExploitEvents > chainBudget.maxAggregateExploitEvents) {
      breaches.push({
        chain: chainReport.chain,
        scenario: "aggregate",
        control: "matrix.chain.max_aggregate_exploit_events",
        expected: `<= ${chainBudget.maxAggregateExploitEvents}`,
        actual: round(aggregateExploitEvents),
      });
    }
    if (aggregateInventoryPeak > chainBudget.maxAggregateInventoryPeak) {
      breaches.push({
        chain: chainReport.chain,
        scenario: "aggregate",
        control: "matrix.chain.max_aggregate_inventory_peak",
        expected: `<= ${chainBudget.maxAggregateInventoryPeak}`,
        actual: round(aggregateInventoryPeak),
      });
    }

    for (const scenario of chainReport.scenarios) {
      const budget = SCENARIO_RISK_BUDGETS[scenario.scenario];
      if (scenario.mitigated.attackerPnl > budget.maxMitigatedAttackerPnl) {
        breaches.push({
          chain: chainReport.chain,
          scenario: scenario.scenario,
          control: "matrix.scenario.max_mitigated_attacker_pnl",
          expected: `<= ${budget.maxMitigatedAttackerPnl}`,
          actual: round(scenario.mitigated.attackerPnl),
        });
      }
      if (scenario.mitigated.exploitEvents > budget.maxExploitEvents) {
        breaches.push({
          chain: chainReport.chain,
          scenario: scenario.scenario,
          control: "matrix.scenario.max_exploit_events",
          expected: `<= ${budget.maxExploitEvents}`,
          actual: round(scenario.mitigated.exploitEvents),
        });
      }
      if (scenario.mitigated.toxicFillRate > budget.maxToxicFillRate) {
        breaches.push({
          chain: chainReport.chain,
          scenario: scenario.scenario,
          control: "matrix.scenario.max_toxic_fill_rate",
          expected: `<= ${budget.maxToxicFillRate}`,
          actual: round(scenario.mitigated.toxicFillRate),
        });
      }
      if (
        scenario.mitigated.avgAdverseSlippageBps > budget.maxAdverseSlippageBps
      ) {
        breaches.push({
          chain: chainReport.chain,
          scenario: scenario.scenario,
          control: "matrix.scenario.max_adverse_slippage_bps",
          expected: `<= ${budget.maxAdverseSlippageBps}`,
          actual: round(scenario.mitigated.avgAdverseSlippageBps),
        });
      }
      const reduction = pctReduction(scenario);
      if (reduction < budget.minAttackerPnlReductionRatio) {
        breaches.push({
          chain: chainReport.chain,
          scenario: scenario.scenario,
          control: "matrix.scenario.min_attacker_pnl_reduction_ratio",
          expected: `>= ${budget.minAttackerPnlReductionRatio}`,
          actual: round(reduction),
        });
      }
    }
  }

  return breaches;
}

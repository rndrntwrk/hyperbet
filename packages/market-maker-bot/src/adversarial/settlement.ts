import { CHAIN_PROFILES } from "./config.js";
import type { ChainId, ChainProfile, ScenarioRun, SuiteReport } from "./types.js";

export type SettlementState =
  | "open"
  | "resolve_proposed"
  | "dispute_window"
  | "finalized";

export type SettlementEvent = {
  state: SettlementState;
  atSeconds: number;
};

export type SettlementBreach = {
  chain: ChainId;
  control:
    | "state_machine.transition"
    | "state_machine.time_order"
    | "state_machine.finalize_after_dispute_window";
  expected: string;
  actual: string | number;
};

const VALID_TRANSITIONS: Record<SettlementState, SettlementState[]> = {
  open: ["resolve_proposed"],
  resolve_proposed: ["dispute_window"],
  dispute_window: ["finalized"],
  finalized: [],
};

function chainProfile(chain: ChainId): ChainProfile {
  const profile = CHAIN_PROFILES.find((entry) => entry.chain === chain);
  if (!profile) {
    throw new Error(`missing chain profile for ${chain}`);
  }
  return profile;
}

function scenarioById(scenarios: ScenarioRun[], id: ScenarioRun["scenario"]): ScenarioRun {
  const scenario = scenarios.find((entry) => entry.scenario === id);
  if (!scenario) {
    throw new Error(`missing scenario ${id}`);
  }
  return scenario;
}

function minimumDisputeWindowSeconds(chain: ChainProfile): number {
  return Math.round(240 + chain.settlementLagTicks * 20 + chain.mevRisk * 50);
}

function inferSettlementTrace(chain: ChainProfile, scenarios: ScenarioRun[]): SettlementEvent[] {
  const liquidation = scenarioById(scenarios, "liquidation_cascade");
  const gas = scenarioById(scenarios, "gas_auction_backrun");
  const proposalAt = 60 + liquidation.mitigated.exploitEvents;
  const disputeOpenedAt = proposalAt + 20;
  const finalizeDelay = Math.max(120, 500 - gas.mitigated.exploitEvents * 8);
  const finalizedAt = proposalAt + finalizeDelay;

  return [
    { state: "open", atSeconds: 0 },
    { state: "resolve_proposed", atSeconds: proposalAt },
    { state: "dispute_window", atSeconds: disputeOpenedAt },
    { state: "finalized", atSeconds: finalizedAt },
  ];
}

export function validateSettlementTrace(
  chain: ChainId,
  events: SettlementEvent[],
  minDisputeWindowSeconds: number,
): SettlementBreach[] {
  const breaches: SettlementBreach[] = [];
  if (events.length < 2) {
    return breaches;
  }

  for (let index = 1; index < events.length; index += 1) {
    const previous = events[index - 1]!;
    const current = events[index]!;
    const allowed = VALID_TRANSITIONS[previous.state];

    if (!allowed.includes(current.state)) {
      breaches.push({
        chain,
        control: "state_machine.transition",
        expected: `${previous.state} -> ${allowed.join("|") || "<end>"}`,
        actual: `${previous.state} -> ${current.state}`,
      });
    }

    if (current.atSeconds <= previous.atSeconds) {
      breaches.push({
        chain,
        control: "state_machine.time_order",
        expected: `>${previous.atSeconds}`,
        actual: current.atSeconds,
      });
    }
  }

  const proposed = events.find((entry) => entry.state === "resolve_proposed");
  const finalized = events.find((entry) => entry.state === "finalized");
  if (proposed && finalized) {
    const disputeWindow = finalized.atSeconds - proposed.atSeconds;
    if (disputeWindow < minDisputeWindowSeconds) {
      breaches.push({
        chain,
        control: "state_machine.finalize_after_dispute_window",
        expected: `>= ${minDisputeWindowSeconds}`,
        actual: disputeWindow,
      });
    }
  }

  return breaches;
}

export function evaluateSettlementBreaches(report: SuiteReport): SettlementBreach[] {
  const breaches: SettlementBreach[] = [];

  for (const chainReport of report.chains) {
    const profile = chainProfile(chainReport.chain);
    const trace = inferSettlementTrace(profile, chainReport.scenarios);
    breaches.push(
      ...validateSettlementTrace(
        chainReport.chain,
        trace,
        minimumDisputeWindowSeconds(profile),
      ),
    );
  }

  return breaches;
}

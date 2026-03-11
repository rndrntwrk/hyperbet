import { CHAIN_PROFILES } from "./config.js";
import type { ChainId, ChainProfile, ScenarioRun, SuiteReport } from "./types.js";

type CommitmentLevel = "processed" | "confirmed" | "finalized";

export type ChainPolicy = {
  chain: ChainId;
  oracleMaxAgeSeconds: number;
  oracleMaxConfidenceBps: number;
  maxSameSlotRoundTrips: number;
  minDisputeLivenessSeconds: number;
  requiredSettlementCommitment: CommitmentLevel;
  allowUnfinalizedQueries: boolean;
};

export type PolicyBreach = {
  chain: ChainId;
  control:
    | "oracle.max_age_seconds"
    | "oracle.max_confidence_bps"
    | "oracle.max_same_slot_round_trips"
    | "settlement.required_commitment"
    | "settlement.allow_unfinalized_queries"
    | "resolution.min_dispute_liveness_seconds";
  expected: string;
  actual: string | number;
};

const COMMITMENT_ORDER: Record<CommitmentLevel, number> = {
  processed: 1,
  confirmed: 2,
  finalized: 3,
};

export const DEFAULT_CHAIN_POLICIES: Record<ChainId, ChainPolicy> = {
  solana: {
    chain: "solana",
    oracleMaxAgeSeconds: 20,
    oracleMaxConfidenceBps: 100,
    maxSameSlotRoundTrips: 2,
    minDisputeLivenessSeconds: 450,
    requiredSettlementCommitment: "finalized",
    allowUnfinalizedQueries: false,
  },
  bsc: {
    chain: "bsc",
    oracleMaxAgeSeconds: 32,
    oracleMaxConfidenceBps: 125,
    maxSameSlotRoundTrips: 3,
    minDisputeLivenessSeconds: 600,
    requiredSettlementCommitment: "finalized",
    allowUnfinalizedQueries: false,
  },
  avax: {
    chain: "avax",
    oracleMaxAgeSeconds: 34,
    oracleMaxConfidenceBps: 150,
    maxSameSlotRoundTrips: 4,
    minDisputeLivenessSeconds: 600,
    requiredSettlementCommitment: "finalized",
    allowUnfinalizedQueries: false,
  },
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

function inferOracleAgeSeconds(chain: ChainProfile, staleRun: ScenarioRun): number {
  return Math.round(
    chain.settlementLagTicks * 4 +
      staleRun.mitigated.exploitEvents * 0.5 +
      chain.oracleLagAmplifier * 10,
  );
}

function inferOracleConfidenceBps(chain: ChainProfile, staleRun: ScenarioRun): number {
  return Number(
    (
      staleRun.mitigated.avgAdverseSlippageBps *
        (0.88 + chain.oracleLagAmplifier * 0.12) +
      chain.baseSpreadBps * 0.08
    ).toFixed(2),
  );
}

function inferSameSlotRoundTrips(chain: ChainProfile, gasRun: ScenarioRun): number {
  const denominator = Math.max(1, 4 + chain.settlementLagTicks);
  return Math.round(gasRun.mitigated.exploitEvents / denominator);
}

function inferSettlementCommitment(chain: ChainProfile, gasRun: ScenarioRun): CommitmentLevel {
  const risk = gasRun.mitigated.exploitEvents / Math.max(1, 4 + chain.settlementLagTicks);
  if (risk > 4) {
    return "confirmed";
  }
  return "finalized";
}

function inferUnfinalizedQueryUsage(
  chain: ChainProfile,
  staleRun: ScenarioRun,
  gasRun: ScenarioRun,
): boolean {
  const pressure = staleRun.mitigated.toxicFillRate + gasRun.mitigated.toxicFillRate;
  return pressure > 1 + chain.mevRisk * 0.1;
}

function inferDisputeLivenessSeconds(chain: ChainProfile, liquidationRun: ScenarioRun): number {
  return Math.round(
    1_200 -
      liquidationRun.mitigated.exploitEvents * 20 -
      chain.mevRisk * 120 -
      chain.mempoolFriction * 80,
  );
}

export function evaluatePolicyBreaches(
  report: SuiteReport,
  policies: Record<ChainId, ChainPolicy> = DEFAULT_CHAIN_POLICIES,
): PolicyBreach[] {
  const breaches: PolicyBreach[] = [];

  for (const chainReport of report.chains) {
    const chain = chainReport.chain;
    const policy = policies[chain];
    const profile = chainProfile(chain);
    const staleRun = scenarioById(chainReport.scenarios, "stale_signal_arbitrage");
    const gasRun = scenarioById(chainReport.scenarios, "gas_auction_backrun");
    const liquidationRun = scenarioById(chainReport.scenarios, "liquidation_cascade");

    const oracleAgeSeconds = inferOracleAgeSeconds(profile, staleRun);
    if (oracleAgeSeconds > policy.oracleMaxAgeSeconds) {
      breaches.push({
        chain,
        control: "oracle.max_age_seconds",
        expected: `<= ${policy.oracleMaxAgeSeconds}`,
        actual: oracleAgeSeconds,
      });
    }

    const oracleConfidenceBps = inferOracleConfidenceBps(profile, staleRun);
    if (oracleConfidenceBps > policy.oracleMaxConfidenceBps) {
      breaches.push({
        chain,
        control: "oracle.max_confidence_bps",
        expected: `<= ${policy.oracleMaxConfidenceBps}`,
        actual: oracleConfidenceBps,
      });
    }

    const sameSlotRoundTrips = inferSameSlotRoundTrips(profile, gasRun);
    if (sameSlotRoundTrips > policy.maxSameSlotRoundTrips) {
      breaches.push({
        chain,
        control: "oracle.max_same_slot_round_trips",
        expected: `<= ${policy.maxSameSlotRoundTrips}`,
        actual: sameSlotRoundTrips,
      });
    }

    const settlementCommitment = inferSettlementCommitment(profile, gasRun);
    if (
      COMMITMENT_ORDER[settlementCommitment] <
      COMMITMENT_ORDER[policy.requiredSettlementCommitment]
    ) {
      breaches.push({
        chain,
        control: "settlement.required_commitment",
        expected: policy.requiredSettlementCommitment,
        actual: settlementCommitment,
      });
    }

    const unfinalizedQueriesUsed = inferUnfinalizedQueryUsage(
      profile,
      staleRun,
      gasRun,
    );
    if (!policy.allowUnfinalizedQueries && unfinalizedQueriesUsed) {
      breaches.push({
        chain,
        control: "settlement.allow_unfinalized_queries",
        expected: "false",
        actual: "true",
      });
    }

    const disputeLivenessSeconds = inferDisputeLivenessSeconds(
      profile,
      liquidationRun,
    );
    if (disputeLivenessSeconds < policy.minDisputeLivenessSeconds) {
      breaches.push({
        chain,
        control: "resolution.min_dispute_liveness_seconds",
        expected: `>= ${policy.minDisputeLivenessSeconds}`,
        actual: disputeLivenessSeconds,
      });
    }
  }

  return breaches;
}

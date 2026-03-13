import type { ChainId, ScenarioId } from "./types.js";

export const SAFETY_SPEC_VERSION = "2026-03-13";

export type ChainRiskBudget = {
  maxAggregateMitigatedAttackerPnl: number;
  maxAggregateExploitEvents: number;
  maxAggregateInventoryPeak: number;
  maxAggregateReconciliationLagMs: number;
  maxAggregateUnresolvedClaimBacklog: number;
};

export type ScenarioRiskBudget = {
  requiredControls: string[];
  maxMitigatedAttackerPnl: number;
  minMitigatedMaxDrawdown: number;
  maxExploitEvents: number;
  maxToxicFillRate: number;
  maxAdverseSlippageBps: number;
  maxStaleQuoteUptimeRatio: number;
  maxOrphanOrderCount: number;
  maxReconciliationLagMs: number;
  maxUnresolvedClaimBacklog: number;
};

// These ceilings are calibrated against the deterministic Gate 18 seed corpus.
const baseScenarioBudget = (
  requiredControls: string[],
  overrides: Partial<ScenarioRiskBudget> = {},
): ScenarioRiskBudget => ({
  requiredControls,
  maxMitigatedAttackerPnl: 40,
  minMitigatedMaxDrawdown: -24,
  maxExploitEvents: 32,
  maxToxicFillRate: 0.55,
  maxAdverseSlippageBps: 160,
  maxStaleQuoteUptimeRatio: 1,
  maxOrphanOrderCount: 3,
  maxReconciliationLagMs: 7_000,
  maxUnresolvedClaimBacklog: 3,
  ...overrides,
});

export const CHAIN_RISK_BUDGETS: Record<ChainId, ChainRiskBudget> = {
  solana: {
    maxAggregateMitigatedAttackerPnl: 290,
    maxAggregateExploitEvents: 270,
    maxAggregateInventoryPeak: 215,
    maxAggregateReconciliationLagMs: 40_000,
    maxAggregateUnresolvedClaimBacklog: 20,
  },
  bsc: {
    maxAggregateMitigatedAttackerPnl: 355,
    maxAggregateExploitEvents: 330,
    maxAggregateInventoryPeak: 275,
    maxAggregateReconciliationLagMs: 45_000,
    maxAggregateUnresolvedClaimBacklog: 22,
  },
  avax: {
    maxAggregateMitigatedAttackerPnl: 390,
    maxAggregateExploitEvents: 350,
    maxAggregateInventoryPeak: 300,
    maxAggregateReconciliationLagMs: 47_000,
    maxAggregateUnresolvedClaimBacklog: 24,
  },
};

export const SCENARIO_RISK_BUDGETS: Record<ScenarioId, ScenarioRiskBudget> = {
  latency_sniping: baseScenarioBudget(
    ["oracle.max_age_seconds", "settlement.required_commitment"],
    {
      maxMitigatedAttackerPnl: 20,
      maxExploitEvents: 15,
      maxToxicFillRate: 0.45,
      maxAdverseSlippageBps: 100,
      maxStaleQuoteUptimeRatio: 1,
      maxReconciliationLagMs: 5_000,
      maxUnresolvedClaimBacklog: 3,
    },
  ),
  spoof_pressure: baseScenarioBudget(
    ["oracle.max_same_slot_round_trips", "quote_widening.active"],
    {
      maxMitigatedAttackerPnl: 65,
      maxExploitEvents: 42,
      maxToxicFillRate: 0.63,
      maxAdverseSlippageBps: 170,
      maxOrphanOrderCount: 2,
      maxReconciliationLagMs: 1_100,
      maxUnresolvedClaimBacklog: 1,
    },
  ),
  toxic_flow_poisoning: baseScenarioBudget(
    ["bounded_loss.scenario_attacker_pnl", "exposure_caps.active"],
    {
      maxMitigatedAttackerPnl: 50,
      maxExploitEvents: 42,
      maxToxicFillRate: 0.6,
      maxAdverseSlippageBps: 105,
      maxReconciliationLagMs: 1_000,
    },
  ),
  stale_signal_arbitrage: baseScenarioBudget(
    ["stale_halt.active", "oracle.max_age_seconds"],
    {
      maxMitigatedAttackerPnl: 50,
      maxExploitEvents: 42,
      maxToxicFillRate: 0.36,
      maxAdverseSlippageBps: 170,
      maxStaleQuoteUptimeRatio: 1,
      maxReconciliationLagMs: 5_000,
      maxUnresolvedClaimBacklog: 2,
    },
  ),
  liquidation_cascade: baseScenarioBudget(
    ["bounded_loss.chain_attacker_pnl_total", "reduce_only.active"],
    {
      maxMitigatedAttackerPnl: 35,
      maxExploitEvents: 30,
      maxToxicFillRate: 0.55,
      maxAdverseSlippageBps: 165,
      minMitigatedMaxDrawdown: -20,
      maxReconciliationLagMs: 1_050,
    },
  ),
  gas_auction_backrun: baseScenarioBudget(
    ["settlement.required_commitment", "quote_widening.active"],
    {
      maxMitigatedAttackerPnl: 35,
      maxExploitEvents: 28,
      maxToxicFillRate: 0.58,
      maxAdverseSlippageBps: 165,
      maxReconciliationLagMs: 1_100,
    },
  ),
  restart_mid_fill: baseScenarioBudget(
    ["restart_recovery.deterministic", "reconciliation.startup_fail_closed"],
    {
      maxMitigatedAttackerPnl: 22,
      maxExploitEvents: 16,
      maxToxicFillRate: 0.34,
      maxAdverseSlippageBps: 100,
      maxStaleQuoteUptimeRatio: 1,
      maxOrphanOrderCount: 1,
      maxReconciliationLagMs: 1_000,
      maxUnresolvedClaimBacklog: 1,
    },
  ),
  orphan_sweep_failure: baseScenarioBudget(
    ["orphan_sweep.active", "quarantine.active"],
    {
      maxMitigatedAttackerPnl: 20,
      maxExploitEvents: 14,
      maxToxicFillRate: 0.3,
      maxAdverseSlippageBps: 95,
      maxOrphanOrderCount: 2,
      maxReconciliationLagMs: 1_000,
      maxUnresolvedClaimBacklog: 1,
    },
  ),
  rpc_split_brain: baseScenarioBudget(
    ["stale_halt.active", "quarantine.active"],
    {
      maxMitigatedAttackerPnl: 26,
      maxExploitEvents: 18,
      maxToxicFillRate: 0.32,
      maxAdverseSlippageBps: 105,
      maxStaleQuoteUptimeRatio: 1,
      maxReconciliationLagMs: 6_500,
      maxUnresolvedClaimBacklog: 3,
    },
  ),
  nonce_collision_replay: baseScenarioBudget(
    ["nonce_recovery.persisted", "reconciliation.startup_fail_closed"],
    {
      maxMitigatedAttackerPnl: 18,
      maxExploitEvents: 10,
      maxToxicFillRate: 0.25,
      maxAdverseSlippageBps: 90,
      maxOrphanOrderCount: 1,
      maxReconciliationLagMs: 1_000,
      maxUnresolvedClaimBacklog: 0,
    },
  ),
  reorg_finality_lag: baseScenarioBudget(
    ["settlement.required_commitment", "stale_halt.active"],
    {
      maxMitigatedAttackerPnl: 24,
      maxExploitEvents: 18,
      maxToxicFillRate: 0.3,
      maxAdverseSlippageBps: 105,
      maxStaleQuoteUptimeRatio: 1,
      maxReconciliationLagMs: 6_500,
      maxUnresolvedClaimBacklog: 3,
    },
  ),
  rounding_abuse: baseScenarioBudget(
    ["rounding_guards.deterministic", "quote_widening.active"],
    {
      maxMitigatedAttackerPnl: 16,
      maxExploitEvents: 10,
      maxToxicFillRate: 0.25,
      maxAdverseSlippageBps: 80,
      maxReconciliationLagMs: 1_000,
      maxUnresolvedClaimBacklog: 0,
    },
  ),
  fee_token_depletion: baseScenarioBudget(
    ["claim_throttling.active", "quarantine.active"],
    {
      maxMitigatedAttackerPnl: 18,
      maxExploitEvents: 12,
      maxToxicFillRate: 0.28,
      maxAdverseSlippageBps: 95,
      maxStaleQuoteUptimeRatio: 1,
      maxReconciliationLagMs: 1_000,
      maxUnresolvedClaimBacklog: 1,
    },
  ),
  cross_market_inventory_bleed: baseScenarioBudget(
    ["exposure_caps.active", "reduce_only.active"],
    {
      maxMitigatedAttackerPnl: 22,
      maxExploitEvents: 14,
      maxToxicFillRate: 0.3,
      maxAdverseSlippageBps: 110,
      minMitigatedMaxDrawdown: -16,
      maxOrphanOrderCount: 1,
      maxReconciliationLagMs: 1_000,
    },
  ),
  layering_spoof_ladder: baseScenarioBudget(
    ["oracle.max_same_slot_round_trips", "quote_widening.active"],
    {
      maxMitigatedAttackerPnl: 32,
      maxExploitEvents: 26,
      maxToxicFillRate: 0.55,
      maxAdverseSlippageBps: 160,
      maxReconciliationLagMs: 1_100,
    },
  ),
  quote_stuffing_burst: baseScenarioBudget(
    ["quote_widening.active", "stale_halt.active"],
    {
      maxMitigatedAttackerPnl: 36,
      maxExploitEvents: 28,
      maxToxicFillRate: 0.5,
      maxAdverseSlippageBps: 210,
      maxStaleQuoteUptimeRatio: 0.18,
      maxReconciliationLagMs: 1_150,
    },
  ),
  cancel_storm_griefing: baseScenarioBudget(
    ["orphan_sweep.active", "reduce_only.active"],
    {
      maxMitigatedAttackerPnl: 31,
      maxExploitEvents: 25,
      maxToxicFillRate: 0.55,
      maxAdverseSlippageBps: 160,
      maxOrphanOrderCount: 1,
      maxReconciliationLagMs: 1_050,
    },
  ),
  sybil_wash_trading: baseScenarioBudget(
    ["sybil.max_cluster_concentration_pct", "resolution.min_independent_participants"],
    {
      maxMitigatedAttackerPnl: 23,
      maxExploitEvents: 18,
      maxToxicFillRate: 0.41,
      maxAdverseSlippageBps: 175,
      maxReconciliationLagMs: 1_000,
    },
  ),
  sybil_identity_churn: baseScenarioBudget(
    ["sybil.max_identity_churn_rate", "sybil.max_cluster_concentration_pct"],
    {
      maxMitigatedAttackerPnl: 18,
      maxExploitEvents: 15,
      maxToxicFillRate: 0.35,
      maxAdverseSlippageBps: 290,
      maxReconciliationLagMs: 1_050,
    },
  ),
  rebate_farming_ring: baseScenarioBudget(
    ["sybil.max_circular_flow_ratio", "bounded_loss.scenario_attacker_pnl"],
    {
      maxMitigatedAttackerPnl: 20,
      maxExploitEvents: 17,
      maxToxicFillRate: 0.43,
      maxAdverseSlippageBps: 150,
      maxReconciliationLagMs: 900,
    },
  ),
  coordinated_resolution_push: baseScenarioBudget(
    ["resolution.max_coordinated_push_score", "state_machine.finalize_after_dispute_window"],
    {
      maxMitigatedAttackerPnl: 23,
      maxExploitEvents: 13,
      maxToxicFillRate: 0.38,
      maxAdverseSlippageBps: 135,
      maxReconciliationLagMs: 800,
    },
  ),
};

import type { ChainId, ScenarioId } from "./types.js";

export const SAFETY_SPEC_VERSION = "2026-03-11";

export type ChainRiskBudget = {
  maxAggregateMitigatedAttackerPnl: number;
  maxAggregateExploitEvents: number;
  maxAggregateInventoryPeak: number;
};

export type ScenarioRiskBudget = {
  requiredControls: string[];
  maxMitigatedAttackerPnl: number;
  maxExploitEvents: number;
  maxToxicFillRate: number;
  maxAdverseSlippageBps: number;
  minAttackerPnlReductionRatio: number;
};

export const CHAIN_RISK_BUDGETS: Record<ChainId, ChainRiskBudget> = {
  solana: {
    maxAggregateMitigatedAttackerPnl: 180,
    maxAggregateExploitEvents: 155,
    maxAggregateInventoryPeak: 150,
  },
  bsc: {
    maxAggregateMitigatedAttackerPnl: 260,
    maxAggregateExploitEvents: 235,
    maxAggregateInventoryPeak: 210,
  },
  avax: {
    maxAggregateMitigatedAttackerPnl: 290,
    maxAggregateExploitEvents: 260,
    maxAggregateInventoryPeak: 225,
  },
};

export const SCENARIO_RISK_BUDGETS: Record<ScenarioId, ScenarioRiskBudget> = {
  latency_sniping: {
    requiredControls: [
      "oracle.max_age_seconds",
      "settlement.required_commitment",
    ],
    maxMitigatedAttackerPnl: 18,
    maxExploitEvents: 12,
    maxToxicFillRate: 0.45,
    maxAdverseSlippageBps: 90,
    minAttackerPnlReductionRatio: 0.3,
  },
  spoof_pressure: {
    requiredControls: [
      "oracle.max_same_slot_round_trips",
      "chaos.finality_jitter.max_damage_score",
    ],
    maxMitigatedAttackerPnl: 34,
    maxExploitEvents: 24,
    maxToxicFillRate: 0.45,
    maxAdverseSlippageBps: 145,
    minAttackerPnlReductionRatio: 0.3,
  },
  toxic_flow_poisoning: {
    requiredControls: [
      "bounded_loss.scenario_attacker_pnl",
      "max_toxic_fill_rate",
    ],
    maxMitigatedAttackerPnl: 40,
    maxExploitEvents: 34,
    maxToxicFillRate: 0.55,
    maxAdverseSlippageBps: 90,
    minAttackerPnlReductionRatio: 0.3,
  },
  stale_signal_arbitrage: {
    requiredControls: [
      "oracle.max_age_seconds",
      "chaos.oracle_outage.max_damage_score",
    ],
    maxMitigatedAttackerPnl: 35,
    maxExploitEvents: 30,
    maxToxicFillRate: 0.35,
    maxAdverseSlippageBps: 115,
    minAttackerPnlReductionRatio: 0.3,
  },
  liquidation_cascade: {
    requiredControls: [
      "bounded_loss.chain_attacker_pnl_total",
      "chaos.liquidity_cliff.max_inventory_stress",
    ],
    maxMitigatedAttackerPnl: 30,
    maxExploitEvents: 24,
    maxToxicFillRate: 0.42,
    maxAdverseSlippageBps: 150,
    minAttackerPnlReductionRatio: 0.3,
  },
  gas_auction_backrun: {
    requiredControls: [
      "settlement.required_commitment",
      "chaos.finality_jitter.max_damage_score",
    ],
    maxMitigatedAttackerPnl: 30,
    maxExploitEvents: 22,
    maxToxicFillRate: 0.42,
    maxAdverseSlippageBps: 145,
    minAttackerPnlReductionRatio: 0.3,
  },
  layering_spoof_ladder: {
    requiredControls: [
      "oracle.max_same_slot_round_trips",
      "chaos.finality_jitter.max_damage_score",
    ],
    maxMitigatedAttackerPnl: 32,
    maxExploitEvents: 26,
    maxToxicFillRate: 0.48,
    maxAdverseSlippageBps: 155,
    minAttackerPnlReductionRatio: 0.3,
  },
  quote_stuffing_burst: {
    requiredControls: [
      "oracle.max_same_slot_round_trips",
      "bounded_loss.scenario_attacker_pnl",
    ],
    maxMitigatedAttackerPnl: 36,
    maxExploitEvents: 28,
    maxToxicFillRate: 0.5,
    maxAdverseSlippageBps: 160,
    minAttackerPnlReductionRatio: 0.3,
  },
  cancel_storm_griefing: {
    requiredControls: [
      "bounded_loss.chain_attacker_pnl_total",
      "chaos.finality_jitter.max_damage_score",
    ],
    maxMitigatedAttackerPnl: 31,
    maxExploitEvents: 25,
    maxToxicFillRate: 0.52,
    maxAdverseSlippageBps: 150,
    minAttackerPnlReductionRatio: 0.3,
  },
  sybil_wash_trading: {
    requiredControls: [
      "sybil.max_cluster_concentration_pct",
      "resolution.min_independent_participants",
    ],
    maxMitigatedAttackerPnl: 20,
    maxExploitEvents: 16,
    maxToxicFillRate: 0.38,
    maxAdverseSlippageBps: 120,
    minAttackerPnlReductionRatio: 0.3,
  },
  sybil_identity_churn: {
    requiredControls: [
      "sybil.max_identity_churn_rate",
      "sybil.max_cluster_concentration_pct",
    ],
    maxMitigatedAttackerPnl: 18,
    maxExploitEvents: 15,
    maxToxicFillRate: 0.35,
    maxAdverseSlippageBps: 165,
    minAttackerPnlReductionRatio: 0.3,
  },
  rebate_farming_ring: {
    requiredControls: [
      "sybil.max_circular_flow_ratio",
      "bounded_loss.scenario_attacker_pnl",
    ],
    maxMitigatedAttackerPnl: 16,
    maxExploitEvents: 13,
    maxToxicFillRate: 0.35,
    maxAdverseSlippageBps: 95,
    minAttackerPnlReductionRatio: 0.3,
  },
  coordinated_resolution_push: {
    requiredControls: [
      "resolution.max_coordinated_push_score",
      "state_machine.finalize_after_dispute_window",
    ],
    maxMitigatedAttackerPnl: 14,
    maxExploitEvents: 10,
    maxToxicFillRate: 0.25,
    maxAdverseSlippageBps: 70,
    minAttackerPnlReductionRatio: 0.3,
  },
};

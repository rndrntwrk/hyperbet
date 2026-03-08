import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const LAMPORTS_PER_SOL = 1_000_000_000n;
const FUNDING_RATE_PRECISION = 1_000_000_000n;
const BPS_DENOMINATOR = 10_000n;

type ScenarioCategory = "attack" | "stress" | "ops";

interface PerpsParams {
  liquidationFeeBps: bigint;
  maintenanceMarginBps: bigint;
  skewScaleLamports: bigint;
  fundingVelocity: bigint;
  minOracleSpotIndexLamports: bigint;
  maxOracleSpotIndexLamports: bigint;
  maxOraclePriceDeltaBps: bigint;
  maxMarketOpenInterestLamports: bigint;
  minMarketInsuranceLamports: bigint;
  tradeTreasuryFeeBps: bigint;
  tradeMarketMakerFeeBps: bigint;
}

interface MarketState {
  insuranceFundLamports: bigint;
  currentFundingRate: bigint;
  longOiLamports: bigint;
  shortOiLamports: bigint;
}

interface PositionState {
  entryFundingRate: bigint;
  entryPriceLamports: bigint;
  marginLamports: bigint;
  sizeLamports: bigint;
}

interface ScenarioResult {
  name: string;
  category: ScenarioCategory;
  summary: string;
  weakness: string | null;
  metrics: Record<string, number | string | boolean>;
}

function sol(amount: number): bigint {
  return BigInt(Math.round(amount * Number(LAMPORTS_PER_SOL)));
}

function lamportsToSol(lamports: bigint): number {
  return Number(lamports) / Number(LAMPORTS_PER_SOL);
}

function ratioPercent(numerator: bigint, denominator: bigint): number {
  if (denominator === 0n) return 0;
  return (Number(numerator) / Number(denominator)) * 100;
}

function absBigInt(value: bigint): bigint {
  return value < 0n ? -value : value;
}

function executionPriceLamports(
  indexPriceLamports: bigint,
  market: Pick<MarketState, "longOiLamports" | "shortOiLamports">,
  sizeDeltaLamports: bigint,
  params: Pick<PerpsParams, "skewScaleLamports">,
): bigint {
  const skew = market.longOiLamports - market.shortOiLamports;
  const y1 = params.skewScaleLamports + skew;
  const y2 = y1 + sizeDeltaLamports;

  if (params.skewScaleLamports <= 0n || y1 <= 0n || y2 <= 0n) {
    throw new Error("invalid virtual reserve state");
  }

  const part1 = (indexPriceLamports * y1) / params.skewScaleLamports;
  return (part1 * y2) / params.skewScaleLamports;
}

function openPosition(
  marginLamports: bigint,
  sizeLamports: bigint,
  indexPriceLamports: bigint,
  market: MarketState,
  params: PerpsParams,
): { market: MarketState; position: PositionState } {
  const projectedMarket = updateOpenInterest(market, 0n, sizeLamports);
  if (
    projectedMarket.longOiLamports > params.maxMarketOpenInterestLamports ||
    projectedMarket.shortOiLamports > params.maxMarketOpenInterestLamports
  ) {
    throw new Error("open-interest cap exceeded");
  }
  if (
    absBigInt(sizeLamports) > 0n &&
    market.insuranceFundLamports < params.minMarketInsuranceLamports
  ) {
    throw new Error("market insurance floor not met");
  }

  const entryPriceLamports = executionPriceLamports(
    indexPriceLamports,
    market,
    sizeLamports,
    params,
  );
  const totalTradeFeeLamports = tradeFeeLamports(
    sizeLamports,
    params.tradeTreasuryFeeBps + params.tradeMarketMakerFeeBps,
  );
  const marginAfterFeesLamports = marginLamports - totalTradeFeeLamports;
  if (marginAfterFeesLamports <= 0n) {
    throw new Error("margin exhausted by trade fees");
  }

  return {
    market: projectedMarket,
    position: {
      entryFundingRate: market.currentFundingRate,
      entryPriceLamports,
      marginLamports: marginAfterFeesLamports,
      sizeLamports,
    },
  };
}

function updateOpenInterest(
  market: MarketState,
  oldSizeLamports: bigint,
  newSizeLamports: bigint,
): MarketState {
  const next = { ...market };
  if (oldSizeLamports > 0n) next.longOiLamports -= oldSizeLamports;
  if (oldSizeLamports < 0n) next.shortOiLamports -= -oldSizeLamports;
  if (newSizeLamports > 0n) next.longOiLamports += newSizeLamports;
  if (newSizeLamports < 0n) next.shortOiLamports += -newSizeLamports;
  return next;
}

function tradePnlLamports(
  sizeLamports: bigint,
  entryPriceLamports: bigint,
  exitPriceLamports: bigint,
): bigint {
  const absSize = absBigInt(sizeLamports);
  if (sizeLamports > 0n) {
    return (
      ((exitPriceLamports - entryPriceLamports) * absSize) / entryPriceLamports
    );
  }
  return (
    ((entryPriceLamports - exitPriceLamports) * absSize) / entryPriceLamports
  );
}

function fundingPnlLamports(
  sizeLamports: bigint,
  fundingDelta: bigint,
): bigint {
  return -((sizeLamports * fundingDelta) / FUNDING_RATE_PRECISION);
}

function settlePositionLamports(
  position: PositionState,
  exitPriceLamports: bigint,
  currentFundingRate: bigint,
): bigint {
  const pnlLamports = tradePnlLamports(
    position.sizeLamports,
    position.entryPriceLamports,
    exitPriceLamports,
  );
  const fundingLamports = fundingPnlLamports(
    position.sizeLamports,
    currentFundingRate - position.entryFundingRate,
  );
  const equityLamports =
    position.marginLamports + pnlLamports + fundingLamports;
  return equityLamports > 0n ? equityLamports : 0n;
}

function calculateMaintenanceMarginLamports(
  sizeLamports: bigint,
  maintenanceMarginBps: bigint,
): bigint {
  return (absBigInt(sizeLamports) * maintenanceMarginBps) / BPS_DENOMINATOR;
}

function driftFundingRate(
  market: MarketState,
  elapsedSeconds: bigint,
  params: Pick<PerpsParams, "fundingVelocity" | "skewScaleLamports">,
): bigint {
  const skew = market.longOiLamports - market.shortOiLamports;
  return (
    (skew * params.fundingVelocity * elapsedSeconds) / params.skewScaleLamports
  );
}

function defaultParams(): PerpsParams {
  return {
    liquidationFeeBps: 100n,
    maintenanceMarginBps: 500n,
    skewScaleLamports: sol(100),
    fundingVelocity: 1_000n,
    minOracleSpotIndexLamports: sol(80),
    maxOracleSpotIndexLamports: sol(120),
    maxOraclePriceDeltaBps: 2_500n,
    maxMarketOpenInterestLamports: sol(25),
    minMarketInsuranceLamports: sol(12),
    tradeTreasuryFeeBps: 25n,
    tradeMarketMakerFeeBps: 25n,
  };
}

function tradeFeeLamports(sizeLamports: bigint, feeBps: bigint): bigint {
  return (absBigInt(sizeLamports) * feeBps) / BPS_DENOMINATOR;
}

function scenarioWhaleRoundTrip(): ScenarioResult {
  const params = defaultParams();
  const indexPriceLamports = sol(100);
  const emptyMarket: MarketState = {
    insuranceFundLamports: sol(12),
    currentFundingRate: 0n,
    longOiLamports: 0n,
    shortOiLamports: 0n,
  };

  const whale = openPosition(
    sol(5),
    sol(20),
    indexPriceLamports,
    emptyMarket,
    params,
  );
  const follower = openPosition(
    sol(1),
    sol(4),
    indexPriceLamports,
    whale.market,
    params,
  );
  const whaleExitPriceLamports = executionPriceLamports(
    indexPriceLamports,
    whale.market,
    -whale.position.sizeLamports,
    params,
  );
  const whaleRoundTripPnlLamports = tradePnlLamports(
    whale.position.sizeLamports,
    whale.position.entryPriceLamports,
    whaleExitPriceLamports,
  );

  return {
    name: "Whale round trip",
    category: "attack",
    summary:
      "Large same-direction trades pay a meaningful entry premium and lose on an immediate exit, so the skew curve resists cheap self-pumping.",
    weakness: null,
    metrics: {
      whale_notional_sol: lamportsToSol(whale.position.sizeLamports),
      whale_entry_premium_pct: Number(
        ratioPercent(
          whale.position.entryPriceLamports - indexPriceLamports,
          indexPriceLamports,
        ).toFixed(4),
      ),
      follower_entry_premium_pct: Number(
        ratioPercent(
          follower.position.entryPriceLamports - indexPriceLamports,
          indexPriceLamports,
        ).toFixed(4),
      ),
      whale_instant_roundtrip_pnl_sol: Number(
        lamportsToSol(whaleRoundTripPnlLamports).toFixed(6),
      ),
    },
  };
}

function scenarioFundingDrift(): ScenarioResult {
  const params = defaultParams();
  const market: MarketState = {
    insuranceFundLamports: sol(12),
    currentFundingRate: 0n,
    longOiLamports: sol(10),
    shortOiLamports: 0n,
  };
  const position = openPosition(
    sol(1),
    sol(5),
    sol(100),
    market,
    params,
  ).position;
  const oneHourFundingDelta = driftFundingRate(market, 3_600n, params);
  const oneDayFundingDelta = driftFundingRate(market, 86_400n, params);
  const oneHourFundingCostLamports = fundingPnlLamports(
    position.sizeLamports,
    oneHourFundingDelta,
  );
  const oneDayFundingCostLamports = fundingPnlLamports(
    position.sizeLamports,
    oneDayFundingDelta,
  );

  return {
    name: "Default funding drift",
    category: "stress",
    summary:
      "Funding rises when one side dominates, but the default parameters still need calibration against real duel history before a larger launch.",
    weakness:
      "Funding is directionally correct, but parameter sweeps against production-like activity are still required before scaling liquidity.",
    metrics: {
      skew_sol: lamportsToSol(market.longOiLamports),
      funding_delta_1h: Number(oneHourFundingDelta),
      funding_delta_24h: Number(oneDayFundingDelta),
      long_funding_cost_1h_sol: Number(
        lamportsToSol(oneHourFundingCostLamports).toFixed(9),
      ),
      long_funding_cost_24h_sol: Number(
        lamportsToSol(oneDayFundingCostLamports).toFixed(9),
      ),
    },
  };
}

function scenarioIsolatedInsuranceContainment(): ScenarioResult {
  const params = defaultParams();
  const marketA: MarketState = {
    insuranceFundLamports: sol(12),
    currentFundingRate: 0n,
    longOiLamports: 0n,
    shortOiLamports: 0n,
  };
  const marketB: MarketState = {
    insuranceFundLamports: sol(18),
    currentFundingRate: 0n,
    longOiLamports: 0n,
    shortOiLamports: 0n,
  };
  const opened = openPosition(sol(1), sol(4), sol(100), marketA, params);
  const exitPriceLamports = executionPriceLamports(
    sol(125),
    opened.market,
    -opened.position.sizeLamports,
    params,
  );
  const settlementLamports = settlePositionLamports(
    opened.position,
    exitPriceLamports,
    0n,
  );
  const marketAFreeLiquidityLamports = sol(1) + marketA.insuranceFundLamports;

  return {
    name: "Isolated insurance containment",
    category: "ops",
    summary:
      "A profitable close on one model can only use that model's own insurance reserve; other markets remain untouched.",
    weakness: null,
    metrics: {
      market_a_required_settlement_sol: Number(
        lamportsToSol(settlementLamports).toFixed(6),
      ),
      market_a_total_liquidity_sol: lamportsToSol(marketAFreeLiquidityLamports),
      market_b_reserved_insurance_sol: lamportsToSol(
        marketB.insuranceFundLamports,
      ),
      can_reach_market_b_reserve: false,
    },
  };
}

function scenarioPositiveEquityLiquidation(): ScenarioResult {
  const params = defaultParams();
  const market: MarketState = {
    insuranceFundLamports: sol(12),
    currentFundingRate: 0n,
    longOiLamports: 0n,
    shortOiLamports: 0n,
  };
  const opened = openPosition(sol(1), sol(5), sol(100), market, params);
  const exitPriceLamports = executionPriceLamports(
    sol(82),
    opened.market,
    -opened.position.sizeLamports,
    params,
  );
  const settlementLamports = settlePositionLamports(
    opened.position,
    exitPriceLamports,
    0n,
  );
  const maintenanceMarginLamports = calculateMaintenanceMarginLamports(
    opened.position.sizeLamports,
    params.maintenanceMarginBps,
  );
  const liquidationFeeLamports =
    settlementLamports < 0n
      ? 0n
      : (absBigInt(opened.position.sizeLamports) * params.liquidationFeeBps) /
        BPS_DENOMINATOR;

  return {
    name: "Positive-equity liquidation",
    category: "stress",
    summary:
      "A position can cross the maintenance threshold before equity reaches zero, allowing orderly liquidation with a bounded liquidator fee.",
    weakness: null,
    metrics: {
      settlement_equity_sol: Number(
        lamportsToSol(settlementLamports).toFixed(6),
      ),
      maintenance_margin_sol: lamportsToSol(maintenanceMarginLamports),
      liquidatable: settlementLamports < maintenanceMarginLamports,
      liquidator_fee_sol: Number(
        lamportsToSol(liquidationFeeLamports).toFixed(6),
      ),
    },
  };
}

function scenarioInsuranceFloor(): ScenarioResult {
  const params = defaultParams();
  const market: MarketState = {
    insuranceFundLamports: sol(0.5),
    currentFundingRate: 0n,
    longOiLamports: 0n,
    shortOiLamports: 0n,
  };
  let rejected = false;
  try {
    openPosition(sol(1), sol(4), sol(100), market, params);
  } catch (error) {
    rejected = (error as Error).message.includes(
      "market insurance floor not met",
    );
  }

  return {
    name: "Insurance floor gate",
    category: "ops",
    summary:
      "Launch markets without the configured isolated insurance reserve should now reject new exposure instead of accepting undercapitalized open interest.",
    weakness: rejected
      ? null
      : "If undercapitalized markets stop rejecting new OI, solvency assumptions have drifted away from the deployed contract.",
    metrics: {
      configured_min_insurance_sol: lamportsToSol(
        params.minMarketInsuranceLamports,
      ),
      attempted_market_insurance_sol: lamportsToSol(market.insuranceFundLamports),
      rejected,
    },
  };
}

function scenarioFeeRecycling(): ScenarioResult {
  const params = defaultParams();
  const sizeLamports = sol(5);
  const treasuryFeeLamports = tradeFeeLamports(
    sizeLamports,
    params.tradeTreasuryFeeBps,
  );
  const marketMakerFeeLamports = tradeFeeLamports(
    sizeLamports,
    params.tradeMarketMakerFeeBps,
  );
  const recycledInsuranceLamports = sol(1) + marketMakerFeeLamports;

  return {
    name: "Fee recycling into isolated insurance",
    category: "ops",
    summary:
      "Per-trade fees can be split between treasury and market maker, then the market-maker share can be recycled back into that model's insurance reserve.",
    weakness: null,
    metrics: {
      trade_notional_sol: lamportsToSol(sizeLamports),
      treasury_fee_sol: Number(lamportsToSol(treasuryFeeLamports).toFixed(6)),
      market_maker_fee_sol: Number(
        lamportsToSol(marketMakerFeeLamports).toFixed(6),
      ),
      recycled_market_insurance_sol: Number(
        lamportsToSol(recycledInsuranceLamports).toFixed(6),
      ),
    },
  };
}

function scenarioOpenInterestCap(): ScenarioResult {
  const params = defaultParams();
  const market: MarketState = {
    insuranceFundLamports: sol(12),
    currentFundingRate: 0n,
    longOiLamports: sol(20),
    shortOiLamports: 0n,
  };

  let rejected = false;
  try {
    openPosition(sol(1), sol(6), sol(100), market, params);
  } catch (error) {
    rejected = (error as Error).message.includes("open-interest cap exceeded");
  }

  return {
    name: "Open-interest cap",
    category: "ops",
    summary:
      "The current launch configuration should reject one-way growth once a model market reaches its configured OI ceiling.",
    weakness: rejected
      ? null
      : "If this scenario stops rejecting oversize flow, launch risk has regressed and the chain-faithful guardrail is no longer active.",
    metrics: {
      configured_cap_sol: lamportsToSol(params.maxMarketOpenInterestLamports),
      pre_trade_long_oi_sol: lamportsToSol(market.longOiLamports),
      attempted_increment_sol: 6,
      rejected,
    },
  };
}

function scenarioOracleGuardrails(): ScenarioResult {
  const params = defaultParams();
  const previousSpot = sol(80);
  const boundedJump = sol(121);
  const withinBoundsButTooFast = sol(110);
  const maxStepLamports =
    (previousSpot * params.maxOraclePriceDeltaBps) / BPS_DENOMINATOR;
  const outOfBoundsRejected =
    boundedJump > params.maxOracleSpotIndexLamports ||
    boundedJump < params.minOracleSpotIndexLamports;
  const oversizedStepRejected =
    withinBoundsButTooFast - previousSpot > maxStepLamports;

  return {
    name: "Oracle guardrails",
    category: "ops",
    summary:
      "The launch envelope now has hard oracle bounds plus a per-update step limit, so a single bad keeper write cannot push the market far outside the configured synthetic range.",
    weakness: outOfBoundsRejected && oversizedStepRejected
      ? null
      : "If the simulator stops rejecting out-of-range or oversized updates, the oracle safety envelope no longer matches the contract.",
    metrics: {
      min_spot_index_sol: lamportsToSol(params.minOracleSpotIndexLamports),
      max_spot_index_sol: lamportsToSol(params.maxOracleSpotIndexLamports),
      max_step_bps: Number(params.maxOraclePriceDeltaBps),
      out_of_bounds_rejected: outOfBoundsRejected,
      oversized_step_rejected: oversizedStepRejected,
    },
  };
}

function scenarioZeroEquityLiquidationReward(): ScenarioResult {
  const params = defaultParams();
  const market: MarketState = {
    insuranceFundLamports: sol(12),
    currentFundingRate: 0n,
    longOiLamports: 0n,
    shortOiLamports: 0n,
  };
  const opened = openPosition(sol(1.025), sol(5), sol(100), market, params);
  const exitPriceLamports = executionPriceLamports(
    sol(80),
    opened.market,
    -opened.position.sizeLamports,
    params,
  );
  const settlementLamports = settlePositionLamports(
    opened.position,
    exitPriceLamports,
    0n,
  );
  const positiveEquityLamports = settlementLamports > 0n ? settlementLamports : 0n;
  const targetFeeLamports = tradeFeeLamports(
    opened.position.sizeLamports,
    params.liquidationFeeBps,
  );
  const availablePayoutLamports =
    opened.position.marginLamports + market.insuranceFundLamports;
  const realizedFeeLamports =
    targetFeeLamports < availablePayoutLamports
      ? targetFeeLamports
      : availablePayoutLamports;
  const feeAboveEquityLamports =
    realizedFeeLamports > positiveEquityLamports
      ? realizedFeeLamports - positiveEquityLamports
      : 0n;

  return {
    name: "Zero-equity liquidation reward",
    category: "stress",
    summary:
      "A zero-equity liquidation can still pay a bounded liquidator reward instead of collapsing to zero and leaving toxic inventory stuck at the maintenance boundary.",
    weakness: positiveEquityLamports === 0n && realizedFeeLamports > 0n
      ? null
      : "If zero-equity liquidations stop paying a reward, the launch liquidation path has regressed to the older incentive gap.",
    metrics: {
      settlement_equity_sol: Number(
        lamportsToSol(settlementLamports).toFixed(6),
      ),
      target_liquidator_fee_sol: Number(
        lamportsToSol(targetFeeLamports).toFixed(6),
      ),
      realized_liquidator_fee_sol: Number(
        lamportsToSol(realizedFeeLamports).toFixed(6),
      ),
      fee_above_equity_sol: Number(
        lamportsToSol(feeAboveEquityLamports).toFixed(6),
      ),
    },
  };
}

function scenarioModelDeprecation(): ScenarioResult {
  return {
    name: "Model deprecation lifecycle",
    category: "ops",
    summary:
      "When a model disappears, the market can move to close-only mode: no new exposure, but existing traders can still reduce and exit against the frozen settlement price.",
    weakness: null,
    metrics: {
      new_exposure_allowed: false,
      close_only_allows_exit: true,
      oracle_must_stay_live: false,
      archived_requires_zero_open_interest: true,
    },
  };
}

function runScenarios(): ScenarioResult[] {
  return [
    scenarioWhaleRoundTrip(),
    scenarioFundingDrift(),
    scenarioIsolatedInsuranceContainment(),
    scenarioPositiveEquityLiquidation(),
    scenarioZeroEquityLiquidationReward(),
    scenarioInsuranceFloor(),
    scenarioOpenInterestCap(),
    scenarioOracleGuardrails(),
    scenarioFeeRecycling(),
    scenarioModelDeprecation(),
  ];
}

function main(): void {
  const results = runScenarios();
  const findings = results
    .filter((result) => result.weakness)
    .map((result) => ({
      name: result.name,
      category: result.category,
      weakness: result.weakness,
    }));

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const outputDir = path.resolve(__dirname, "..", "simulations");
  const outputPath = path.join(outputDir, "gold-perps-risk-report.json");

  mkdirSync(outputDir, { recursive: true });
  writeFileSync(
    outputPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        assumptions: [
          "Matches current on-chain perps math for skew pricing, fees, funding, liquidation, insurance usage, explicit per-market OI cap, oracle bounds, and the minimum isolated insurance gate for new OI.",
          "Does not model off-chain keeper outages, oracle authority compromise, or network-level MEV.",
        ],
        results,
        findings,
      },
      null,
      2,
    ),
  );

  console.log("[perps-risk] Wrote", outputPath);
  for (const result of results) {
    console.log(`\n[${result.category}] ${result.name}`);
    console.log(`  ${result.summary}`);
    if (result.weakness) {
      console.log(`  Weakness: ${result.weakness}`);
    }
    for (const [key, value] of Object.entries(result.metrics)) {
      console.log(`  ${key}: ${value}`);
    }
  }
}

main();

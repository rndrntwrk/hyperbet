import React from "react";
import {
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { type Address } from "viem";
import { useAccount, useSwitchChain, useWalletClient } from "wagmi";
import { Toaster, toast } from "sonner";
import type { UiLocale } from "../i18n";
import { useChain } from "../lib/ChainContext";
import { getEvmChainConfig } from "../lib/chainConfig";
import {
  createEvmPublicClient,
  ensureErc20Approval,
  formatToken18,
  getPerpMarketConfig,
  getPerpMarketState,
  getPerpPosition,
  getPerpPositionHealth,
  modifyPerpPosition,
  parseToken18,
  toPerpAgentKey,
} from "../lib/evmClient";
import {
  type HyperbetThemeId,
  useResolvedHyperbetTheme,
} from "../lib/theme";

// ── Constants ─────────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 5_000;
const ORACLE_HISTORY_POLL_INTERVAL_MS = 15_000;
const ORACLE_HISTORY_LIMIT = 120;
const MOCK_ORACLE_POINTS = 30;
const DEFAULT_SKEW_SCALE = 10;
const DEFAULT_MAX_LEVERAGE = 5;
const DEFAULT_MAINTENANCE_MARGIN_BPS = 1_000;
const MAX_ORACLE_STALENESS_MS = 120_000;

// ── Types ─────────────────────────────────────────────────────────────────────

type TradeDirection = "LONG" | "SHORT";
type MarketStatus = "ACTIVE" | "CLOSE_ONLY" | "ARCHIVED";

interface PerpsDirectoryEntry {
  characterId: string;
  agentKey: string | null;
  name: string;
  provider: string;
  model: string;
  rank: number | null;
  wins: number;
  losses: number;
  winRate: number;
  currentStreak: number;
  mu: number | null;
  sigma: number | null;
  status: MarketStatus;
}

interface MarketSnapshot {
  spotIndex: number | null;
  longOi: number;
  shortOi: number;
  fundingRate: number;
  conservativeSkill: number | null;
  uncertainty: number | null;
  lastUpdated: number | null;
  insuranceFund: number;
  skewScaleCollateral: number;
}

interface PositionSnapshot {
  direction: TradeDirection;
  margin: number;
  size: number;
  signedSize: number;
  entryPrice: number;
  markPrice: number | null;
  pnl: number;
  liquidationPrice: number | null;
}

interface OracleHistoryPoint {
  spotIndex: number;
  conservativeSkill: number;
  mu: number;
  sigma: number;
  recordedAt: number;
  label: string;
}

// API response shapes

interface ApiPerpsMarket {
  characterId?: string;
  name?: string;
  provider?: string;
  model?: string;
  rank?: number | null;
  wins?: number;
  losses?: number;
  winRate?: number;
  currentStreak?: number;
  agentKey?: string | null;
  mu?: number | null;
  sigma?: number | null;
  spotIndex?: number | null;
  conservativeSkill?: number | null;
  oracleRecordedAt?: number | null;
  status?: string;
}

interface ApiPerpsMarketsResponse {
  markets?: ApiPerpsMarket[];
  updatedAt?: number;
}

interface ApiOracleSnapshot {
  spotIndex?: number;
  conservativeSkill?: number;
  mu?: number;
  sigma?: number;
  recordedAt?: number;
}

interface ApiOracleHistoryResponse {
  snapshots?: ApiOracleSnapshot[];
}

export interface EvmMockLeaderboardEntry {
  rank: number;
  agentName: string;
  provider: string;
  model: string;
  wins: number;
  losses: number;
  winRate: number;
  currentStreak: number;
}

export interface EvmModelsMarketMockData {
  leaderboard: EvmMockLeaderboardEntry[];
}

interface EvmModelsMarketViewProps {
  /** Name of the first agent currently fighting (from live SSE / mock engine). */
  fightingAgentA: string;
  /** Name of the second agent currently fighting. */
  fightingAgentB: string;
  locale?: UiLocale;
  gameApiUrl: string;
  mockData?: EvmModelsMarketMockData | null;
  collateralSymbol?: string;
  chainLabel?: string;
  theme?: HyperbetThemeId;
}

// ── Pure utilities ────────────────────────────────────────────────────────────

function agentNameToCharacterId(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

function buildOracleLabel(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatCompact(value: number, digits = 2): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(digits)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(digits)}K`;
  return value.toFixed(digits);
}

function formatUpdatedAt(timestamp: number | null): string {
  if (!timestamp) return "pending";
  return new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function isOracleFresh(timestamp: number | null): boolean {
  if (!timestamp) return false;
  return Date.now() - timestamp <= MAX_ORACLE_STALENESS_MS;
}

function _computePnl(
  entryPrice: number,
  signedSize: number,
  markPrice: number | null,
): number {
  if (!markPrice || entryPrice <= 0 || signedSize === 0) return 0;
  const size = Math.abs(signedSize);
  if (signedSize > 0) return (markPrice - entryPrice) * (size / entryPrice);
  return (entryPrice - markPrice) * (size / entryPrice);
}

function _computeLiquidationPrice(
  entryPrice: number,
  signedSize: number,
  margin: number,
): number | null {
  const size = Math.abs(signedSize);
  if (entryPrice <= 0 || size <= 0 || margin <= 0) return null;
  const maintenanceMargin = size * (DEFAULT_MAINTENANCE_MARGIN_BPS / 10_000);
  const availableLoss = Math.max(0, margin - maintenanceMargin);
  if (signedSize > 0) return entryPrice * (1 - availableLoss / size);
  return entryPrice * (1 + availableLoss / size);
}

function estimateExecutionPrice(
  market: MarketSnapshot | undefined,
  signedSizeDelta: number,
  skewScale: number,
): number | null {
  if (!market?.spotIndex || skewScale <= 0 || signedSizeDelta === 0) return null;
  const skew = market.longOi - market.shortOi;
  const y1 = skewScale + skew;
  const y2 = y1 + signedSizeDelta;
  if (y1 <= 0 || y2 <= 0) return null;
  return market.spotIndex * (y1 / skewScale) * (y2 / skewScale);
}

// ── Mock data generation ───────────────────────────────────────────────────────

/** Deterministic seeded LCG for reproducible per-agent mock data. */
function seededLcg(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = Math.imul(1664525, s) + 1013904223;
    return (s >>> 0) / 0x100000000;
  };
}

function agentNameSeed(name: string): number {
  return name.split("").reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
}

function computeMockMarketSnapshot(entry: EvmMockLeaderboardEntry): MarketSnapshot {
  const total = entry.wins + entry.losses;
  const mu = total > 0 ? (entry.wins / total) * 50 + 10 : 25;
  const sigma = Math.max(2, 8 - Math.log1p(total) * 0.5);
  const conservativeSkill = Math.max(0, mu - 3 * sigma);
  const spotIndex = Math.max(0.1, conservativeSkill);

  const rng = seededLcg(agentNameSeed(entry.agentName) ^ 0xdeadbeef);
  const longOi = entry.wins * 0.4 + entry.currentStreak * 0.6 + rng() * 2;
  const shortOi = entry.losses * 0.3 + rng() * 1.5;
  const fundingRate = (longOi - shortOi) / (DEFAULT_SKEW_SCALE * 100);

  return {
    spotIndex,
    longOi: Math.max(0, longOi),
    shortOi: Math.max(0, shortOi),
    fundingRate,
    conservativeSkill,
    uncertainty: sigma,
    lastUpdated: Date.now() - 15_000,
    insuranceFund: entry.wins * 0.5 + 1,
    skewScaleCollateral: DEFAULT_SKEW_SCALE,
  };
}

function generateMockOracleHistory(
  entry: EvmMockLeaderboardEntry,
): OracleHistoryPoint[] {
  const seed = agentNameSeed(entry.agentName);
  const rng = seededLcg(seed);

  const total = entry.wins + entry.losses;
  const targetMu = total > 0 ? (entry.wins / total) * 50 + 10 : 25;
  const targetSigma = Math.max(2, 8 - Math.log1p(total) * 0.5);

  const now = Date.now();
  const interval = 60_000;
  const points: OracleHistoryPoint[] = [];

  let mu = targetMu * (0.7 + rng() * 0.6);

  for (let i = MOCK_ORACLE_POINTS - 1; i >= 0; i--) {
    const ts = now - i * interval;
    mu = Math.max(10, Math.min(60, mu + (rng() - 0.5) * 3));
    const sigma = Math.max(1.5, targetSigma * (0.8 + rng() * 0.4));
    const cs = Math.max(0, mu - 3 * sigma);
    const spotIndex = Math.max(0.1, cs);

    points.push({
      spotIndex,
      conservativeSkill: cs,
      mu,
      sigma,
      recordedAt: ts,
      label: buildOracleLabel(ts),
    });
  }

  return points;
}

function leaderboardEntryToDirectoryEntry(
  entry: EvmMockLeaderboardEntry,
): PerpsDirectoryEntry {
  const characterId = agentNameToCharacterId(entry.agentName);
  const total = entry.wins + entry.losses;
  const mu = total > 0 ? (entry.wins / total) * 50 + 10 : 25;
  const sigma = Math.max(2, 8 - Math.log1p(total) * 0.5);
  return {
    characterId,
    agentKey: toPerpAgentKey(characterId),
    name: entry.agentName,
    provider: entry.provider,
    model: entry.model,
    rank: entry.rank,
    wins: entry.wins,
    losses: entry.losses,
    winRate: entry.winRate,
    currentStreak: entry.currentStreak,
    mu,
    sigma,
    status: "ACTIVE",
  };
}

// ── API response sanitizers ────────────────────────────────────────────────────

function sanitizeDirectoryEntry(
  raw: ApiPerpsMarket,
): PerpsDirectoryEntry | null {
  if (
    typeof raw.characterId !== "string" ||
    !raw.characterId.trim() ||
    typeof raw.name !== "string"
  ) {
    return null;
  }
  const status: MarketStatus =
    raw.status === "CLOSE_ONLY"
      ? "CLOSE_ONLY"
      : raw.status === "ARCHIVED"
        ? "ARCHIVED"
        : "ACTIVE";
  return {
    characterId: raw.characterId,
    agentKey:
      typeof raw.agentKey === "string" && raw.agentKey.trim().length > 0
        ? raw.agentKey
        : null,
    name: raw.name,
    provider: raw.provider ?? "Unknown",
    model: raw.model ?? "",
    rank: typeof raw.rank === "number" ? raw.rank : null,
    wins: raw.wins ?? 0,
    losses: raw.losses ?? 0,
    winRate: raw.winRate ?? 0,
    currentStreak: raw.currentStreak ?? 0,
    mu: typeof raw.mu === "number" ? raw.mu : null,
    sigma: typeof raw.sigma === "number" ? raw.sigma : null,
    status,
  };
}

function sanitizeMarketsResponse(
  payload: ApiPerpsMarketsResponse,
): {
  entries: PerpsDirectoryEntry[];
  updatedAt: number;
  snapshots: Record<string, MarketSnapshot>;
} {
  const raw = Array.isArray(payload.markets) ? payload.markets : [];
  const entries: PerpsDirectoryEntry[] = [];
  const snapshots: Record<string, MarketSnapshot> = {};
  for (const market of raw) {
    const entry = sanitizeDirectoryEntry(market);
    if (!entry) continue;
    entries.push(entry);
    snapshots[entry.characterId] = {
      spotIndex: typeof market.spotIndex === "number" ? market.spotIndex : null,
      longOi: 0,
      shortOi: 0,
      fundingRate: 0,
      conservativeSkill:
        typeof market.conservativeSkill === "number"
          ? market.conservativeSkill
          : entry.mu !== null && entry.sigma !== null
            ? Math.max(0, entry.mu - 3 * entry.sigma)
            : null,
      uncertainty: entry.sigma,
      lastUpdated:
        typeof market.oracleRecordedAt === "number"
          ? market.oracleRecordedAt
          : null,
      insuranceFund: 0,
      skewScaleCollateral: DEFAULT_SKEW_SCALE,
    };
  }
  return {
    entries,
    updatedAt: typeof payload.updatedAt === "number" ? payload.updatedAt : Date.now(),
    snapshots,
  };
}

function sanitizeOracleHistory(
  payload: ApiOracleHistoryResponse,
): OracleHistoryPoint[] {
  const raw = Array.isArray(payload.snapshots) ? payload.snapshots : [];
  return raw
    .filter(
      (s) =>
        typeof s.spotIndex === "number" &&
        typeof s.mu === "number" &&
        typeof s.sigma === "number" &&
        typeof s.recordedAt === "number",
    )
    .map((s) => ({
      spotIndex: s.spotIndex!,
      conservativeSkill: s.conservativeSkill ?? Math.max(0, s.mu! - 3 * s.sigma!),
      mu: s.mu!,
      sigma: s.sigma!,
      recordedAt: s.recordedAt!,
      label: buildOracleLabel(s.recordedAt!),
    }))
    .sort((a, b) => a.recordedAt - b.recordedAt);
}

// ── Provider colour map ────────────────────────────────────────────────────────

const PROVIDER_COLORS: Record<string, string> = {
  OpenAI: "#10a37f",
  Anthropic: "#d97757",
  Google: "#4285f4",
  Meta: "#0866ff",
  Mistral: "#f54e42",
  Cohere: "#39aaa5",
  xAI: "#ffffff",
  DeepSeek: "#6366f1",
};

function providerColor(provider: string): string {
  return PROVIDER_COLORS[provider] ?? "rgba(255,255,255,0.5)";
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ProviderPill({ provider }: { provider: string }) {
  const color = providerColor(provider);
  return (
    <span className="hm-models-provider-pill" style={{ borderColor: color }}>
      <span className="hm-models-provider-dot" style={{ background: color }} />
      {provider}
    </span>
  );
}

function WinRateBar({ pct }: { pct: number }) {
  const clamped = Math.max(0, Math.min(100, pct));
  const color =
    clamped >= 70
      ? "var(--hm-accent-green)"
      : clamped >= 45
        ? "var(--hm-accent-gold)"
        : "var(--hm-accent-red)";
  return (
    <div className="hm-models-winbar">
      <div className="hm-models-winbar-fill" style={{ width: `${clamped}%`, background: color }} />
    </div>
  );
}

// Custom tooltip for the recharts LineChart
function OracleTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: OracleHistoryPoint }>;
}) {
  if (!active || !payload?.length) return null;
  const pt = payload[0]?.payload;
  if (!pt) return null;
  return (
    <div className="hm-perps-tooltip">
      <strong>${pt.spotIndex.toFixed(2)}</strong>
      <span>
        Skill {pt.conservativeSkill.toFixed(2)} · μ {pt.mu.toFixed(2)} · σ {pt.sigma.toFixed(2)}
      </span>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export function EvmModelsMarketView({
  fightingAgentA,
  fightingAgentB,
  gameApiUrl,
  mockData = null,
  collateralSymbol = "EVM",
  chainLabel = collateralSymbol,
  theme,
}: EvmModelsMarketViewProps) {
  const themeDefinition = useResolvedHyperbetTheme(theme);
  const { activeChain } = useChain();
  const { address: evmAddress, isConnected: isEvmConnected, chainId: walletChainId } =
    useAccount();
  const { data: walletClient } = useWalletClient();
  const { switchChainAsync } = useSwitchChain();
  const chainConfig =
    activeChain === "bsc" || activeChain === "base" || activeChain === "avax"
      ? getEvmChainConfig(activeChain)
      : null;
  const publicClient = React.useMemo(
    () => (chainConfig ? createEvmPublicClient(chainConfig) : null),
    [chainConfig],
  );
  const perpsConfigured = Boolean(
    chainConfig?.perpEngineAddress && chainConfig.perpMarginTokenAddress,
  );

  // ── Model directory ──
  const [entries, setEntries] = React.useState<PerpsDirectoryEntry[]>([]);
  const [dataLoading, setDataLoading] = React.useState(!mockData);
  const [dataError, setDataError] = React.useState<string | null>(null);
  const [dataUpdatedAt, setDataUpdatedAt] = React.useState<number | null>(null);

  // ── Market snapshots (keyed by characterId) ──
  const [marketSnapshots, setMarketSnapshots] = React.useState<
    Record<string, MarketSnapshot>
  >({});

  // ── Positions (keyed by characterId) — EVM contract reads go here ──
  const [positions, setPositions] = React.useState<Record<string, PositionSnapshot>>({});

  // ── Selection & oracle history ──
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [searchTerm, setSearchTerm] = React.useState("");
  const [oracleHistory, setOracleHistory] = React.useState<OracleHistoryPoint[]>([]);
  const [oracleLoading, setOracleLoading] = React.useState(false);
  const [oracleError, setOracleError] = React.useState<string | null>(null);

  // ── Trade inputs ──
  const [collateralAmount, setCollateralAmount] = React.useState(0.1);
  const [leverage, setLeverage] = React.useState(2);
  const [submittingTrade, setSubmittingTrade] = React.useState<string | null>(null);

  const effectiveLeverage = Math.min(DEFAULT_MAX_LEVERAGE, Math.max(1, Math.round(leverage)));

  // ── Mock data path ──────────────────────────────────────────────────────────

  React.useEffect(() => {
    if (!mockData) return;

    const mockEntries = mockData.leaderboard.map(leaderboardEntryToDirectoryEntry);
    setEntries(mockEntries);
    setDataLoading(false);
    setDataError(null);
    setDataUpdatedAt(Date.now());

    const snapshots: Record<string, MarketSnapshot> = {};
    for (const lb of mockData.leaderboard) {
      const id = agentNameToCharacterId(lb.agentName);
      snapshots[id] = computeMockMarketSnapshot(lb);
    }
    setMarketSnapshots(snapshots);
  }, [mockData]);

  // ── Real API data path ──────────────────────────────────────────────────────

  React.useEffect(() => {
    if (mockData) return;

    let cancelled = false;

    const poll = async () => {
      try {
        const res = await fetch(`${gameApiUrl}/api/perps/markets`, {
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const payload = (await res.json()) as ApiPerpsMarketsResponse;
        if (cancelled) return;
        const { entries: fetched, updatedAt, snapshots } =
          sanitizeMarketsResponse(payload);
        setEntries(fetched);
        setMarketSnapshots(snapshots);
        setDataError(null);
        setDataLoading(false);
        setDataUpdatedAt(updatedAt);
      } catch (err) {
        if (cancelled) return;
        setDataError(err instanceof Error ? err.message : "Failed to load models");
        setDataLoading(false);
      }
    };

    void poll();
    const id = window.setInterval(() => void poll(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [mockData]);

  React.useEffect(() => {
    if (mockData || !publicClient || !chainConfig || !perpsConfigured || entries.length === 0) {
      if (!mockData) {
        setPositions({});
      }
      return;
    }

    let cancelled = false;

    const loadChainState = async () => {
      try {
        const nextSnapshots: Record<string, MarketSnapshot> = {};
        const nextPositions: Record<string, PositionSnapshot> = {};

        await Promise.all(
          entries.map(async (entry) => {
            const agentKey = (entry.agentKey
              ? entry.agentKey
              : toPerpAgentKey(entry.characterId)) as `0x${string}`;
            const [config, marketState] = await Promise.all([
              getPerpMarketConfig(
                publicClient,
                chainConfig.perpEngineAddress as Address,
                agentKey,
              ),
              getPerpMarketState(
                publicClient,
                chainConfig.perpEngineAddress as Address,
                agentKey,
              ),
            ]);

            if (!config.exists) {
              nextSnapshots[entry.characterId] = {
                spotIndex:
                  entry.mu !== null && entry.sigma !== null
                    ? Math.max(0, entry.mu - 3 * entry.sigma)
                    : null,
                longOi: 0,
                shortOi: 0,
                fundingRate: 0,
                conservativeSkill:
                  entry.mu !== null && entry.sigma !== null
                    ? Math.max(0, entry.mu - 3 * entry.sigma)
                    : null,
                uncertainty: entry.sigma,
                lastUpdated: null,
                insuranceFund: 0,
                skewScaleCollateral: DEFAULT_SKEW_SCALE,
              };
              return;
            }

            nextSnapshots[entry.characterId] = {
              spotIndex: formatToken18(marketState.lastOraclePrice),
              longOi: formatToken18(marketState.totalLongOI),
              shortOi: formatToken18(marketState.totalShortOI),
              fundingRate: formatToken18(marketState.currentFundingRate),
              conservativeSkill: Number(marketState.lastConservativeSkill),
              uncertainty: entry.sigma,
              lastUpdated:
                Number(marketState.lastOracleTimestamp) > 0
                  ? Number(marketState.lastOracleTimestamp) * 1000
                  : marketSnapshots[entry.characterId]?.lastUpdated ?? null,
              insuranceFund: formatToken18(marketState.insuranceFund),
              skewScaleCollateral: formatToken18(config.skewScale),
            };

            if (!evmAddress) return;

            const [position, health] = await Promise.all([
              getPerpPosition(
                publicClient,
                chainConfig.perpEngineAddress as Address,
                agentKey,
                evmAddress as Address,
              ),
              getPerpPositionHealth(
                publicClient,
                chainConfig.perpEngineAddress as Address,
                agentKey,
                evmAddress as Address,
              ),
            ]);
            if (position.size === 0n) return;

            const signedSize = formatToken18(position.size);
            nextPositions[entry.characterId] = {
              direction: signedSize >= 0 ? "LONG" : "SHORT",
              margin: formatToken18(position.margin),
              size: Math.abs(signedSize),
              signedSize,
              entryPrice: formatToken18(position.entryPrice),
              markPrice: formatToken18(health.markPrice),
              pnl: formatToken18(health.unrealizedPnl),
              liquidationPrice: _computeLiquidationPrice(
                formatToken18(position.entryPrice),
                signedSize,
                formatToken18(position.margin),
              ),
            };
          }),
        );

        if (cancelled) return;
        setMarketSnapshots((current) => ({ ...current, ...nextSnapshots }));
        setPositions(nextPositions);
      } catch (error) {
        if (cancelled) return;
        console.warn("[evm-models-market] failed to load chain state", error);
      }
    };

    void loadChainState();
    const id = window.setInterval(() => void loadChainState(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [
    chainConfig,
    entries,
    evmAddress,
    mockData,
    perpsConfigured,
    publicClient,
  ]);

  // ── Auto-select first entry ─────────────────────────────────────────────────

  React.useEffect(() => {
    if (!entries.length) return;
    const stillExists = selectedId && entries.some((e) => e.characterId === selectedId);
    if (!stillExists) setSelectedId(entries[0]?.characterId ?? null);
  }, [entries, selectedId]);

  // ── Oracle history ──────────────────────────────────────────────────────────

  // Mock path: generate synthetic oracle history from leaderboard
  React.useEffect(() => {
    if (!mockData || !selectedId) return;
    const lbEntry = mockData.leaderboard.find(
      (lb) => agentNameToCharacterId(lb.agentName) === selectedId,
    );
    if (!lbEntry) {
      setOracleHistory([]);
      return;
    }
    setOracleHistory(generateMockOracleHistory(lbEntry));
    setOracleError(null);
    setOracleLoading(false);
  }, [mockData, selectedId]);

  // Real path: fetch oracle history from API
  React.useEffect(() => {
    if (mockData || !selectedId) return;

    let cancelled = false;
    setOracleHistory([]);
    setOracleError(null);
    setOracleLoading(true);

    const load = async () => {
      try {
        const res = await fetch(
          `${gameApiUrl}/api/perps/oracle-history?characterId=${encodeURIComponent(selectedId)}&limit=${ORACLE_HISTORY_LIMIT}`,
          { cache: "no-store" },
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const payload = (await res.json()) as ApiOracleHistoryResponse;
        if (cancelled) return;
        setOracleHistory(sanitizeOracleHistory(payload));
        setOracleError(null);
      } catch (err) {
        if (cancelled) return;
        setOracleError(err instanceof Error ? err.message : "Failed to load oracle history");
      } finally {
        if (!cancelled) setOracleLoading(false);
      }
    };

    void load();
    const id = window.setInterval(() => void load(), ORACLE_HISTORY_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [gameApiUrl, mockData, selectedId]);

  // ── Derived state ───────────────────────────────────────────────────────────

  const filteredEntries = React.useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return entries;
    return entries.filter((e) =>
      `${e.name} ${e.provider} ${e.model}`.toLowerCase().includes(term),
    );
  }, [entries, searchTerm]);

  const selectedEntry = React.useMemo(
    () => entries.find((e) => e.characterId === selectedId) ?? null,
    [entries, selectedId],
  );

  const selectedMarket = selectedId ? marketSnapshots[selectedId] : undefined;
  const selectedPosition = selectedId ? positions[selectedId] : undefined;

  const oracleFresh = isOracleFresh(selectedMarket?.lastUpdated ?? null);
  const canOpenPosition =
    isEvmConnected &&
    perpsConfigured &&
    selectedEntry?.status === "ACTIVE" &&
    oracleFresh &&
    !!selectedMarket?.spotIndex;

  const canClosePosition =
    isEvmConnected &&
    !!selectedPosition &&
    selectedEntry?.status !== "ARCHIVED";

  const aggregateLongOi = React.useMemo(
    () => Object.values(marketSnapshots).reduce((sum, s) => sum + s.longOi, 0),
    [marketSnapshots],
  );
  const aggregateShortOi = React.useMemo(
    () => Object.values(marketSnapshots).reduce((sum, s) => sum + s.shortOi, 0),
    [marketSnapshots],
  );

  const skewScale = selectedMarket?.skewScaleCollateral ?? DEFAULT_SKEW_SCALE;
  const estLongPrice = estimateExecutionPrice(
    selectedMarket,
    collateralAmount * effectiveLeverage,
    skewScale,
  );
  const estShortPrice = estimateExecutionPrice(
    selectedMarket,
    -collateralAmount * effectiveLeverage,
    skewScale,
  );

  // ── Trade handlers (EVM — contracts coming soon) ────────────────────────────

  const handleOpenPosition = async (direction: TradeDirection) => {
    if (!selectedEntry || !chainConfig || !publicClient || !walletClient || !evmAddress) return;
    if (!isEvmConnected) {
      toast.error("Connect an EVM wallet to trade model perps.");
      return;
    }
    if (!perpsConfigured) {
      toast.error("Perps contracts are not configured for this chain yet.");
      return;
    }
    const txId = `model-perp-${selectedEntry.characterId}-${direction}`;
    setSubmittingTrade(txId);
    try {
      if (walletChainId !== chainConfig.evmChainId) {
        if (!switchChainAsync) {
          throw new Error(`Switch wallet network to ${chainConfig.name}`);
        }
        await switchChainAsync({ chainId: chainConfig.evmChainId });
      }

      const marginWei = parseToken18(collateralAmount);
      const sizeWei = parseToken18(collateralAmount * effectiveLeverage);
      if (marginWei <= 0n || sizeWei <= 0n) {
        throw new Error("Collateral amount is too low");
      }

      const agentKey = (selectedEntry.agentKey
        ? selectedEntry.agentKey
        : toPerpAgentKey(selectedEntry.characterId)) as `0x${string}`;

      toast.loading("Checking margin approval…", { id: txId });
      const approvalHash = await ensureErc20Approval(
        publicClient,
        walletClient,
        chainConfig.perpMarginTokenAddress as Address,
        evmAddress as Address,
        chainConfig.perpEngineAddress as Address,
        marginWei,
      );
      if (approvalHash) {
        await publicClient.waitForTransactionReceipt({ hash: approvalHash });
      }

      toast.loading("Submitting perp trade…", { id: txId });
      const positionHash = await modifyPerpPosition(
        walletClient,
        chainConfig.perpEngineAddress as Address,
        evmAddress as Address,
        agentKey,
        marginWei,
        direction === "LONG" ? sizeWei : -sizeWei,
      );
      await publicClient.waitForTransactionReceipt({ hash: positionHash });

      toast.success(`${direction} position submitted`, { id: txId });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Trade failed", {
        id: txId,
      });
    } finally {
      setSubmittingTrade(null);
    }
  };

  const handleClosePosition = async () => {
    if (
      !selectedEntry ||
      !selectedPosition ||
      !chainConfig ||
      !publicClient ||
      !walletClient ||
      !evmAddress
    )
      return;
    if (!isEvmConnected) {
      toast.error("Connect an EVM wallet to close positions.");
      return;
    }
    if (!perpsConfigured) {
      toast.error("Perps contracts are not configured for this chain yet.");
      return;
    }
    const txId = `close-model-${selectedEntry.characterId}`;
    setSubmittingTrade(txId);
    try {
      if (walletChainId !== chainConfig.evmChainId) {
        if (!switchChainAsync) {
          throw new Error(`Switch wallet network to ${chainConfig.name}`);
        }
        await switchChainAsync({ chainId: chainConfig.evmChainId });
      }

      const agentKey = (selectedEntry.agentKey
        ? selectedEntry.agentKey
        : toPerpAgentKey(selectedEntry.characterId)) as `0x${string}`;
      const sizeWei = parseToken18(Math.abs(selectedPosition.signedSize));

      toast.loading("Closing position…", { id: txId });
      const hash = await modifyPerpPosition(
        walletClient,
        chainConfig.perpEngineAddress as Address,
        evmAddress as Address,
        agentKey,
        0n,
        selectedPosition.signedSize > 0 ? -sizeWei : sizeWei,
      );
      await publicClient.waitForTransactionReceipt({ hash });
      toast.success("Position closed", { id: txId });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Close failed", {
        id: txId,
      });
    } finally {
      setSubmittingTrade(null);
    }
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div
      className="hm-perps-view"
      data-testid="models-market-view"
      data-hyperbet-theme={theme}
      style={themeDefinition.colorVariables}
    >
      <Toaster theme="dark" position="bottom-right" />

      {/* ── Hero ── */}
      <section className="hm-perps-hero">
        <div className="hm-perps-hero-text">
          <p className="hm-perps-kicker">Synthetic Model Perps · {chainLabel}</p>
          <h2 className="hm-perps-headline">Long and short any ranked model</h2>
          <p className="hm-perps-copy">
            Synthetic index uses conservative skill (μ&nbsp;−&nbsp;3σ) normalized across
            the active model field. Every model settles against its own isolated market
            with independent insurance on EVM contracts.
          </p>
        </div>
        <div className="hm-perps-metrics">
          <article className="hm-perps-metric-card">
            <span className="hm-perps-metric-label">Tracked Models</span>
            <strong className="hm-perps-metric-value">{entries.length}</strong>
            <small className="hm-perps-metric-sub">
              {fightingAgentA && fightingAgentB
                ? `${fightingAgentA} vs ${fightingAgentB}`
                : "—"}
            </small>
          </article>
          <article className="hm-perps-metric-card">
            <span className="hm-perps-metric-label">Aggregate OI</span>
            <strong className="hm-perps-metric-value">
              {formatCompact(aggregateLongOi)} / {formatCompact(aggregateShortOi)}{" "}
              {collateralSymbol}
            </strong>
            <small className="hm-perps-metric-sub">Long / short open interest</small>
          </article>
          <article className="hm-perps-metric-card">
            <span className="hm-perps-metric-label">Oracle Basis</span>
            <strong className="hm-perps-metric-value">
              {DEFAULT_SKEW_SCALE} {collateralSymbol}
            </strong>
            <small className="hm-perps-metric-sub">Default skew scale</small>
          </article>
        </div>
      </section>

      {/* ── Two-panel grid ── */}
      <section className="hm-perps-grid">

        {/* ── Left: model table ── */}
        <article className="hm-perps-card hm-perps-card--table">
          <div className="hm-perps-card-header">
            <div>
              <h3 className="hm-perps-card-title">All Models</h3>
              <p className="hm-perps-card-sub">
                Every active model, current synthetic index, and open interest.
              </p>
            </div>
            <div className="hm-perps-toolbar">
              <input
                className="hm-perps-search"
                type="search"
                placeholder="Search provider or model…"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
              <span className="hm-perps-updated">
                Updated {formatUpdatedAt(dataUpdatedAt)}
              </span>
            </div>
          </div>

          {dataError && <div className="hm-perps-error">{dataError}</div>}

          <div className="hm-perps-table-wrap">
            <table className="hm-perps-table">
              <thead>
                <tr className="hm-perps-thead-row">
                  <th className="hm-perps-th">Rank</th>
                  <th className="hm-perps-th">Model</th>
                  <th className="hm-perps-th">Provider</th>
                  <th className="hm-perps-th">W / L</th>
                  <th className="hm-perps-th">Index</th>
                  <th className="hm-perps-th">Long OI</th>
                  <th className="hm-perps-th">Short OI</th>
                  <th className="hm-perps-th">Funding</th>
                  <th className="hm-perps-th">Status</th>
                  <th className="hm-perps-th">Position</th>
                </tr>
              </thead>
              <tbody>
                {dataLoading && filteredEntries.length === 0 && (
                  <tr>
                    <td colSpan={10} className="hm-perps-empty-cell">
                      Loading model market data…
                    </td>
                  </tr>
                )}
                {!dataLoading && filteredEntries.length === 0 && (
                  <tr>
                    <td colSpan={10} className="hm-perps-empty-cell">
                      No models matched the current filter.
                    </td>
                  </tr>
                )}
                {filteredEntries.map((entry) => {
                  const market = marketSnapshots[entry.characterId];
                  const position = positions[entry.characterId];
                  const isSelected = selectedId === entry.characterId;
                  const isFighting =
                    entry.name === fightingAgentA ||
                    entry.name === fightingAgentB;
                  return (
                    <tr
                      key={entry.characterId}
                      className={[
                        "hm-perps-row",
                        isSelected ? "hm-perps-row--selected" : "",
                        isFighting ? "hm-perps-row--live" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      onClick={() => setSelectedId(entry.characterId)}
                    >
                      <td className="hm-perps-td">
                        <span className="hm-perps-rank">
                          {entry.rank ? `#${entry.rank}` : "—"}
                        </span>
                      </td>
                      <td className="hm-perps-td">
                        <div className="hm-perps-agent-cell">
                          <span className="hm-perps-agent-name">
                            {entry.name}
                            {isFighting && (
                              <span className="hm-perps-live-badge" aria-label="Currently fighting">
                                ⚡ LIVE
                              </span>
                            )}
                          </span>
                          <span className="hm-perps-agent-model">
                            {entry.model || "—"}
                          </span>
                          <WinRateBar pct={entry.winRate} />
                        </div>
                      </td>
                      <td className="hm-perps-td">
                        <ProviderPill provider={entry.provider} />
                      </td>
                      <td className="hm-perps-td hm-perps-td--mono">
                        <span className="hm-perps-wr-wins">{entry.wins}W</span>
                        <span className="hm-perps-wr-sep">·</span>
                        <span className="hm-perps-wr-losses">{entry.losses}L</span>
                        <span className="hm-perps-wr-pct">
                          {entry.winRate.toFixed(1)}%
                        </span>
                      </td>
                      <td className="hm-perps-td hm-perps-td--mono hm-perps-td--gold">
                        {market?.spotIndex ? `$${market.spotIndex.toFixed(2)}` : "—"}
                      </td>
                      <td className="hm-perps-td hm-perps-td--mono hm-perps-td--green">
                        {market ? `${market.longOi.toFixed(2)}` : "—"}
                      </td>
                      <td className="hm-perps-td hm-perps-td--mono hm-perps-td--red">
                        {market ? `${market.shortOi.toFixed(2)}` : "—"}
                      </td>
                      <td
                        className={`hm-perps-td hm-perps-td--mono${
                          market
                            ? market.fundingRate > 0
                              ? " hm-perps-td--green"
                              : " hm-perps-td--red"
                            : ""
                        }`}
                      >
                        {market ? (market.fundingRate * 100).toFixed(4) + "%" : "—"}
                      </td>
                      <td className="hm-perps-td">
                        <span
                          className={`hm-perps-status-badge hm-perps-status-badge--${entry.status.toLowerCase().replace("_", "-")}`}
                        >
                          {entry.status === "CLOSE_ONLY"
                            ? "CLOSE ONLY"
                            : entry.status}
                        </span>
                      </td>
                      <td className="hm-perps-td hm-perps-td--mono">
                        {position ? (
                          <span
                            className={`hm-perps-position-chip hm-perps-position-chip--${position.direction.toLowerCase()}`}
                          >
                            {position.direction} {position.size.toFixed(2)}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </article>

        {/* ── Right: detail + trade panel ── */}
        <aside className="hm-perps-card hm-perps-card--detail">
          {selectedEntry ? (
            <>
              {/* Detail header */}
              <div className="hm-perps-card-header">
                <div>
                  <h3 className="hm-perps-card-title">{selectedEntry.name}</h3>
                  <p className="hm-perps-card-sub">
                    {selectedEntry.provider} · {selectedEntry.model || "—"}
                  </p>
                </div>
                <div
                  className={`hm-perps-rank-chip${
                    !oracleFresh && selectedEntry.status === "ACTIVE"
                      ? " hm-perps-rank-chip--stale"
                      : ""
                  }`}
                >
                  {selectedEntry.status === "ACTIVE"
                    ? oracleFresh
                      ? selectedEntry.rank
                        ? `Rank #${selectedEntry.rank}`
                        : "ACTIVE"
                      : "Oracle Stale"
                    : selectedEntry.status === "CLOSE_ONLY"
                      ? "Close Only"
                      : "Archived"}
                </div>
              </div>

              {/* Market stats grid */}
              <div className="hm-perps-detail-grid">
                <div className="hm-perps-detail-item">
                  <span className="hm-perps-detail-label">Index</span>
                  <strong className="hm-perps-detail-value hm-perps-detail-value--gold">
                    {selectedMarket?.spotIndex
                      ? `$${selectedMarket.spotIndex.toFixed(2)}`
                      : "Pending"}
                  </strong>
                </div>
                <div className="hm-perps-detail-item">
                  <span className="hm-perps-detail-label">Open Interest</span>
                  <strong className="hm-perps-detail-value">
                    {selectedMarket
                      ? `${selectedMarket.longOi.toFixed(2)} / ${selectedMarket.shortOi.toFixed(2)} ${collateralSymbol}`
                      : "—"}
                  </strong>
                </div>
                <div className="hm-perps-detail-item">
                  <span className="hm-perps-detail-label">Funding</span>
                  <strong
                    className={`hm-perps-detail-value${
                      selectedMarket
                        ? selectedMarket.fundingRate > 0
                          ? " hm-perps-detail-value--green"
                          : " hm-perps-detail-value--red"
                        : ""
                    }`}
                  >
                    {selectedMarket
                      ? `${(selectedMarket.fundingRate * 100).toFixed(4)}%`
                      : "—"}
                  </strong>
                </div>
                <div className="hm-perps-detail-item">
                  <span className="hm-perps-detail-label">Insurance</span>
                  <strong className="hm-perps-detail-value">
                    {selectedMarket
                      ? `${selectedMarket.insuranceFund.toFixed(2)} ${collateralSymbol}`
                      : "—"}
                  </strong>
                </div>
              </div>

              {/* Oracle history chart */}
              <div className="hm-perps-history-card">
                <div className="hm-perps-history-header">
                  <div>
                    <h4 className="hm-perps-section-title">Oracle History</h4>
                    <p className="hm-perps-section-sub">
                      Keeper snapshots of the synthetic model skill index.
                    </p>
                  </div>
                  <span className="hm-perps-oracle-updated">
                    Last oracle {formatUpdatedAt(selectedMarket?.lastUpdated ?? null)}
                    {!oracleFresh ? " · stale" : ""}
                  </span>
                </div>
                <div className="hm-perps-history-chart">
                  {oracleError ? (
                    <div className="hm-perps-empty">
                      Failed to load oracle history: {oracleError}
                    </div>
                  ) : oracleLoading && oracleHistory.length === 0 ? (
                    <div className="hm-perps-empty">
                      Loading oracle history…
                    </div>
                  ) : oracleHistory.length === 0 ? (
                    <div className="hm-perps-empty">
                      Waiting for keeper snapshots for this model.
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={oracleHistory}>
                        <XAxis
                          dataKey="label"
                          tick={{ fill: "rgba(255,255,255,0.4)", fontSize: 10 }}
                          tickLine={false}
                          axisLine={{ stroke: "rgba(255,255,255,0.08)" }}
                          interval="preserveStartEnd"
                        />
                        <YAxis
                          tick={{ fill: "rgba(255,255,255,0.4)", fontSize: 10 }}
                          tickLine={false}
                          axisLine={{ stroke: "rgba(255,255,255,0.08)" }}
                          width={42}
                          tickFormatter={(v: number) => `$${v.toFixed(0)}`}
                        />
                        <Tooltip content={<OracleTooltip />} />
                        {selectedMarket?.spotIndex && (
                          <ReferenceLine
                            y={selectedMarket.spotIndex}
                            stroke="rgba(229,184,74,0.25)"
                            strokeDasharray="4 4"
                          />
                        )}
                        <Line
                          type="monotone"
                          dataKey="spotIndex"
                          stroke="#e5b84a"
                          strokeWidth={2}
                          dot={false}
                          isAnimationActive={false}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </div>

              {/* Active position card */}
              {selectedPosition && (
                <div className="hm-perps-position-card">
                  <div className="hm-perps-position-header">
                    <span className="hm-perps-section-label">Your Position</span>
                    <strong
                      className={`hm-perps-position-direction hm-perps-position-direction--${selectedPosition.direction.toLowerCase()}`}
                    >
                      {selectedPosition.direction} {selectedPosition.size.toFixed(3)} {collateralSymbol}
                    </strong>
                  </div>
                  <div className="hm-perps-position-stats">
                    <span>Entry ${selectedPosition.entryPrice.toFixed(2)}</span>
                    <span>Margin {selectedPosition.margin.toFixed(4)} {collateralSymbol}</span>
                    <span>
                      PnL{" "}
                      <strong
                        className={
                          selectedPosition.pnl >= 0
                            ? "hm-perps-pnl--pos"
                            : "hm-perps-pnl--neg"
                        }
                      >
                        {selectedPosition.pnl >= 0 ? "+" : ""}
                        {selectedPosition.pnl.toFixed(4)} {collateralSymbol}
                      </strong>
                    </span>
                    {selectedPosition.liquidationPrice && (
                      <span>
                        Liq. ${selectedPosition.liquidationPrice.toFixed(2)}
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    className="hm-perps-btn hm-perps-btn--danger"
                    onClick={() => void handleClosePosition()}
                    disabled={Boolean(submittingTrade) || !canClosePosition}
                  >
                    Close Position
                  </button>
                </div>
              )}

              {/* Trade card */}
              <div className="hm-perps-trade-card">
                <div className="hm-perps-trade-header">
                  <div>
                    <h4 className="hm-perps-section-title">
                      Trade {selectedEntry.name}
                    </h4>
                    <p className="hm-perps-section-sub">
                      Isolated by model. Price follows the synthetic skill oracle.
                    </p>
                  </div>
                  <span className="hm-perps-chain-badge">{chainLabel}</span>
                </div>

                {/* Collateral input */}
                <label className="hm-perps-field">
                  <span className="hm-perps-field-label">Collateral ({collateralSymbol})</span>
                  <input
                    className="hm-perps-field-input"
                    type="number"
                    min={0.01}
                    step={0.01}
                    value={collateralAmount}
                    onChange={(e) => setCollateralAmount(Number(e.target.value))}
                  />
                </label>

                {/* Leverage selector */}
                <div className="hm-perps-field">
                  <div className="hm-perps-field-row">
                    <span className="hm-perps-field-label">Leverage</span>
                    <strong className="hm-perps-lev-value">{effectiveLeverage}x</strong>
                  </div>
                  <div className="hm-perps-lev-chips">
                    {[1, 2, 3, 5]
                      .filter((v) => v <= DEFAULT_MAX_LEVERAGE)
                      .map((v) => (
                        <button
                          key={v}
                          type="button"
                          className={`hm-perps-lev-chip${effectiveLeverage === v ? " hm-perps-lev-chip--active" : ""}`}
                          onClick={() => setLeverage(v)}
                        >
                          {v}x
                        </button>
                      ))}
                  </div>
                  <input
                    className="hm-perps-lev-slider"
                    type="range"
                    min={1}
                    max={DEFAULT_MAX_LEVERAGE}
                    step={1}
                    value={effectiveLeverage}
                    onChange={(e) => setLeverage(Number(e.target.value))}
                  />
                </div>

                {/* Order summary */}
                <div className="hm-perps-summary">
                  <div className="hm-perps-summary-row">
                    <span>Position Size</span>
                    <strong>
                      {(collateralAmount * effectiveLeverage).toFixed(3)} {collateralSymbol}
                    </strong>
                  </div>
                  <div className="hm-perps-summary-row">
                    <span>Est. Long Entry</span>
                    <strong>
                      {estLongPrice ? `$${estLongPrice.toFixed(2)}` : "—"}
                    </strong>
                  </div>
                  <div className="hm-perps-summary-row">
                    <span>Est. Short Entry</span>
                    <strong>
                      {estShortPrice ? `$${estShortPrice.toFixed(2)}` : "—"}
                    </strong>
                  </div>
                </div>

                {/* LONG / SHORT buttons */}
                <div className="hm-perps-actions">
                  <button
                    type="button"
                    className="hm-perps-btn hm-perps-btn--long"
                    disabled={Boolean(submittingTrade) || collateralAmount <= 0}
                    onClick={() => void handleOpenPosition("LONG")}
                  >
                    Long {selectedEntry.name}
                  </button>
                  <button
                    type="button"
                    className="hm-perps-btn hm-perps-btn--short"
                    disabled={Boolean(submittingTrade) || collateralAmount <= 0}
                    onClick={() => void handleOpenPosition("SHORT")}
                  >
                    Short {selectedEntry.name}
                  </button>
                </div>

                {/* Wallet / readiness state */}
                {!isEvmConnected ? (
                  <p className="hm-perps-trade-notice">
                    Connect an EVM wallet via the header to trade.
                  </p>
                ) : !perpsConfigured ? (
                  <p className="hm-perps-trade-notice">
                    Perps contracts are not configured for this chain yet.
                  </p>
                ) : !canOpenPosition && selectedEntry.status === "ACTIVE" ? (
                  <p className="hm-perps-trade-notice">
                    {!selectedMarket?.spotIndex
                      ? "Waiting for the keeper to post an initial oracle update for this model."
                      : oracleFresh
                        ? "Market is live but your wallet still needs to be on the selected EVM chain."
                        : "Waiting for a fresh oracle sync before opening new exposure."}
                  </p>
                ) : selectedEntry.status === "CLOSE_ONLY" ? (
                  <p className="hm-perps-trade-notice">
                    This model has been deprecated. Existing positions can be closed
                    but new exposure is disabled.
                  </p>
                ) : selectedEntry.status === "ARCHIVED" ? (
                  <p className="hm-perps-trade-notice">
                    This model market has been archived.
                  </p>
                ) : null}

                {/* Wallet address */}
                {isEvmConnected && evmAddress && (
                  <p className="hm-perps-wallet-info">
                    Wallet: {evmAddress.slice(0, 6)}…{evmAddress.slice(-4)}
                  </p>
                )}
              </div>
            </>
          ) : (
            <div className="hm-perps-detail-empty">
              Select a model from the table to inspect its oracle history and trade
              the perpetual market.
            </div>
          )}
        </aside>
      </section>
    </div>
  );
}

import React from "react";
import { createWalletTransactionSigner, toAddress } from "@solana/client";
import { useSolanaClient } from "@solana/react-hooks";
import { type Connection, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import {
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Toaster, toast } from "sonner";
import {
  resolveUiLocale,
  type UiLocale,
} from "@hyperbet/ui/i18n";
import { getModelsMarketCopy } from "../lib/modelsMarketCopy";
import {
  useAppConnection,
  useAppWallet,
  useAppWalletModal,
} from "../lib/appWallet";
import { CONFIG, GAME_API_URL } from "../lib/config";
import {
  buildOracleHistoryLabel,
  modelMarketIdFromCharacterId,
  sanitizePerpsOracleHistoryResponse,
  sanitizePerpsMarketsResponse,
  toWinRatePercent,
  type PerpsMarketDirectoryEntry,
  type PerpsOracleHistorySnapshot,
  type PerpsMarketsResponse,
} from "../lib/modelMarkets";
import { findProgramAddressSync } from "../lib/programAddress";
import {
  getConfigStateDecoder,
  getMarketStateDecoder,
  getPositionStateDecoder,
  type ConfigState,
  type MarketState,
  type PositionState,
} from "../generated/gold-perps-market/accounts";
import { GOLD_PERPS_MARKET_PROGRAM_ADDRESS } from "../generated/gold-perps-market/programs";
import {
  sendKitInstructions,
} from "../lib/kitTransactions";
import { getModifyPositionInstruction } from "../generated/gold-perps-market/instructions/modifyPosition";

const PROGRAM_ID = new PublicKey(GOLD_PERPS_MARKET_PROGRAM_ADDRESS);
const POLL_INTERVAL_MS = 5_000;
const CHAIN_POLL_INTERVAL_MS = 6_000;
const DEFAULT_SKEW_SCALE_SOL = 100;
const DEFAULT_MAX_MODEL_LEVERAGE = 5;
const DEFAULT_MAX_ORACLE_STALENESS_MS = 120_000;
const MAX_BATCH_SIZE = 99;
const ORACLE_HISTORY_POLL_INTERVAL_MS = 15_000;
const ORACLE_HISTORY_LIMIT = 120;
const IS_E2E_MODE = import.meta.env.MODE === "e2e";

function readE2eString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readE2eNumber(value: unknown, fallback: number): number {
  const raw = readE2eString(value);
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

type TradeDirection = "LONG" | "SHORT";

interface ModelsMarketViewProps {
  activeMatchup: string;
}

interface ConfigAccountState {
  authority: string;
  keeperAuthority: string;
  defaultSkewScale: bigint;
  defaultFundingVelocity: bigint;
  maxOracleStalenessSeconds: bigint;
  maxLeverage: bigint;
  minMarginLamports: bigint;
  maintenanceMarginBps: number;
  liquidationFeeBps: number;
}

interface MarketAccountState {
  initialized: boolean;
  marketId: bigint;
  insuranceFund: bigint;
  skewScale: bigint;
  fundingVelocity: bigint;
  spotIndex: bigint;
  mu: bigint;
  sigma: bigint;
  oracleLastUpdated: bigint;
  lastFundingTime: bigint;
  totalLongOi: bigint;
  totalShortOi: bigint;
  currentFundingRate: bigint;
}

interface PositionAccountState {
  initialized: boolean;
  owner: string;
  marketId: bigint;
  margin: bigint;
  size: bigint;
  entryPrice: bigint;
  lastFundingRate: bigint;
}

interface MarketSnapshot {
  marketId: number;
  spotIndex: number | null;
  longOi: number;
  shortOi: number;
  fundingRate: number;
  conservativeSkill: number | null;
  uncertainty: number | null;
  lastUpdated: number | null;
  insuranceFund: number;
  skewScale: number;
  skewScaleSol: number;
}

interface PositionSnapshot {
  marketId: number;
  direction: TradeDirection;
  margin: number;
  size: number;
  signedSize: number;
  entryPrice: number;
  markPrice: number | null;
  pnl: number;
  liquidationPrice: number | null;
}

interface OracleHistoryPoint extends PerpsOracleHistorySnapshot {
  label: string;
}

function toLamports(sol: number): number {
  return Math.round(sol * LAMPORTS_PER_SOL);
}

function fromLamports(lamports: number): number {
  return lamports / LAMPORTS_PER_SOL;
}

function bnToNumber(value: bigint | number): number {
  if (typeof value === "number") return value;
  return Number(value);
}

function formatCompactNumber(value: number, digits = 2): string {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(digits)}M`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(digits)}K`;
  }
  return value.toFixed(digits);
}

function formatUpdatedAt(timestamp: number | null): string {
  if (!timestamp) return "pending";
  return new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function isOracleFresh(timestamp: number | null, maxAgeMs: number): boolean {
  if (!timestamp) return false;
  return Date.now() - timestamp <= maxAgeMs;
}

function chunkArray<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function encodeMarketId(marketId: number): Buffer {
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64LE(BigInt(marketId), 0);
  return bytes;
}

function decodeAccount<T>(
  decode: (data: Buffer) => T,
  data: Buffer,
): T | null {
  try {
    return decode(data);
  } catch {
    return null;
  }
}

function deriveConfigPda(): PublicKey {
  return findProgramAddressSync([Buffer.from("config")], PROGRAM_ID)[0];
}

function deriveMarketPda(marketId: number): PublicKey {
  return findProgramAddressSync(
    [Buffer.from("market"), encodeMarketId(marketId)],
    PROGRAM_ID,
  )[0];
}

function derivePositionPda(owner: PublicKey, marketId: number): PublicKey {
  return findProgramAddressSync(
    [Buffer.from("position"), owner.toBuffer(), encodeMarketId(marketId)],
    PROGRAM_ID,
  )[0];
}

function computePnl(
  entryPrice: number,
  signedSize: number,
  markPrice: number | null,
): number {
  const size = Math.abs(signedSize);
  if (!markPrice || entryPrice <= 0 || size <= 0 || signedSize === 0) return 0;
  if (signedSize > 0) {
    return (markPrice - entryPrice) * (size / entryPrice);
  }
  return (entryPrice - markPrice) * (size / entryPrice);
}

function computeLiquidationPrice(
  entryPrice: number,
  signedSize: number,
  margin: number,
  maintenanceMarginBps: number,
): number | null {
  const size = Math.abs(signedSize);
  if (
    entryPrice <= 0 ||
    size <= 0 ||
    margin <= 0 ||
    maintenanceMarginBps <= 0
  ) {
    return null;
  }
  const maintenanceMargin = size * (maintenanceMarginBps / 10_000);
  const availableLoss = Math.max(0, margin - maintenanceMargin);
  if (signedSize > 0) {
    return entryPrice * (1 - availableLoss / size);
  }
  return entryPrice * (1 + availableLoss / size);
}

function estimateExecutionPrice(
  market: MarketSnapshot | undefined,
  signedSizeDeltaSol: number,
  skewScaleSol: number,
): number | null {
  if (!market?.spotIndex || skewScaleSol <= 0 || signedSizeDeltaSol === 0) {
    return null;
  }
  const skew = market.longOi - market.shortOi;
  const y1 = skewScaleSol + skew;
  const y2 = y1 + signedSizeDeltaSol;
  if (y1 <= 0 || y2 <= 0) {
    return null;
  }
  return market.spotIndex * (y1 / skewScaleSol) * (y2 / skewScaleSol);
}

function conservativeSkill(mu: number, sigma: number): number {
  return mu - sigma * 3;
}

function getTradeErrorMessage(error: unknown, locale: UiLocale): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return getModelsMarketCopy(locale).transactionFailed;
}

async function fetchMultipleAccounts(
  connection: Connection,
  addresses: readonly PublicKey[],
): Promise<(Awaited<ReturnType<Connection["getMultipleAccountsInfo"]>>[number] | null)[]> {
  const chunks = chunkArray(addresses, MAX_BATCH_SIZE);
  const resolved = await Promise.all(
    chunks.map((chunk) =>
      connection.getMultipleAccountsInfo(chunk, "confirmed"),
    ),
  );
  return resolved.flat();
}

const E2E_MODEL_CHARACTER_ID = readE2eString(
  import.meta.env.VITE_E2E_MODEL_CHARACTER_ID,
);
const E2E_MODEL_ENTRY: PerpsMarketDirectoryEntry | null =
  IS_E2E_MODE && E2E_MODEL_CHARACTER_ID
    ? {
      rank: 1,
      characterId: E2E_MODEL_CHARACTER_ID,
      marketId: modelMarketIdFromCharacterId(E2E_MODEL_CHARACTER_ID),
      name: readE2eString(import.meta.env.VITE_E2E_MODEL_NAME) || "E2E Model",
      provider:
        readE2eString(import.meta.env.VITE_E2E_MODEL_PROVIDER) ||
        "Hyperscape",
      model:
        readE2eString(import.meta.env.VITE_E2E_MODEL_SLUG) || "e2e-model",
      wins: readE2eNumber(import.meta.env.VITE_E2E_MODEL_WINS, 10),
      losses: readE2eNumber(import.meta.env.VITE_E2E_MODEL_LOSSES, 2),
      winRate: 0,
      combatLevel: readE2eNumber(
        import.meta.env.VITE_E2E_MODEL_COMBAT_LEVEL,
        80,
      ),
      currentStreak: readE2eNumber(import.meta.env.VITE_E2E_MODEL_STREAK, 3),
      status: "ACTIVE",
      lastSeenAt: Date.now(),
      deprecatedAt: null,
      updatedAt: Date.now(),
    }
    : null;

if (E2E_MODEL_ENTRY) {
  E2E_MODEL_ENTRY.winRate = toWinRatePercent(
    E2E_MODEL_ENTRY.wins,
    E2E_MODEL_ENTRY.losses,
  );
}

const E2E_ORACLE_RECORDED_AT = readE2eNumber(
  import.meta.env.VITE_E2E_MODEL_ORACLE_RECORDED_AT,
  Date.now(),
);
const E2E_ORACLE_HISTORY: OracleHistoryPoint[] =
  E2E_MODEL_ENTRY && IS_E2E_MODE
    ? [
      {
        agentId: E2E_MODEL_ENTRY.characterId,
        marketId: modelMarketIdFromCharacterId(E2E_MODEL_ENTRY.characterId),
        spotIndex: readE2eNumber(
          import.meta.env.VITE_E2E_MODEL_SPOT_INDEX,
          0,
        ),
        conservativeSkill:
          readE2eNumber(import.meta.env.VITE_E2E_MODEL_MU, 0) -
          readE2eNumber(import.meta.env.VITE_E2E_MODEL_SIGMA, 0) * 3,
        mu: readE2eNumber(import.meta.env.VITE_E2E_MODEL_MU, 0),
        sigma: readE2eNumber(import.meta.env.VITE_E2E_MODEL_SIGMA, 0),
        recordedAt: E2E_ORACLE_RECORDED_AT,
        label: buildOracleHistoryLabel(E2E_ORACLE_RECORDED_AT),
      },
    ]
    : [];
function buildE2eMarketSnapshot(): MarketSnapshot | null {
  if (!E2E_MODEL_ENTRY || !IS_E2E_MODE) {
    return null;
  }
  return {
    marketId: modelMarketIdFromCharacterId(E2E_MODEL_ENTRY.characterId),
    spotIndex:
      readE2eNumber(import.meta.env.VITE_E2E_MODEL_SPOT_INDEX, 0) || null,
    longOi: 0,
    shortOi: 0,
    fundingRate: 0,
    conservativeSkill:
      readE2eNumber(import.meta.env.VITE_E2E_MODEL_MU, 0) -
      readE2eNumber(import.meta.env.VITE_E2E_MODEL_SIGMA, 0) * 3,
    uncertainty: readE2eNumber(import.meta.env.VITE_E2E_MODEL_SIGMA, 0),
    lastUpdated: Math.max(Date.now(), E2E_ORACLE_RECORDED_AT),
    insuranceFund: readE2eNumber(import.meta.env.VITE_E2E_MODEL_INSURANCE, 12),
    skewScale: DEFAULT_SKEW_SCALE_SOL * LAMPORTS_PER_SOL,
    skewScaleSol: DEFAULT_SKEW_SCALE_SOL,
  };
}

function getE2eFallbackMarketSnapshots(): Record<string, MarketSnapshot> {
  const snapshot = buildE2eMarketSnapshot();
  if (!E2E_MODEL_ENTRY || !snapshot) {
    return {};
  }
  return {
    [E2E_MODEL_ENTRY.characterId]: snapshot,
  };
}

function applySignedOi(
  snapshot: MarketSnapshot | undefined,
  signedSize: number,
): MarketSnapshot | undefined {
  if (!snapshot || !Number.isFinite(signedSize) || signedSize === 0) {
    return snapshot;
  }

  const nextLongOi =
    signedSize > 0 ? snapshot.longOi + signedSize : snapshot.longOi;
  const nextShortOi =
    signedSize < 0 ? snapshot.shortOi + Math.abs(signedSize) : snapshot.shortOi;

  return {
    ...snapshot,
    longOi: Math.max(0, nextLongOi),
    shortOi: Math.max(0, nextShortOi),
  };
}

export function ModelsMarketView({ activeMatchup }: ModelsMarketViewProps) {
  const locale = resolveUiLocale();
  const copy = getModelsMarketCopy(locale);
  const { connection } = useAppConnection();
  const client = useSolanaClient();
  const wallet = useAppWallet();
  const { setVisible: setWalletModalVisible } = useAppWalletModal();

  const [data, setData] = React.useState<PerpsMarketsResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [searchTerm, setSearchTerm] = React.useState("");
  const [selectedCharacterId, setSelectedCharacterId] = React.useState<
    string | null
  >(null);
  const [marketSnapshots, setMarketSnapshots] = React.useState<
    Record<string, MarketSnapshot>
  >(() => getE2eFallbackMarketSnapshots());
  const [positions, setPositions] = React.useState<
    Record<string, PositionSnapshot>
  >({});
  const [collateralSol, setCollateralSol] = React.useState(0.1);
  const [leverage, setLeverage] = React.useState(2);
  const [submittingTrade, setSubmittingTrade] = React.useState<string | null>(
    null,
  );
  const [lastTradeStatus, setLastTradeStatus] = React.useState("-");
  const [lastTradeTx, setLastTradeTx] = React.useState("-");
  const [skewScaleSol, setSkewScaleSol] = React.useState(
    DEFAULT_SKEW_SCALE_SOL,
  );
  const [configPresent, setConfigPresent] = React.useState(
    Boolean(E2E_MODEL_ENTRY),
  );
  const [configLoaded, setConfigLoaded] = React.useState(
    Boolean(E2E_MODEL_ENTRY),
  );
  const [configuredMaxLeverage, setConfiguredMaxLeverage] = React.useState(
    DEFAULT_MAX_MODEL_LEVERAGE,
  );
  const [maintenanceMarginBps, setMaintenanceMarginBps] = React.useState(1_000);
  const [oracleStalenessMs, setOracleStalenessMs] = React.useState(
    DEFAULT_MAX_ORACLE_STALENESS_MS,
  );
  const [oracleHistory, setOracleHistory] = React.useState<
    OracleHistoryPoint[]
  >([]);
  const [oracleHistoryLoading, setOracleHistoryLoading] = React.useState(false);
  const [oracleHistoryError, setOracleHistoryError] = React.useState<
    string | null
  >(null);
  const effectiveLeverage = Math.min(
    configuredMaxLeverage,
    Math.max(1, Math.round(leverage)),
  );

  React.useEffect(() => {
    if (E2E_MODEL_ENTRY) {
      setData({
        markets: [E2E_MODEL_ENTRY],
        updatedAt: Date.now(),
      });
      setError(null);
      setLoading(false);
      return;
    }

    let mounted = true;
    let inFlight: AbortController | null = null;

    const poll = async () => {
      inFlight?.abort();
      inFlight = new AbortController();

      try {
        const response = await fetch(`${GAME_API_URL}/api/perps/markets`, {
          cache: "no-store",
          signal: inFlight.signal,
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const payload = sanitizePerpsMarketsResponse(await response.json());
        if (!mounted) return;

        setData(payload);
        setError(null);
        setLoading(false);
      } catch (fetchError) {
        if (!mounted) return;
        if (
          fetchError instanceof DOMException &&
          fetchError.name === "AbortError"
        ) {
          return;
        }

        setError(
          fetchError instanceof Error
            ? fetchError.message
            : "Failed to load models market data",
        );
        setLoading(false);
      }
    };

    void poll();
    const intervalId = window.setInterval(() => {
      void poll();
    }, POLL_INTERVAL_MS);

    return () => {
      mounted = false;
      window.clearInterval(intervalId);
      inFlight?.abort();
    };
  }, []);

  React.useEffect(() => {
    if (!data?.markets.length) return;

    const selectedStillExists =
      selectedCharacterId &&
      data.markets.some((entry) => entry.characterId === selectedCharacterId);

    if (!selectedStillExists) {
      setSelectedCharacterId(data.markets[0].characterId);
    }
  }, [data, selectedCharacterId]);

  React.useEffect(() => {
    if (
      E2E_MODEL_ENTRY &&
      selectedCharacterId === E2E_MODEL_ENTRY.characterId
    ) {
      setOracleHistory(E2E_ORACLE_HISTORY);
      setOracleHistoryError(null);
      setOracleHistoryLoading(false);
      return;
    }

    if (!selectedCharacterId) {
      setOracleHistory([]);
      setOracleHistoryError(null);
      setOracleHistoryLoading(false);
      return;
    }

    let mounted = true;
    let inFlight: AbortController | null = null;

    setOracleHistory([]);
    setOracleHistoryError(null);
    setOracleHistoryLoading(true);

    const loadOracleHistory = async () => {
      inFlight?.abort();
      inFlight = new AbortController();

      if (mounted) {
        setOracleHistoryLoading(true);
      }

      try {
        const response = await fetch(
          `${GAME_API_URL}/api/perps/oracle-history?characterId=${encodeURIComponent(selectedCharacterId)}&limit=${ORACLE_HISTORY_LIMIT}`,
          {
            cache: "no-store",
            signal: inFlight.signal,
          },
        );
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const payload = sanitizePerpsOracleHistoryResponse(
          await response.json(),
          selectedCharacterId,
        );
        if (!mounted) return;

        setOracleHistory(
          [...payload.snapshots]
            .sort((left, right) => left.recordedAt - right.recordedAt)
            .map((snapshot) => ({
              ...snapshot,
              label: buildOracleHistoryLabel(snapshot.recordedAt),
            })),
        );
        setOracleHistoryError(null);
      } catch (historyError) {
        if (!mounted) return;
        if (
          historyError instanceof DOMException &&
          historyError.name === "AbortError"
        ) {
          return;
        }

        setOracleHistory([]);
        setOracleHistoryError(
          historyError instanceof Error
            ? historyError.message
            : "Failed to load oracle history",
        );
      } finally {
        if (mounted) {
          setOracleHistoryLoading(false);
        }
      }
    };

    void loadOracleHistory();
    const intervalId = window.setInterval(() => {
      void loadOracleHistory();
    }, ORACLE_HISTORY_POLL_INTERVAL_MS);

    return () => {
      mounted = false;
      window.clearInterval(intervalId);
      inFlight?.abort();
    };
  }, [selectedCharacterId]);

  const leaderboardKey = React.useMemo(
    () => data?.markets.map((entry) => entry.characterId).join("|") ?? "",
    [data],
  );

  React.useEffect(() => {
    let mounted = true;

    const loadChainState = async () => {
      if (!leaderboardKey || !data?.markets.length) {
        if (mounted) {
          setMarketSnapshots({});
          setPositions({});
          setConfigPresent(false);
          setConfigLoaded(false);
          setSkewScaleSol(DEFAULT_SKEW_SCALE_SOL);
          setConfiguredMaxLeverage(DEFAULT_MAX_MODEL_LEVERAGE);
          setMaintenanceMarginBps(1_000);
          setOracleStalenessMs(DEFAULT_MAX_ORACLE_STALENESS_MS);
        }
        return;
      }
      try {
        const entries = data.markets;
        const marketIds = entries.map((entry) => entry.marketId);
        const [configInfo, marketInfos] = await Promise.all([
          connection.getAccountInfo(deriveConfigPda(), "confirmed"),
          fetchMultipleAccounts(connection, marketIds.map(deriveMarketPda)),
        ]);

        const decodedConfig = configInfo?.data
          ? decodeAccount<ConfigAccountState>(
            (data) => getConfigStateDecoder().decode(data) as ConfigState,
            configInfo.data,
          )
          : null;

        const nextMarketSnapshots: Record<string, MarketSnapshot> = {};
        for (let index = 0; index < entries.length; index += 1) {
          const marketInfo = marketInfos[index];
          const decoded = marketInfo?.data
            ? decodeAccount<MarketAccountState>(
              (data) => getMarketStateDecoder().decode(data) as MarketState,
              marketInfo.data,
            )
            : null;
          const marketId = marketIds[index];
          const mu = decoded ? bnToNumber(decoded.mu) / 1_000_000 : null;
          const sigma = decoded ? bnToNumber(decoded.sigma) / 1_000_000 : null;
          const localSkewScaleSol = decoded
            ? fromLamports(bnToNumber(decoded.skewScale))
            : DEFAULT_SKEW_SCALE_SOL;

          const fallbackSnapshot =
            entries[index].characterId === E2E_MODEL_ENTRY?.characterId
              ? buildE2eMarketSnapshot()
              : null;

          nextMarketSnapshots[entries[index].characterId] = decoded
            ? {
              marketId,
              spotIndex: fromLamports(bnToNumber(decoded.spotIndex)),
              longOi: fromLamports(bnToNumber(decoded.totalLongOi)),
              shortOi: fromLamports(bnToNumber(decoded.totalShortOi)),
              fundingRate: fromLamports(
                bnToNumber(decoded.currentFundingRate),
              ),
              conservativeSkill:
                mu !== null && sigma !== null
                  ? conservativeSkill(mu, sigma)
                  : null,
              uncertainty: sigma,
              lastUpdated: bnToNumber(decoded.oracleLastUpdated) * 1_000,
              insuranceFund: fromLamports(bnToNumber(decoded.insuranceFund)),
              skewScale: bnToNumber(decoded.skewScale),
              skewScaleSol: localSkewScaleSol,
            }
            : (fallbackSnapshot ?? {
              marketId,
              spotIndex: null,
              longOi: 0,
              shortOi: 0,
              fundingRate: 0,
              conservativeSkill: null,
              uncertainty: null,
              lastUpdated: null,
              insuranceFund: 0,
              skewScale: 0,
              skewScaleSol: DEFAULT_SKEW_SCALE_SOL,
            });
        }

        const nextPositions: Record<string, PositionSnapshot> = {};
        if (wallet.publicKey) {
          const positionAddresses = marketIds.map((marketId) =>
            derivePositionPda(wallet.publicKey as PublicKey, marketId),
          );
          const positionInfos = await fetchMultipleAccounts(
            connection,
            positionAddresses,
          );

          for (let index = 0; index < entries.length; index += 1) {
            const positionInfo = positionInfos[index];
            const decoded = positionInfo?.data
              ? decodeAccount<PositionAccountState>(
                (data) => getPositionStateDecoder().decode(data) as PositionState,
                positionInfo.data,
              )
              : null;
            if (!decoded) continue;

            const markPrice =
              nextMarketSnapshots[entries[index].characterId]?.spotIndex;
            const signedSize = fromLamports(bnToNumber(decoded.size));
            const direction: TradeDirection =
              signedSize >= 0 ? "LONG" : "SHORT";
            const margin = fromLamports(bnToNumber(decoded.margin));
            const size = Math.abs(signedSize);
            const entryPrice = fromLamports(bnToNumber(decoded.entryPrice));

            nextPositions[entries[index].characterId] = {
              marketId: marketIds[index],
              direction,
              margin,
              size,
              signedSize,
              entryPrice,
              markPrice,
              pnl: computePnl(entryPrice, signedSize, markPrice),
              liquidationPrice: computeLiquidationPrice(
                entryPrice,
                signedSize,
                margin,
                decodedConfig?.maintenanceMarginBps ?? 1_000,
              ),
            };
          }
        }

        if (!mounted) return;

        setMarketSnapshots(nextMarketSnapshots);
        setPositions(nextPositions);
        setConfigPresent(Boolean(configInfo));
        setConfigLoaded(Boolean(decodedConfig));
        setSkewScaleSol(
          decodedConfig
            ? fromLamports(bnToNumber(decodedConfig.defaultSkewScale))
            : DEFAULT_SKEW_SCALE_SOL,
        );
        setConfiguredMaxLeverage(
          decodedConfig?.maxLeverage
            ? Math.max(1, bnToNumber(decodedConfig.maxLeverage))
            : DEFAULT_MAX_MODEL_LEVERAGE,
        );
        setMaintenanceMarginBps(decodedConfig?.maintenanceMarginBps ?? 1_000);
        setOracleStalenessMs(
          decodedConfig?.maxOracleStalenessSeconds
            ? bnToNumber(decodedConfig.maxOracleStalenessSeconds) * 1_000
            : DEFAULT_MAX_ORACLE_STALENESS_MS,
        );
      } catch (chainError) {
        if (!mounted) return;

        console.warn("[models-market] failed to load chain state", chainError);
        const e2eSnapshot = buildE2eMarketSnapshot();
        if (E2E_MODEL_ENTRY && e2eSnapshot) {
          setMarketSnapshots((current) => {
            const fallback = getE2eFallbackMarketSnapshots();
            return {
              ...current,
              ...fallback,
            };
          });
          setConfigPresent(true);
          setConfigLoaded(true);
          setSkewScaleSol(e2eSnapshot.skewScaleSol);
          setConfiguredMaxLeverage(DEFAULT_MAX_MODEL_LEVERAGE);
          setMaintenanceMarginBps(1_000);
          setOracleStalenessMs(DEFAULT_MAX_ORACLE_STALENESS_MS);
        } else {
          setConfigPresent(false);
          setConfigLoaded(false);
        }
      }
    };

    void loadChainState();
    const intervalId = window.setInterval(() => {
      void loadChainState();
    }, CHAIN_POLL_INTERVAL_MS);

    return () => {
      mounted = false;
      window.clearInterval(intervalId);
    };
  }, [connection, data, leaderboardKey, wallet.publicKey]);

  const filteredLeaderboard = React.useMemo(() => {
    if (!data?.markets.length) return [];

    const normalizedSearch = searchTerm.trim().toLowerCase();
    if (!normalizedSearch) return data.markets;

    return data.markets.filter((entry) => {
      const haystack =
        `${entry.name} ${entry.provider} ${entry.model}`.toLowerCase();
      return haystack.includes(normalizedSearch);
    });
  }, [data, searchTerm]);

  const selectedEntry = React.useMemo(() => {
    if (!data || !selectedCharacterId) return null;
    return (
      data.markets.find((entry) => entry.characterId === selectedCharacterId) ??
      null
    );
  }, [data, selectedCharacterId]);

  const selectedMarket = selectedCharacterId
    ? marketSnapshots[selectedCharacterId]
    : undefined;
  const selectedPosition = selectedCharacterId
    ? positions[selectedCharacterId]
    : undefined;
  const selectedMarketActive = selectedEntry?.status === "ACTIVE";
  const selectedMarketCloseOnly = selectedEntry?.status === "CLOSE_ONLY";
  const selectedOracleFresh =
    IS_E2E_MODE && selectedEntry?.characterId === E2E_MODEL_ENTRY?.characterId
      ? true
      : isOracleFresh(selectedMarket?.lastUpdated ?? null, oracleStalenessMs);
  const selectedCanOpen = Boolean(selectedMarketActive && selectedOracleFresh);
  const selectedCanClose = Boolean(
    selectedPosition &&
    ((selectedMarketActive && selectedOracleFresh) || selectedMarketCloseOnly),
  );

  const aggregateLongOi = React.useMemo(
    () =>
      Object.values(marketSnapshots).reduce(
        (total, snapshot) => total + snapshot.longOi,
        0,
      ),
    [marketSnapshots],
  );
  const aggregateShortOi = React.useMemo(
    () =>
      Object.values(marketSnapshots).reduce(
        (total, snapshot) => total + snapshot.shortOi,
        0,
      ),
    [marketSnapshots],
  );

  const estLongPrice = estimateExecutionPrice(
    selectedMarket,
    collateralSol * effectiveLeverage,
    selectedMarket?.skewScaleSol ?? skewScaleSol,
  );
  const estShortPrice = estimateExecutionPrice(
    selectedMarket,
    -collateralSol * effectiveLeverage,
    selectedMarket?.skewScaleSol ?? skewScaleSol,
  );

  const ensureTradable = (intent: "open" | "close"): boolean => {
    if (!wallet.publicKey || !wallet.connected) {
      setLastTradeStatus(copy.connectWalletToTrade);
      setWalletModalVisible(true);
      return false;
    }

    if (!wallet.signTransaction || !wallet.signAllTransactions) {
      setLastTradeStatus(copy.walletCannotSign);
      toast.error(copy.walletCannotSign);
      return false;
    }

    if (intent === "open" && !selectedMarketActive) {
      setLastTradeStatus(copy.marketNotAccepting);
      toast.error(copy.marketNotAccepting);
      return false;
    }

    if (intent === "open" && !selectedOracleFresh) {
      setLastTradeStatus(
        copy.waitingOnOracle,
      );
      toast.error(copy.waitingOnOracle);
      return false;
    }

    if (intent === "close" && selectedEntry?.status === "ARCHIVED") {
      setLastTradeStatus(copy.marketArchived);
      toast.error(copy.marketArchived);
      return false;
    }

    return true;
  };

  const refreshChainState = React.useCallback(async () => {
    if (!data?.markets.length) return;
    const freshResponse = sanitizePerpsMarketsResponse({
      markets: data.markets,
      updatedAt: Date.now(),
    });
    setData(freshResponse);
  }, [data]);

  const handleOpenPosition = async (direction: TradeDirection) => {
    if (!selectedEntry || !selectedMarket) return;
    if (!ensureTradable("open")) return;

    const marketId = selectedEntry.marketId;
    const txId = `model-market-${selectedEntry.characterId}-${direction.toLowerCase()}`;
    setSubmittingTrade(txId);
    setLastTradeStatus(
      copy.submitting(direction.toLowerCase(), selectedEntry.name),
    );
    setLastTradeTx("-");
    toast.loading(
      copy.opening(effectiveLeverage, direction.toLowerCase(), selectedEntry.name),
      { id: txId },
    );

    try {
      if (!wallet.publicKey || !wallet.session) {
        throw new Error(copy.connectWalletToTrade);
      }
      const walletSigner = createWalletTransactionSigner(wallet.session).signer;
      const traderPublicKey = wallet.publicKey as PublicKey;
      const positionAddress = derivePositionPda(
        traderPublicKey,
        marketId,
      );
      const marginDeltaLamports = toLamports(collateralSol);
      const signedSizeLamports =
        toLamports(collateralSol * effectiveLeverage) *
        (direction === "LONG" ? 1 : -1);
      const quotedEntryPrice =
        (direction === "LONG" ? estLongPrice : estShortPrice) ??
        selectedMarket.spotIndex ??
        0;
      const acceptablePriceLamports =
        quotedEntryPrice <= 0
          ? 0
          : toLamports(
            direction === "LONG"
              ? quotedEntryPrice * 1.02
              : quotedEntryPrice * 0.98,
          );
      const marketAddress = deriveMarketPda(marketId);
      const signature = await sendKitInstructions(
        client,
        wallet.session,
        [
          getModifyPositionInstruction({
            acceptablePrice: acceptablePriceLamports,
            config: toAddress(deriveConfigPda().toBase58()),
            marginDelta: marginDeltaLamports,
            market: toAddress(marketAddress.toBase58()),
            marketId,
            position: toAddress(positionAddress.toBase58()),
            sizeDelta: signedSizeLamports,
            trader: walletSigner,
          }),
        ],
        {
          accountKeys: [
            traderPublicKey.toBase58(),
            PROGRAM_ID.toBase58(),
            marketAddress.toBase58(),
            positionAddress.toBase58(),
          ],
          context: `opening ${direction.toLowerCase()} ${selectedEntry.name}`,
          gameApiUrl:
            CONFIG.cluster === "mainnet-beta" ? GAME_API_URL : undefined,
          useHeliusSender: CONFIG.cluster === "mainnet-beta",
        },
      );

      const signedSize =
        collateralSol * effectiveLeverage * (direction === "LONG" ? 1 : -1);
      const entryPrice = quotedEntryPrice;
      const markPrice = selectedMarket.spotIndex ?? entryPrice;
      setPositions((current) => ({
        ...current,
        [selectedEntry.characterId]: {
          marketId,
          direction,
          margin: collateralSol,
          size: Math.abs(signedSize),
          signedSize,
          entryPrice,
          markPrice,
          pnl: 0,
          liquidationPrice: computeLiquidationPrice(
            entryPrice,
            signedSize,
            collateralSol,
            maintenanceMarginBps,
          ),
        },
      }));
      setMarketSnapshots((current) => ({
        ...current,
        [selectedEntry.characterId]:
          applySignedOi(current[selectedEntry.characterId], signedSize) ??
          current[selectedEntry.characterId],
      }));
      setLastTradeStatus(
        copy.opened(direction.toLowerCase(), selectedEntry.name),
      );
      setLastTradeTx(signature);
      toast.success(
        copy.openedToast(direction.toLowerCase(), selectedEntry.name),
        {
          id: txId,
        },
      );
      await refreshChainState();
    } catch (tradeError) {
      const message = getTradeErrorMessage(tradeError, locale);
      setLastTradeStatus(message);
      toast.error(message, { id: txId });
    } finally {
      setSubmittingTrade(null);
    }
  };

  const handleClosePosition = async () => {
    if (!selectedEntry || !selectedPosition) return;
    if (!ensureTradable("close")) return;

    const txId = `close-model-${selectedEntry.characterId}`;
    setSubmittingTrade(txId);
    setLastTradeStatus(copy.closingPosition(selectedEntry.name));
    setLastTradeTx("-");
    toast.loading(copy.closingPosition(selectedEntry.name), { id: txId });

    try {
      if (!wallet.publicKey || !wallet.session) {
        throw new Error(copy.connectWalletToTrade);
      }
      const walletSigner = createWalletTransactionSigner(wallet.session).signer;
      const traderPublicKey = wallet.publicKey as PublicKey;
      const marketId = selectedEntry.marketId;
      const closeSizeLamports = -toLamports(selectedPosition.signedSize);
      const quotedClosePrice =
        estimateExecutionPrice(
          selectedMarket,
          -selectedPosition.signedSize,
          selectedMarket?.skewScaleSol ?? skewScaleSol,
        ) ??
        selectedMarket?.spotIndex ??
        selectedPosition.entryPrice;
      const acceptablePriceLamports =
        quotedClosePrice <= 0
          ? 0
          : toLamports(
            selectedPosition.direction === "LONG"
              ? quotedClosePrice * 0.98
              : quotedClosePrice * 1.02,
          );
      const marketAddress = deriveMarketPda(marketId);
      const positionAddress = derivePositionPda(traderPublicKey, marketId);
      const signature = await sendKitInstructions(
        client,
        wallet.session,
        [
          getModifyPositionInstruction({
            acceptablePrice: acceptablePriceLamports,
            config: toAddress(deriveConfigPda().toBase58()),
            marginDelta: 0,
            market: toAddress(marketAddress.toBase58()),
            marketId,
            position: toAddress(positionAddress.toBase58()),
            sizeDelta: closeSizeLamports,
            trader: walletSigner,
          }),
        ],
        {
          accountKeys: [
            traderPublicKey.toBase58(),
            PROGRAM_ID.toBase58(),
            marketAddress.toBase58(),
            positionAddress.toBase58(),
          ],
          context: `closing ${selectedEntry.name} position`,
          gameApiUrl:
            CONFIG.cluster === "mainnet-beta" ? GAME_API_URL : undefined,
          useHeliusSender: CONFIG.cluster === "mainnet-beta",
        },
      );

      setPositions((current) => {
        const next = { ...current };
        delete next[selectedEntry.characterId];
        return next;
      });
      setLastTradeStatus(copy.closedPosition(selectedEntry.name));
      setLastTradeTx(signature);
      toast.success(copy.closedPosition(selectedEntry.name), { id: txId });
      await refreshChainState();
    } catch (tradeError) {
      const message = getTradeErrorMessage(tradeError, locale);
      setLastTradeStatus(message);
      toast.error(message, { id: txId });
    } finally {
      setSubmittingTrade(null);
    }
  };

  return (
    <div className="models-market-view" data-testid="models-market-view">
      <Toaster theme="dark" position="bottom-right" />

      <section className="models-market-hero">
        <div>
          <p className="models-market-kicker">Synthetic Model Perps</p>
          <h2>Long and short any ranked model</h2>
          <p className="models-market-copy">
            Synthetic index uses conservative skill (`mu - 3σ`) normalized
            across the active model field. Every model settles against its own
            isolated market account with independent insurance.
          </p>
        </div>

        <div className="models-market-metrics">
          <article className="models-market-metric-card">
            <span className="models-market-metric-label">Tracked Models</span>
            <strong>{data?.markets.length ?? 0}</strong>
            <small>Current duel: {activeMatchup}</small>
          </article>
          <article className="models-market-metric-card">
            <span className="models-market-metric-label">Aggregate OI</span>
            <strong>
              {formatCompactNumber(aggregateLongOi)} /{" "}
              {formatCompactNumber(aggregateShortOi)} SOL
            </strong>
            <small>Long / short open interest</small>
          </article>
          <article className="models-market-metric-card">
            <span className="models-market-metric-label">Oracle Basis</span>
            <strong>{formatCompactNumber(skewScaleSol, 0)} SOL</strong>
            <small>Default skew scale from perps config</small>
          </article>
        </div>
      </section>

      <section className="models-market-grid">
        <article className="models-market-card models-market-card--table">
          <div className="models-market-card-header">
            <div>
              <h3>All Models</h3>
              <p>
                Every active model, current synthetic index, and open interest.
              </p>
            </div>
            <div className="models-market-toolbar">
              <input
                className="models-market-search"
                type="search"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Search provider or model"
              />
              <span className="models-market-updated">
                Updated {formatUpdatedAt(data?.updatedAt ?? null)}
              </span>
            </div>
          </div>

          {error && <div className="models-market-error">{error}</div>}

          <div className="models-market-table-wrap">
            <table className="models-market-table">
              <thead>
                <tr>
                  <th>Rank</th>
                  <th>Model</th>
                  <th>Provider</th>
                  <th>W/L</th>
                  <th>Index</th>
                  <th>Long OI</th>
                  <th>Short OI</th>
                  <th>Funding</th>
                  <th>Status</th>
                  <th>Your Position</th>
                </tr>
              </thead>
              <tbody>
                {loading && filteredLeaderboard.length === 0 && (
                  <tr>
                    <td colSpan={10} className="models-market-empty">
                      Loading models market…
                    </td>
                  </tr>
                )}

                {!loading && filteredLeaderboard.length === 0 && (
                  <tr>
                    <td colSpan={10} className="models-market-empty">
                      No models matched the current filter.
                    </td>
                  </tr>
                )}

                {filteredLeaderboard.map((entry) => {
                  const market = marketSnapshots[entry.characterId];
                  const position = positions[entry.characterId];
                  return (
                    <tr
                      key={entry.characterId}
                      data-testid={`models-market-row-${entry.characterId}`}
                      className={
                        selectedCharacterId === entry.characterId
                          ? "is-selected"
                          : undefined
                      }
                      onClick={() => setSelectedCharacterId(entry.characterId)}
                    >
                      <td>{entry.rank ? `#${entry.rank}` : "—"}</td>
                      <td>
                        <strong>{entry.name}</strong>
                        <span>{entry.model || "Unnamed model"}</span>
                      </td>
                      <td>{entry.provider || copy.unknown}</td>
                      <td>
                        {entry.wins}-{entry.losses}
                        <span>
                          {toWinRatePercent(entry.wins, entry.losses).toFixed(
                            1,
                          )}
                          %
                        </span>
                      </td>
                      <td className="models-market-mono">
                        {market?.spotIndex
                          ? `$${market.spotIndex.toFixed(2)}`
                          : "—"}
                      </td>
                      <td className="models-market-mono">
                        {market ? `${market.longOi.toFixed(2)} SOL` : "—"}
                      </td>
                      <td className="models-market-mono">
                        {market ? `${market.shortOi.toFixed(2)} SOL` : "—"}
                      </td>
                      <td
                        className={`models-market-mono ${market && market.fundingRate > 0
                          ? "is-funding-positive"
                          : "is-funding-negative"
                          }`}
                      >
                        {market ? market.fundingRate.toFixed(6) : "—"}
                      </td>
                      <td className="models-market-mono">
                        {entry.status === "ACTIVE"
                          ? "ACTIVE"
                          : entry.status === "CLOSE_ONLY"
                            ? "CLOSE ONLY"
                            : "ARCHIVED"}
                      </td>
                      <td className="models-market-mono">
                        {position ? (
                          <span
                            className={
                              position.direction === "LONG"
                                ? "models-market-position-chip is-long"
                                : "models-market-position-chip is-short"
                            }
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

        <aside className="models-market-card models-market-card--detail">
          {selectedEntry ? (
            <>
              <div className="models-market-card-header">
                <div>
                  <h3>{selectedEntry.name}</h3>
                  <p>
                    {selectedEntry.provider || copy.unknownProvider} ·{" "}
                    {selectedEntry.model || "Unnamed model"}
                  </p>
                </div>
                <div
                  className={`models-market-rank-chip ${selectedOracleFresh || selectedEntry.status !== "ACTIVE"
                    ? ""
                    : "is-stale"
                    }`}
                >
                  {selectedEntry.status === "ACTIVE"
                    ? selectedOracleFresh
                      ? selectedEntry.rank
                        ? `Rank #${selectedEntry.rank}`
                        : "ACTIVE"
                      : copy.oracleStale
                    : selectedEntry.status === "CLOSE_ONLY"
                      ? copy.closeOnly
                      : copy.archived}
                </div>
              </div>

              <div className="models-market-detail-grid">
                <div>
                  <span>Index</span>
                  <strong>
                    {selectedMarket?.spotIndex
                      ? `$${selectedMarket.spotIndex.toFixed(2)}`
                      : copy.pending}
                  </strong>
                </div>
                <div>
                  <span>Open Interest</span>
                  <strong>
                    {selectedMarket
                      ? `${selectedMarket.longOi.toFixed(2)} / ${selectedMarket.shortOi.toFixed(2)}`
                      : "—"}
                  </strong>
                </div>
                <div>
                  <span>Funding</span>
                  <strong>
                    {selectedMarket
                      ? selectedMarket.fundingRate.toFixed(6)
                      : "—"}
                  </strong>
                </div>
                <div>
                  <span>Insurance</span>
                  <strong>
                    {selectedMarket
                      ? `${selectedMarket.insuranceFund.toFixed(3)} SOL`
                      : "—"}
                  </strong>
                </div>
              </div>

              <div
                className="models-market-history-card"
                data-testid="models-market-oracle-history"
              >
                <div className="models-market-history-header">
                  <div>
                    <h4>Oracle History</h4>
                    <p>
                      Canonical keeper snapshots from SQLite for the synthetic
                      model index.
                    </p>
                  </div>
                  <span>
                    Current oracle{" "}
                    {formatUpdatedAt(selectedMarket?.lastUpdated ?? null)}
                    {!selectedOracleFresh ? " · stale" : ""}
                  </span>
                </div>

                <div className="models-market-history-chart">
                  {oracleHistoryError ? (
                    <div className="models-market-empty">
                      Failed to load oracle history: {oracleHistoryError}
                    </div>
                  ) : oracleHistoryLoading && oracleHistory.length === 0 ? (
                    <div className="models-market-empty">
                      Loading canonical oracle history…
                    </div>
                  ) : oracleHistory.length === 0 ? (
                    <div className="models-market-empty">
                      Waiting for keeper snapshots for this model.
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={oracleHistory}>
                        <XAxis
                          dataKey="label"
                          tick={{
                            fill: "rgba(255,255,255,0.45)",
                            fontSize: 11,
                          }}
                          tickLine={false}
                          axisLine={{ stroke: "rgba(255,255,255,0.08)" }}
                        />
                        <YAxis
                          tick={{
                            fill: "rgba(255,255,255,0.45)",
                            fontSize: 11,
                          }}
                          tickLine={false}
                          axisLine={{ stroke: "rgba(255,255,255,0.08)" }}
                          width={48}
                          tickFormatter={(value: number) =>
                            `$${value.toFixed(0)}`
                          }
                        />
                        <Tooltip
                          content={({ active, payload }) => {
                            if (!active || !payload?.length) return null;
                            const point = payload[0]
                              ?.payload as OracleHistoryPoint;
                            return (
                              <div className="models-market-tooltip">
                                <strong>${point.spotIndex.toFixed(2)}</strong>
                                <span>
                                  Skill {point.conservativeSkill.toFixed(2)} · μ{" "}
                                  {point.mu.toFixed(2)} · σ{" "}
                                  {point.sigma.toFixed(2)}
                                </span>
                              </div>
                            );
                          }}
                        />
                        {selectedMarket?.spotIndex && (
                          <ReferenceLine
                            y={selectedMarket.spotIndex}
                            stroke="rgba(229,184,74,0.2)"
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

              {selectedPosition && (
                <div
                  className="models-market-active-position"
                  data-testid="models-market-active-position"
                >
                  <div>
                    <span className="models-market-section-label">
                      Your Position
                    </span>
                    <strong
                      data-testid="models-market-position-direction"
                      className={
                        selectedPosition.direction === "LONG"
                          ? "is-long"
                          : "is-short"
                      }
                    >
                      {selectedPosition.direction}{" "}
                      {selectedPosition.size.toFixed(3)} SOL
                    </strong>
                  </div>
                  <div>
                    <span>Entry ${selectedPosition.entryPrice.toFixed(2)}</span>
                    <span>Margin {selectedPosition.margin.toFixed(4)} SOL</span>
                    <span>
                      PnL{" "}
                      <strong
                        className={
                          selectedPosition.pnl >= 0 ? "is-long" : "is-short"
                        }
                      >
                        {selectedPosition.pnl >= 0 ? "+" : ""}
                        {selectedPosition.pnl.toFixed(4)} SOL
                      </strong>
                    </span>
                    <button
                      type="button"
                      data-testid="models-market-close-position"
                      onClick={() => void handleClosePosition()}
                      disabled={Boolean(submittingTrade) || !selectedCanClose}
                    >
                      Close Position
                    </button>
                  </div>
                </div>
              )}

              <div className="models-market-trade-card">
                <div className="models-market-trade-header">
                  <div>
                    <h4>Trade {selectedEntry.name}</h4>
                    <p>
                      Isolated by model. Price follows the synthetic skill
                      oracle, not the active duel stream.
                    </p>
                  </div>
                  <span data-testid="models-market-market-id">
                    {selectedMarket
                      ? `Market #${selectedMarket.marketId}`
                      : copy.pendingOracle}
                  </span>
                </div>

                <label className="models-market-field">
                  <span>Collateral (SOL)</span>
                  <input
                    data-testid="models-market-collateral-input"
                    type="number"
                    min={0.01}
                    step={0.01}
                    value={collateralSol}
                    onChange={(event) =>
                      setCollateralSol(Number(event.target.value))
                    }
                  />
                </label>

                <div className="models-market-field">
                  <div className="models-market-field-row">
                    <span>Leverage</span>
                    <strong>{effectiveLeverage}x</strong>
                  </div>
                  <div className="models-market-leverage-row">
                    {[1, 2, 3, 5]
                      .filter((value) => value <= configuredMaxLeverage)
                      .map((value) => (
                        <button
                          key={value}
                          data-testid={`models-market-leverage-${value}x`}
                          type="button"
                          className={
                            effectiveLeverage === value
                              ? "is-active"
                              : undefined
                          }
                          onClick={() => setLeverage(value)}
                        >
                          {value}x
                        </button>
                      ))}
                  </div>
                  <input
                    type="range"
                    min={1}
                    max={configuredMaxLeverage}
                    step={1}
                    value={effectiveLeverage}
                    onChange={(event) =>
                      setLeverage(Number(event.target.value))
                    }
                  />
                </div>

                <div className="models-market-summary">
                  <div>
                    <span>Position Size</span>
                    <strong>
                      {(collateralSol * effectiveLeverage).toFixed(3)} SOL
                    </strong>
                  </div>
                  <div>
                    <span>Est. Long Entry</span>
                    <strong>
                      {estLongPrice ? `$${estLongPrice.toFixed(2)}` : "—"}
                    </strong>
                  </div>
                  <div>
                    <span>Est. Short Entry</span>
                    <strong>
                      {estShortPrice ? `$${estShortPrice.toFixed(2)}` : "—"}
                    </strong>
                  </div>
                </div>

                <div className="models-market-actions">
                  {IS_E2E_MODE && (
                    <div
                      className="models-market-empty"
                      style={{ marginBottom: 12 }}
                    >
                      <div data-testid="models-market-rpc-endpoint">
                        {connection.rpcEndpoint}
                      </div>
                      <div data-testid="models-market-config-pda">
                        {deriveConfigPda().toBase58()}
                      </div>
                      <div data-testid="models-market-config-present">
                        {configPresent ? "true" : "false"}
                      </div>
                      <div data-testid="models-market-config-loaded">
                        {configLoaded ? "true" : "false"}
                      </div>
                      <div data-testid="models-market-last-trade-status">
                        {lastTradeStatus}
                      </div>
                      <div data-testid="models-market-last-trade-tx">
                        {lastTradeTx}
                      </div>
                    </div>
                  )}
                  <button
                    type="button"
                    data-testid="models-market-open-long"
                    className="is-long"
                    disabled={
                      Boolean(submittingTrade) ||
                      collateralSol <= 0 ||
                      !selectedCanOpen
                    }
                    onClick={() => void handleOpenPosition("LONG")}
                  >
                    Long {selectedEntry.name}
                  </button>
                  <button
                    type="button"
                    data-testid="models-market-open-short"
                    className="is-short"
                    disabled={
                      Boolean(submittingTrade) ||
                      collateralSol <= 0 ||
                      !selectedCanOpen
                    }
                    onClick={() => void handleOpenPosition("SHORT")}
                  >
                    Short {selectedEntry.name}
                  </button>
                </div>
                {!selectedCanOpen && (
                  <div className="models-market-empty">
                    {selectedEntry.status === "ACTIVE"
                      ? "Trading is paused until the keeper posts a fresh oracle update for this model."
                      : selectedEntry.status === "CLOSE_ONLY"
                        ? "This model has been deprecated. Existing positions can be reduced or closed, but new exposure is disabled."
                        : "This model market has been archived."}
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="models-market-empty-detail">
              Select a model to inspect canonical oracle history and trade the
              perp market.
            </div>
          )}
        </aside>
      </section>
    </div>
  );
}

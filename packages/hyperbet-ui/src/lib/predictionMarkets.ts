import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  BettingChainKey,
  PredictionMarketLifecycleRecord,
  PredictionMarketWinner,
} from "@hyperbet/chain-registry";
import {
  normalizePredictionMarketDuelKeyHex as normalizePredictionMarketDuelKeyHexFromRegistry,
  normalizePredictionMarketLifecycleRecord,
  normalizePredictionMarketTimestamp,
  normalizePredictionMarketWinner,
} from "@hyperbet/chain-registry";

import { GAME_API_URL } from "./config";

const ACTIVE_PREDICTION_MARKETS_URL = `${GAME_API_URL.replace(/\/$/, "")}/api/arena/prediction-markets/active`;
const DEFAULT_POLL_INTERVAL_MS = 5_000;

export type PredictionMarketsDuelSnapshot = {
  duelKey: string | null;
  duelId: string | null;
  phase: string | null;
  winner: PredictionMarketWinner;
  betCloseTime: number | null;
};

export type PredictionMarketsResponse = {
  duel: PredictionMarketsDuelSnapshot;
  markets: PredictionMarketLifecycleRecord[];
  updatedAt: number | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

export const normalizePredictionMarketDuelKeyHex =
  normalizePredictionMarketDuelKeyHexFromRegistry;

export function parsePredictionMarketsResponse(
  payload: unknown,
): PredictionMarketsResponse | null {
  const candidate = asRecord(payload);
  const duel = asRecord(candidate?.duel);
  if (!candidate || !duel || !Array.isArray(candidate.markets)) {
    return null;
  }

  return {
    duel: {
      duelKey: normalizePredictionMarketDuelKeyHex(
        typeof duel.duelKey === "string" ? duel.duelKey : null,
      ),
      duelId: typeof duel.duelId === "string" ? duel.duelId : null,
      phase: typeof duel.phase === "string" ? duel.phase : null,
      winner: normalizePredictionMarketWinner(duel.winner),
      betCloseTime: normalizePredictionMarketTimestamp(duel.betCloseTime),
    },
    markets: candidate.markets
      .map((market) => normalizePredictionMarketLifecycleRecord(market))
      .filter((market): market is PredictionMarketLifecycleRecord => market !== null),
    updatedAt: normalizePredictionMarketTimestamp(candidate.updatedAt),
  };
}

export async function fetchActivePredictionMarkets(
  signal?: AbortSignal,
): Promise<PredictionMarketsResponse> {
  const response = await fetch(ACTIVE_PREDICTION_MARKETS_URL, {
    cache: "no-store",
    signal,
  });
  if (!response.ok) {
    throw new Error(`prediction markets request failed (${response.status})`);
  }

  const parsed = parsePredictionMarketsResponse(await response.json());
  if (!parsed) {
    throw new Error("prediction markets response was invalid");
  }

  return parsed;
}

export function selectPredictionMarketLifecycleRecord(
  payload: PredictionMarketsResponse | null,
  chainKey: BettingChainKey | null,
): PredictionMarketLifecycleRecord | null {
  if (!payload || !chainKey) return null;
  return payload.markets.find((market) => market.chainKey === chainKey) ?? null;
}

export function usePredictionMarketLifecycle(
  chainKey: BettingChainKey | null,
  options: {
    disabled?: boolean;
    pollIntervalMs?: number;
  } = {},
) {
  const { disabled = false, pollIntervalMs = DEFAULT_POLL_INTERVAL_MS } = options;
  const [data, setData] = useState<PredictionMarketsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      if (disabled || !chainKey) return null;
      setIsLoading(true);
      try {
        const nextData = await fetchActivePredictionMarkets(signal);
        setData(nextData);
        setError(null);
        return nextData;
      } catch (refreshError) {
        if (!signal?.aborted) {
          setError(
            refreshError instanceof Error
              ? refreshError.message
              : "prediction markets refresh failed",
          );
        }
        return null;
      } finally {
        if (!signal?.aborted) {
          setIsLoading(false);
        }
      }
    },
    [chainKey, disabled],
  );

  useEffect(() => {
    if (disabled || !chainKey) {
      setData(null);
      setError(null);
      setIsLoading(false);
      return;
    }

    const controller = new AbortController();
    void refresh(controller.signal);
    const intervalId = window.setInterval(() => {
      const pollController = new AbortController();
      void refresh(pollController.signal);
    }, pollIntervalMs);

    return () => {
      controller.abort();
      window.clearInterval(intervalId);
    };
  }, [chainKey, disabled, pollIntervalMs, refresh]);

  const market = useMemo(
    () => selectPredictionMarketLifecycleRecord(data, chainKey),
    [chainKey, data],
  );

  return {
    data,
    duel: data?.duel ?? null,
    market,
    isLoading,
    error,
    refresh,
  };
}

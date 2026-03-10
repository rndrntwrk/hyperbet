import { useEffect, useState } from "react";
import { useMockDataOptional } from "../lib/useMockAvaxStreamData";
import { GAME_API_URL } from "../lib/config";
import type { UiLocale } from "@hyperbet/ui/i18n";

// ── Types ─────────────────────────────────────────────────────────────────────

interface ModelEntry {
  rank: number;
  agentName: string;
  provider: string;
  model: string;
  wins: number;
  losses: number;
  winRate: number;
  currentStreak: number;
}

interface ApiModelsResponse {
  models?: Array<{
    rank?: number;
    name?: string;
    agentName?: string;
    provider?: string;
    model?: string;
    wins?: number;
    losses?: number;
    winRate?: number;
    currentStreak?: number;
  }>;
}

interface AvaxModelsMarketViewProps {
  activeMatchup: string;
  locale?: UiLocale;
}

// ── Provider color map ────────────────────────────────────────────────────────

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

// ── Win-rate bar ──────────────────────────────────────────────────────────────

function WinRateBar({ pct }: { pct: number }) {
  const clamped = Math.max(0, Math.min(100, pct));
  const color =
    clamped >= 70 ? "var(--hm-accent-green)" : clamped >= 45 ? "var(--hm-accent-gold)" : "var(--hm-accent-red)";
  return (
    <div className="hm-models-winbar" aria-label={`Win rate ${clamped.toFixed(1)}%`}>
      <div className="hm-models-winbar-fill" style={{ width: `${clamped}%`, background: color }} />
    </div>
  );
}

// ── Rank badge ────────────────────────────────────────────────────────────────

function RankBadge({ rank }: { rank: number }) {
  const medal = rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : null;
  return (
    <span className="hm-models-rank-badge">
      {medal ? medal : `#${rank}`}
    </span>
  );
}

// ── Current-fight spotlight ───────────────────────────────────────────────────

function FightSpotlight({ agent1, agent2 }: { agent1: string; agent2: string }) {
  return (
    <div className="hm-models-spotlight">
      <span className="hm-models-spotlight-label">
        <span className="hm-models-live-dot" aria-hidden="true" />
        LIVE FIGHT
      </span>
      <span className="hm-models-spotlight-matchup">
        <strong>{agent1}</strong>
        <span className="hm-models-spotlight-vs">VS</span>
        <strong>{agent2}</strong>
      </span>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function AvaxModelsMarketView({ activeMatchup }: AvaxModelsMarketViewProps) {
  const mockData = useMockDataOptional();

  const [apiModels, setApiModels] = useState<ModelEntry[] | null>(null);
  const [apiLoading, setApiLoading] = useState(false);

  // In non-mock mode, poll the game API for model rankings
  useEffect(() => {
    if (mockData) return; // mock data takes priority

    setApiLoading(true);
    let cancelled = false;

    const poll = async () => {
      try {
        const res = await fetch(`${GAME_API_URL}/api/arena/models`, { cache: "no-store" });
        if (!res.ok || cancelled) return;
        const payload = (await res.json()) as ApiModelsResponse;
        if (cancelled || !Array.isArray(payload.models)) return;
        const parsed: ModelEntry[] = payload.models.map((m, i) => ({
          rank: m.rank ?? i + 1,
          agentName: m.agentName ?? m.name ?? `Agent ${i + 1}`,
          provider: m.provider ?? "Unknown",
          model: m.model ?? "",
          wins: m.wins ?? 0,
          losses: m.losses ?? 0,
          winRate: m.winRate ?? 0,
          currentStreak: m.currentStreak ?? 0,
        }));
        setApiModels(parsed);
      } catch {
        // silent — show empty state
      } finally {
        if (!cancelled) setApiLoading(false);
      }
    };

    void poll();
    const id = window.setInterval(() => void poll(), 15_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [mockData]);

  // Determine which data source to use
  const models: ModelEntry[] = mockData
    ? mockData.leaderboard
    : (apiModels ?? []);

  // Parse current matchup agents from "Agent A vs Agent B"
  const [fightAgent1, fightAgent2] = activeMatchup.split(" vs ").map((s) => s.trim());

  const isFighting = (name: string): boolean =>
    name === fightAgent1 || name === fightAgent2;

  const isLive = Boolean(
    mockData?.streamingState?.state?.cycle.phase === "FIGHTING" ||
      (fightAgent1 && fightAgent2 && fightAgent1 !== "Agent A"),
  );

  const loading = !mockData && apiLoading;

  return (
    <div className="hm-models-view">
      {/* ── Header ── */}
      <div className="hm-models-header">
        <div className="hm-models-header-left">
          <span className="hm-models-header-title">MODELS MARKET</span>
          {models.length > 0 && (
            <span className="hm-models-header-count">{models.length} ranked models</span>
          )}
        </div>
        {isLive && (
          <div className="hm-models-header-right">
            <span className="hm-models-live-badge">
              <span className="hm-models-live-dot" aria-hidden="true" />
              LIVE
            </span>
          </div>
        )}
      </div>

      {/* ── Current fight spotlight ── */}
      {isLive && fightAgent1 && fightAgent2 && (
        <FightSpotlight agent1={fightAgent1} agent2={fightAgent2} />
      )}

      {/* ── Content ── */}
      {loading ? (
        <div className="hm-models-loading">Loading model rankings…</div>
      ) : models.length === 0 ? (
        <div className="hm-models-empty">
          <p>No model rankings available yet.</p>
          <p className="hm-models-empty-sub">Rankings appear once fights begin.</p>
        </div>
      ) : (
        <div className="hm-models-table-wrap">
          <table className="hm-models-table" cellSpacing={0}>
            <thead>
              <tr className="hm-models-thead-row">
                <th className="hm-models-th hm-models-th--rank">Rank</th>
                <th className="hm-models-th hm-models-th--agent">Agent</th>
                <th className="hm-models-th hm-models-th--provider">Provider</th>
                <th className="hm-models-th hm-models-th--winrate">Win Rate</th>
                <th className="hm-models-th hm-models-th--record">W / L</th>
                <th className="hm-models-th hm-models-th--streak">Streak</th>
              </tr>
            </thead>
            <tbody>
              {models.map((m) => {
                const live = isFighting(m.agentName);
                return (
                  <tr
                    key={m.agentName}
                    className={`hm-models-row${live ? " hm-models-row--live" : ""}`}
                  >
                    <td className="hm-models-td hm-models-td--rank">
                      <RankBadge rank={m.rank} />
                    </td>

                    <td className="hm-models-td hm-models-td--agent">
                      <div className="hm-models-agent-cell">
                        <span className="hm-models-agent-name">{m.agentName}</span>
                        {live && (
                          <span className="hm-models-row-live-badge">FIGHT</span>
                        )}
                        <span className="hm-models-agent-model">{m.model}</span>
                      </div>
                    </td>

                    <td className="hm-models-td hm-models-td--provider">
                      <span
                        className="hm-models-provider-pill"
                        style={{ borderColor: providerColor(m.provider) }}
                      >
                        <span
                          className="hm-models-provider-dot"
                          style={{ background: providerColor(m.provider) }}
                        />
                        {m.provider}
                      </span>
                    </td>

                    <td className="hm-models-td hm-models-td--winrate">
                      <div className="hm-models-winrate-cell">
                        <span className="hm-models-winrate-pct">
                          {m.winRate.toFixed(1)}%
                        </span>
                        <WinRateBar pct={m.winRate} />
                      </div>
                    </td>

                    <td className="hm-models-td hm-models-td--record">
                      <span className="hm-models-record">
                        <span className="hm-models-wins">{m.wins}W</span>
                        <span className="hm-models-record-sep">·</span>
                        <span className="hm-models-losses">{m.losses}L</span>
                      </span>
                    </td>

                    <td className="hm-models-td hm-models-td--streak">
                      {m.currentStreak > 0 ? (
                        <span className="hm-models-streak hm-models-streak--hot">
                          {m.currentStreak}W 🔥
                        </span>
                      ) : (
                        <span className="hm-models-streak hm-models-streak--none">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Footer note ── */}
      <p className="hm-models-footer-note">
        Rankings update after each completed fight · EVM contracts on Avalanche C-Chain
      </p>
    </div>
  );
}

import React, { useEffect, useState } from "react";
import {
  formatLocaleAmount,
  formatTimeAgoLabel,
  getUiCopy,
  resolveUiLocale,
  type UiLocale,
} from "@hyperbet/ui/i18n";
import { type HyperbetThemeId, useHyperbetThemeSurface } from "../lib/theme";

export interface Trade {
  id: string; // unique
  side: "YES" | "NO";
  amount: number;
  price?: number;
  time: number; // timestamp
  trader?: string;
}

interface RecentTradesProps {
  yesPot: number;
  noPot: number;
  totalPot: number;
  goldPriceUsd: number | null;
  locale?: UiLocale;
  assetSymbol?: string;
  trades: Trade[]; // Real trades
  theme?: HyperbetThemeId;
}

export function RecentTrades({
  yesPot,
  noPot,
  totalPot,
  goldPriceUsd,
  locale,
  assetSymbol = "GOLD",
  trades,
  theme,
}: RecentTradesProps) {
  const resolvedLocale = resolveUiLocale(locale);
  const copy = getUiCopy(resolvedLocale);
  const { themeStyle, themeAttribute } = useHyperbetThemeSurface(theme);
  // We'll use a tick to keep "time ago" fresh
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div data-hyperbet-theme={themeAttribute} style={themeStyle}>
      <style>{`
        @keyframes flashNewTrade {
          0% { background: rgba(255,255,255,0.25); }
          100% { background: transparent; }
        }
        .trade-row-new {
          animation: flashNewTrade 1s cubic-bezier(0.4, 0, 0.2, 1);
        }
      `}</style>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          borderBottom: "1px solid var(--hm-border-subtle, rgba(255,255,255,0.05))",
          paddingBottom: 4,
        }}
      >
        <div
          style={{
            fontSize: 14,
            fontWeight: 800,
            textTransform: "uppercase",
            letterSpacing: 2,
            color: "var(--hm-text-dim, rgba(255,255,255,0.4))",
            fontFamily: "var(--hm-font-display)",
          }}
        >
          {copy.recentTrades}
        </div>
        {goldPriceUsd !== null && false /* Shown in chart area instead */}
      </div>

      {/* Header */}
      <div
        style={{
          display: "flex",
          fontSize: 9,
          fontWeight: 900,
          color: "var(--hm-text-muted, rgba(255,255,255,0.35))",
          padding: "2px 4px",
          textTransform: "uppercase",
          letterSpacing: 1.5,
          fontFamily: "var(--hm-font-display)",
        }}
      >
        <div style={{ flex: 1 }}>{copy.side}</div>
        <div style={{ flex: 1, textAlign: "right" }}>{copy.size}</div>
        <div style={{ flex: 1, textAlign: "right" }}>{copy.time}</div>
      </div>

      {/* Trade List — 7 visible rows, scrollable overflow */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 1,
          height: 164,
          maxHeight: 164,
          overflowY: "auto",
        }}
      >
        {trades.length === 0 ? (
          <div
            style={{
              textAlign: "center",
              padding: "16px 0",
              color: "var(--hm-text-muted, rgba(255,255,255,0.2))",
              fontSize: 12,
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {copy.noTradesYet}
          </div>
        ) : (
          trades.map((trade, i) => {
            // Assume trade is "new" if under 2 seconds old
            const isNew = Date.now() - trade.time < 2000;
            return (
              <div
                key={trade.id}
                className={isNew ? "trade-row-new" : ""}
                style={{
                  display: "flex",
                  fontSize: 11,
                  padding: "3px 6px",
                  borderRadius: 4,
                  borderBottom:
                    i < trades.length - 1
                      ? "1px solid var(--hm-border-subtle, rgba(255,255,255,0.03))"
                      : "none",
                  transition: "background 0.3s",
                }}
              >
                <div
                  style={{
                    flex: 1,
                    color: trade.side === "YES" ? "var(--hm-buy)" : "var(--hm-sell)",
                    fontWeight: 900,
                    fontFamily: "var(--hm-font-display)",
                    letterSpacing: 1,
                    fontSize: 13,
                    display: "flex",
                    alignItems: "center",
                    gap: 5,
                  }}
                >
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      background: trade.side === "YES" ? "var(--hm-buy)" : "var(--hm-sell)",
                      boxShadow:
                        trade.side === "YES"
                          ? "0 0 6px var(--hm-trade-buy-glow, rgba(34,197,94,0.5))"
                          : "0 0 6px var(--hm-trade-sell-glow, rgba(232,65,66,0.5))",
                      flexShrink: 0,
                    }}
                  />
                  {trade.side}
                </div>
                <div
                  style={{
                    flex: 1,
                    textAlign: "right",
                    color: "var(--hm-text, rgba(255,255,255,0.7))",
                  }}
                >
                  {formatLocaleAmount(trade.amount, resolvedLocale)}
                </div>
                <div
                  style={{
                    flex: 1,
                    textAlign: "right",
                    color: "var(--hm-text-muted, rgba(255,255,255,0.35))",
                    fontSize: 11,
                  }}
                >
                  {formatTimeAgoLabel(trade.time, resolvedLocale)}
                </div>
              </div>
            );
          })
        )}
      </div>


    </div>
  );
}

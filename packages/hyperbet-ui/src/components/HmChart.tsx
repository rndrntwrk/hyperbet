/**
 * HmChart — Lightweight-Charts v5 area chart for EVM prediction market odds.
 *
 * Renders two series:
 *  - Agent A (YES): gold area fill, top of chart
 *  - Agent B (NO): derived as 100 - pct, red line
 *
 * Designed to live inside .hm-chart-container (flex: 1, width 100%, height 100%).
 */

import { useEffect, useRef, useCallback, type CSSProperties } from "react";
import {
  createChart,
  type IChartApi,
  type ISeriesApi,
  type DeepPartial,
  type ChartOptions,
  type UTCTimestamp,
  LineSeries,
  AreaSeries,
} from "lightweight-charts";
import {
  type HyperbetThemeId,
  useResolvedHyperbetTheme,
} from "../lib/theme";

export interface HmChartPoint {
  time: number; // unix ms
  pct: number;  // 0–100, Agent A percentage
}

interface HmChartProps {
  data: HmChartPoint[];
  theme?: HyperbetThemeId;
}

type ChartTheme = {
  yes: string;
  yesDim: string;
  yesZero: string;
  no: string;
  noDim: string;
  noZero: string;
  grid: string;
  border: string;
  text: string;
  bg: string;
  fiftyLine: string;
  crosshair: string;
  crosshairLabelBg: string;
};

function readChartTheme(source?: Element | null): ChartTheme {
  const styles = getComputedStyle(source ?? document.documentElement);
  return {
    yes: styles.getPropertyValue("--hm-chart-yes").trim() || "#E84142",
    yesDim:
      styles.getPropertyValue("--hm-chart-yes-dim").trim() ||
      "rgba(232,65,66,0.18)",
    yesZero:
      styles.getPropertyValue("--hm-chart-yes-zero").trim() ||
      "rgba(232,65,66,0)",
    no: styles.getPropertyValue("--hm-chart-no").trim() || "#0f766e",
    noDim:
      styles.getPropertyValue("--hm-chart-no-dim").trim() ||
      "rgba(15,118,110,0.12)",
    noZero:
      styles.getPropertyValue("--hm-chart-no-zero").trim() ||
      "rgba(15,118,110,0)",
    grid:
      styles.getPropertyValue("--hm-chart-grid").trim() ||
      "rgba(255,255,255,0.04)",
    border:
      styles.getPropertyValue("--hm-chart-border").trim() ||
      "rgba(255,255,255,0.06)",
    text:
      styles.getPropertyValue("--hm-chart-text").trim() ||
      "rgba(255,255,255,0.4)",
    bg: styles.getPropertyValue("--hm-chart-bg").trim() || "#12141a",
    fiftyLine:
      styles.getPropertyValue("--hm-chart-midline").trim() ||
      "rgba(255,255,255,0.06)",
    crosshair:
      styles.getPropertyValue("--hm-chart-crosshair").trim() ||
      "rgba(255,255,255,0.15)",
    crosshairLabelBg:
      styles.getPropertyValue("--hm-chart-crosshair-label-bg").trim() ||
      "#1a1d24",
  };
}

/** Convert ms timestamp to lightweight-charts UTCTimestamp (seconds) */
function toUTC(ms: number): UTCTimestamp {
  return Math.floor(ms / 1000) as UTCTimestamp;
}

export function HmChart({ data, theme }: HmChartProps) {
  const themeDefinition = useResolvedHyperbetTheme(theme);
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesARef = useRef<ISeriesApi<"Area"> | null>(null);
  const seriesBRef = useRef<ISeriesApi<"Area"> | null>(null);
  const lastLenRef = useRef(0);
  const midSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);

  const applyThemeToChart = useCallback(() => {
    const chart = chartRef.current;
    const seriesA = seriesARef.current;
    const seriesB = seriesBRef.current;
    const midSeries = midSeriesRef.current;
    if (!chart || !seriesA || !seriesB || !midSeries) return;

    const chartTheme = readChartTheme(containerRef.current);
    const options: DeepPartial<ChartOptions> = {
      layout: {
        background: { color: chartTheme.bg },
        textColor: chartTheme.text,
        fontFamily: "var(--hm-font-mono)",
        fontSize: 11,
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: chartTheme.grid },
        horzLines: { color: chartTheme.grid },
      },
      crosshair: {
        vertLine: {
          color: chartTheme.crosshair,
          width: 1,
          style: 3,
          labelBackgroundColor: chartTheme.crosshairLabelBg,
        },
        horzLine: {
          color: chartTheme.crosshair,
          width: 1,
          style: 3,
          labelBackgroundColor: chartTheme.crosshairLabelBg,
        },
      },
      rightPriceScale: {
        borderColor: chartTheme.border,
        scaleMargins: { top: 0.08, bottom: 0.08 },
        visible: true,
      },
      timeScale: {
        borderColor: chartTheme.border,
        timeVisible: true,
        secondsVisible: false,
        fixLeftEdge: false,
        fixRightEdge: true,
      },
      handleScroll: { mouseWheel: true, pressedMouseMove: true },
      handleScale: { mouseWheel: true, pinch: true },
    };
    chart.applyOptions(options);

    midSeries.applyOptions({
      color: chartTheme.fiftyLine,
      lineWidth: 1,
      lineStyle: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });

    seriesA.applyOptions({
      lineColor: chartTheme.yes,
      topColor: chartTheme.yesDim,
      bottomColor: chartTheme.yesZero,
      lineWidth: 2,
      priceFormat: { type: "custom", formatter: (v: number) => `${v.toFixed(1)}%` },
      lastValueVisible: true,
      priceLineVisible: false,
      crosshairMarkerVisible: true,
      crosshairMarkerRadius: 4,
      crosshairMarkerBackgroundColor: chartTheme.yes,
    });

    seriesB.applyOptions({
      lineColor: chartTheme.no,
      topColor: chartTheme.noZero,
      bottomColor: chartTheme.noDim,
      lineWidth: 1,
      priceFormat: { type: "custom", formatter: (v: number) => `${v.toFixed(1)}%` },
      lastValueVisible: true,
      priceLineVisible: false,
      crosshairMarkerVisible: true,
      crosshairMarkerRadius: 3,
      crosshairMarkerBackgroundColor: chartTheme.no,
    });
  }, []);

  // ── Create chart once on mount ─────────────────────────────────────────────
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const chart = createChart(container, {
      width: container.clientWidth,
      height: container.clientHeight || 180,
    });

    // 50% reference line as a separate thin series
    const chartTheme = readChartTheme(container);
    const midSeries = chart.addSeries(LineSeries, {
      color: chartTheme.fiftyLine,
      lineWidth: 1,
      lineStyle: 2, // dashed
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });

    const seriesA = chart.addSeries(AreaSeries, {
      lineColor: chartTheme.yes,
      topColor: chartTheme.yesDim,
      bottomColor: chartTheme.yesZero,
      lineWidth: 2,
      priceFormat: { type: "custom", formatter: (v: number) => `${v.toFixed(1)}%` },
      lastValueVisible: true,
      priceLineVisible: false,
      crosshairMarkerVisible: true,
      crosshairMarkerRadius: 4,
      crosshairMarkerBackgroundColor: chartTheme.yes,
    });
    const seriesB = chart.addSeries(AreaSeries, {
      lineColor: chartTheme.no,
      topColor: chartTheme.noZero,
      bottomColor: chartTheme.noDim,
      lineWidth: 1,
      priceFormat: { type: "custom", formatter: (v: number) => `${v.toFixed(1)}%` },
      lastValueVisible: true,
      priceLineVisible: false,
      crosshairMarkerVisible: true,
      crosshairMarkerRadius: 3,
      crosshairMarkerBackgroundColor: chartTheme.no,
    });

    // Seed the 50% line across a wide time window so it always shows
    const now = Math.floor(Date.now() / 1000) as UTCTimestamp;
    midSeries.setData([
      { time: (now - 7200) as UTCTimestamp, value: 50 },
      { time: (now + 7200) as UTCTimestamp, value: 50 },
    ]);

    chartRef.current = chart;
    seriesARef.current = seriesA;
    seriesBRef.current = seriesB;
    midSeriesRef.current = midSeries;
    applyThemeToChart();

    // Responsive resize — track both width and height
    const ro = new ResizeObserver(() => {
      chart.applyOptions({
        width: container.clientWidth,
        height: container.clientHeight || 180,
      });
    });
    ro.observe(container);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesARef.current = null;
      seriesBRef.current = null;
      midSeriesRef.current = null;
      lastLenRef.current = 0;
    };
  }, [applyThemeToChart]);

  useEffect(() => {
    applyThemeToChart();
    const observer = new MutationObserver(() => applyThemeToChart());
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "style", "class"],
    });
    return () => observer.disconnect();
  }, [applyThemeToChart, theme, themeDefinition]);

  // ── Push data updates efficiently ──────────────────────────────────────────
  const updateSeries = useCallback(() => {
    const seriesA = seriesARef.current;
    const seriesB = seriesBRef.current;
    if (!seriesA || !seriesB || data.length === 0) return;

    if (data.length !== lastLenRef.current) {
      // Full redraw when data length changes significantly (new duel / reset)
      const aData = data.map((d) => ({ time: toUTC(d.time), value: d.pct }));
      const bData = data.map((d) => ({ time: toUTC(d.time), value: 100 - d.pct }));
      seriesA.setData(aData);
      seriesB.setData(bData);
      chartRef.current?.timeScale().scrollToRealTime();
      lastLenRef.current = data.length;
    }
  }, [data]);

  useEffect(() => {
    updateSeries();
  }, [updateSeries]);

  return (
    <div
      ref={containerRef}
      data-hyperbet-theme={theme}
      style={{
        width: "100%",
        height: "100%",
        ...(themeDefinition.colorVariables as CSSProperties),
      }}
    />
  );
}

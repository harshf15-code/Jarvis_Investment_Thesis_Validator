"use client";

import { useEffect, useRef, useState } from "react";
import {
  CandlestickSeries,
  ColorType,
  HistogramSeries,
  LineSeries,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type Time,
} from "lightweight-charts";

import { simpleMovingAverage } from "@/lib/sma";
import { cn } from "@/lib/utils";

/** One daily OHLCV bar, matching `getHistoricalOHLCV`'s return element shape. */
export type OhlcvBar = {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

/**
 * Reads a Neon Velocity design token's resolved value straight off
 * `:root` via `getComputedStyle`, rather than hardcoding a hex duplicate of
 * `styles/tokens.css` here — if a token's hex ever changes, this chart picks
 * it up automatically instead of silently drifting out of sync.
 *
 * No hardcoded hex fallback: `styles/tokens.css` must stay the single
 * source of truth for every color in the app (Task 12's design-polish sweep
 * grep for stray hex codes checks exactly this). This is safe because the
 * only caller runs inside a `useEffect` (see below), which never executes
 * during SSR — `document`/`getComputedStyle` are always available by the
 * time this runs, so the token always resolves to a real value.
 */
function readColorToken(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** `#rrggbb` -> `rgba(r, g, b, alpha)`, for grid lines / tinted fills. */
function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace("#", "");
  const int = parseInt(clean, 16);
  const r = (int >> 16) & 255;
  const g = (int >> 8) & 255;
  const b = int & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

type SmaPoint = { time: Time; value: number };

function toSmaPoints(ohlcv: OhlcvBar[], window: number): SmaPoint[] {
  const closes = ohlcv.map((bar) => bar.close);
  const sma = simpleMovingAverage(closes, window);
  const points: SmaPoint[] = [];
  for (let i = 0; i < ohlcv.length; i++) {
    const value = sma[i];
    if (value !== null) {
      points.push({ time: ohlcv[i].time as Time, value });
    }
  }
  return points;
}

/**
 * Client component wrapping `lightweight-charts`: a candlestick series
 * (up = `primary`, down = `error`), a volume histogram in a lower pane, an
 * always-on 200-period SMA overlay, and a 50-period SMA overlay behind a
 * toggle that defaults OFF. `ohlcv` is fetched by the parent server
 * component (`app/(app)/stocks/[id]/page.tsx`) and passed in as a prop —
 * this component does no fetching of its own.
 */
export function CandlestickChart({ ohlcv }: { ohlcv: OhlcvBar[] }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const sma50SeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const [show50Sma, setShow50Sma] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || ohlcv.length === 0) {
      return;
    }

    const surface = readColorToken("--color-surface");
    const onSurface = readColorToken("--color-on-surface");
    const outlineVariant = readColorToken("--color-outline-variant");
    const primary = readColorToken("--color-primary");
    const error = readColorToken("--color-error");

    const chart = createChart(container, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: surface },
        textColor: onSurface,
      },
      grid: {
        // Near-invisible: the outline token at very low opacity, per the
        // No-Line Rule's one exception (ghost gridlines are acceptable
        // where a border would not be).
        vertLines: { color: hexToRgba(outlineVariant, 0.08) },
        horzLines: { color: hexToRgba(outlineVariant, 0.08) },
      },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false },
      crosshair: {
        vertLine: { color: hexToRgba(outlineVariant, 0.4), labelBackgroundColor: surface },
        horzLine: { color: hexToRgba(outlineVariant, 0.4), labelBackgroundColor: surface },
      },
    });
    chartRef.current = chart;

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: primary,
      downColor: error,
      borderUpColor: primary,
      borderDownColor: error,
      wickUpColor: primary,
      wickDownColor: error,
    });
    candleSeries.setData(
      ohlcv.map((bar) => ({
        time: bar.time as Time,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
      })),
    );

    // Volume histogram in its own lower pane (pane index 1), auto-created by
    // `addSeries`'s `paneIndex` argument.
    const volumeSeries = chart.addSeries(
      HistogramSeries,
      { priceFormat: { type: "volume" }, priceLineVisible: false, lastValueVisible: false },
      1,
    );
    volumeSeries.setData(
      ohlcv.map((bar) => ({
        time: bar.time as Time,
        value: bar.volume,
        color:
          bar.close >= bar.open
            ? hexToRgba(primary, 0.5)
            : hexToRgba(error, 0.5),
      })),
    );
    chart.panes()[1]?.setHeight(90);

    // 200-period SMA: always on.
    const sma200Series = chart.addSeries(LineSeries, {
      color: hexToRgba(onSurface, 0.55),
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    sma200Series.setData(toSmaPoints(ohlcv, 200));

    // 50-period SMA: behind a toggle, defaults OFF.
    const sma50Series = chart.addSeries(LineSeries, {
      color: hexToRgba(primary, 0.85),
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
      visible: show50Sma,
    });
    sma50Series.setData(toSmaPoints(ohlcv, 50));
    sma50SeriesRef.current = sma50Series;

    chart.timeScale().fitContent();

    return () => {
      chart.remove();
      chartRef.current = null;
      sma50SeriesRef.current = null;
    };
    // `show50Sma`'s initial value is read once above (the toggle's own
    // effect below keeps it in sync afterwards) — re-running this whole
    // effect on every toggle would rebuild the entire chart just to flip
    // one series's visibility.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ohlcv]);

  // Keeps the 50-SMA series's visibility in sync with the toggle without
  // rebuilding the whole chart.
  useEffect(() => {
    sma50SeriesRef.current?.applyOptions({ visible: show50Sma });
  }, [show50Sma]);

  if (ohlcv.length === 0) {
    return (
      <div className="flex h-[380px] items-center justify-center rounded-xl bg-surface-container-low text-sm text-on-surface/50">
        No price history available.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => setShow50Sma((prev) => !prev)}
          aria-pressed={show50Sma}
          className={cn(
            "h-7 rounded-full px-3 text-xs font-medium transition-colors",
            show50Sma
              ? "bg-primary/10 text-primary"
              : "bg-surface-container-highest text-on-surface/60 hover:text-on-surface",
          )}
        >
          50-day SMA
        </button>
      </div>
      <div
        ref={containerRef}
        className="h-[380px] w-full overflow-hidden rounded-xl"
      />
    </div>
  );
}

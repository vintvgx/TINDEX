import React, { useMemo } from 'react';
import Svg, { Line, Path } from 'react-native-svg';

/**
 * Small in-house SVG line chart — same hand-rolled Path/Line pattern as
 * TradeAnalytics.tsx's EquitySparkline (kept as a separate component here
 * rather than imported/shared, since that file is owned by a concurrent,
 * unrelated change), generalized to plot one or more time-aligned series on
 * a shared scale. Used for both the single-series Day P/L sparkline and the
 * multi-series Robinhood-vs-SPY-vs-QQQ benchmark comparison.
 *
 * Points carry a real epoch-ms timestamp rather than assuming every series
 * has the same number of samples at the same spacing — Robinhood's own
 * equity historicals (5-minute bars) and yfinance's ticker history (1-minute
 * or daily bars, depending on period) don't line up 1:1, so x position is
 * derived from actual time, not array index.
 */
export interface ChartPoint {
  t: number; // epoch ms
  v: number; // value (raw $ or normalized % change)
}

export interface ChartSeries {
  key: string;
  color: string;
  points: ChartPoint[];
}

export function MiniLineChart({
  series,
  width,
  height,
  zeroLineColor,
  fillFirstSeries = false,
}: {
  series: ChartSeries[];
  width: number;
  height: number;
  /** Draws a dashed reference line at v=0 (e.g. flat/breakeven) when provided. */
  zeroLineColor?: string;
  /** Shades the area under the first series — only meaningful for a single-series chart. */
  fillFirstSeries?: boolean;
}) {
  const scale = useMemo(() => {
    const allPoints = series.flatMap(s => s.points);
    if (allPoints.length < 2) return null;

    const tValues = allPoints.map(p => p.t);
    const vValues = allPoints.map(p => p.v);
    const tMin = Math.min(...tValues);
    const tMax = Math.max(...tValues);
    const vMin = Math.min(...vValues, zeroLineColor ? 0 : Infinity);
    const vMax = Math.max(...vValues, zeroLineColor ? 0 : -Infinity);
    const tRange = tMax - tMin || 1;
    const vRange = vMax - vMin || 1;

    return {
      x: (t: number) => ((t - tMin) / tRange) * width,
      y: (v: number) => height - ((v - vMin) / vRange) * height,
      zeroY: height - ((0 - vMin) / vRange) * height,
    };
  }, [series, width, height, zeroLineColor]);

  if (!scale) return null;

  const paths = series
    .filter(s => s.points.length >= 2)
    .map(s => {
      const sorted = [...s.points].sort((a, b) => a.t - b.t);
      const d = sorted
        .map((p, i) => `${i === 0 ? 'M' : 'L'}${scale.x(p.t).toFixed(1)},${scale.y(p.v).toFixed(1)}`)
        .join(' ');
      return { key: s.key, d, color: s.color };
    });

  if (paths.length === 0) return null;

  const areaPath = fillFirstSeries && paths[0]
    ? `${paths[0].d} L${width},${height} L0,${height} Z`
    : null;

  return (
    <Svg width={width} height={height}>
      {areaPath && <Path d={areaPath} fill={paths[0].color} opacity={0.12} />}
      {zeroLineColor && scale.zeroY > 1 && scale.zeroY < height - 1 && (
        <Line x1={0} y1={scale.zeroY} x2={width} y2={scale.zeroY} stroke={zeroLineColor} strokeWidth={1} strokeDasharray="3,4" opacity={0.5} />
      )}
      {paths.map(p => (
        <Path key={p.key} d={p.d} stroke={p.color} strokeWidth={2} fill="none" />
      ))}
    </Svg>
  );
}

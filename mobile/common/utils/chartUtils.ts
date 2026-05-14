// ─── Types ────────────────────────────────────────────────────────────────────

export type ChartPeriod = '1D' | '1W' | '1M' | 'YTD' | '1Y' | '5Y' | 'Max';

export interface ChartDataPoint {
  date: string;
  price: number;
}

export interface FilteredChartData {
  points: ChartDataPoint[];
  priceChange: number;      // absolute change over the period
  priceChangePct: number;   // percent change
  isPositive: boolean;
}

export interface IndicatorLine {
  id: string;
  label: string;
  values: number[];         // same length as FilteredChartData.points
  color: string;
  strokeWidth?: number;
  dashed?: boolean;
}

// ─── Period filtering ─────────────────────────────────────────────────────────

export function filterByPeriod(
  dates: string[],
  prices: number[],
  period: ChartPeriod,
): FilteredChartData {
  if (!dates.length || !prices.length) {
    return { points: [], priceChange: 0, priceChangePct: 0, isPositive: true };
  }

  const pairs = dates
    .map((d, i) => ({ date: d, price: prices[i] }))
    .filter(p => typeof p.price === 'number' && isFinite(p.price));

  const now = new Date();
  let cutoff: Date | null = null;

  switch (period) {
    case '1D':
      // Daily data only — show last 2 sessions (today vs previous close)
      cutoff = new Date(now);
      cutoff.setDate(now.getDate() - 2);
      break;
    case '1W':
      cutoff = new Date(now);
      cutoff.setDate(now.getDate() - 7);
      break;
    case '1M':
      cutoff = new Date(now);
      cutoff.setMonth(now.getMonth() - 1);
      break;
    case 'YTD':
      cutoff = new Date(now.getFullYear(), 0, 1);
      break;
    case '1Y':
      cutoff = new Date(now);
      cutoff.setFullYear(now.getFullYear() - 1);
      break;
    case '5Y':
      cutoff = new Date(now);
      cutoff.setFullYear(now.getFullYear() - 5);
      break;
    case 'Max':
    default:
      cutoff = null;
  }

  const filtered = cutoff
    ? pairs.filter(p => new Date(p.date) >= cutoff!)
    : pairs;

  // Always keep at least 2 points so the chart renders
  const points = filtered.length >= 2 ? filtered : pairs.slice(-Math.max(2, pairs.length));

  const firstPrice = points[0]?.price ?? 0;
  const lastPrice = points[points.length - 1]?.price ?? 0;
  const priceChange = lastPrice - firstPrice;
  const priceChangePct = firstPrice !== 0 ? (priceChange / firstPrice) * 100 : 0;

  return { points, priceChange, priceChangePct, isPositive: priceChange >= 0 };
}

// ─── Label helpers ────────────────────────────────────────────────────────────

/** Returns true if the date string includes a time component (intraday data). */
export function isIntradayDate(dateStr: string): boolean {
  return dateStr.includes('T');
}

export function formatAxisLabel(dateStr: string, period: ChartPeriod): string {
  if (period === '1D' && isIntradayDate(dateStr)) {
    // Intraday — show HH:MM
    const d = new Date(dateStr);
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  }
  const d = new Date(`${dateStr}T12:00:00`);
  switch (period) {
    case '1D':
    case '1W':
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    case '1M':
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    case 'YTD':
    case '1Y':
      return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
    case '5Y':
    case 'Max':
      return String(d.getFullYear());
    default:
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
}

export function formatTooltipDate(dateStr: string): string {
  if (isIntradayDate(dateStr)) {
    const d = new Date(dateStr);
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  }
  const d = new Date(`${dateStr}T12:00:00`);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Return the indices within `count` items where x-axis labels should be shown. */
export function getLabelIndices(count: number, maxLabels = 5): number[] {
  if (count === 0) return [];
  if (count <= maxLabels) return Array.from({ length: count }, (_, i) => i);

  const indices: number[] = [0];
  const step = (count - 1) / (maxLabels - 1);
  for (let i = 1; i < maxLabels - 1; i++) {
    indices.push(Math.round(i * step));
  }
  indices.push(count - 1);
  return indices;
}

// ─── SVG path builders ────────────────────────────────────────────────────────

export interface ChartCoord {
  x: number;
  y: number;
}

/**
 * Map a price value to a y-coordinate within the plot area.
 * Includes 8% vertical padding so the line doesn't touch the edges.
 */
export function priceToY(
  price: number,
  minPrice: number,
  maxPrice: number,
  plotTop: number,
  plotHeight: number,
): number {
  const range = maxPrice - minPrice || 1;
  const pad = range * 0.08;
  const paddedMin = minPrice - pad;
  const paddedMax = maxPrice + pad;
  const paddedRange = paddedMax - paddedMin;
  return plotTop + (1 - (price - paddedMin) / paddedRange) * plotHeight;
}

export function buildCoords(
  prices: number[],
  minPrice: number,
  maxPrice: number,
  plotLeft: number,
  plotTop: number,
  plotWidth: number,
  plotHeight: number,
): ChartCoord[] {
  const n = prices.length;
  if (n === 0) return [];
  return prices.map((price, i) => ({
    x: plotLeft + (n === 1 ? plotWidth / 2 : (i / (n - 1)) * plotWidth),
    y: priceToY(price, minPrice, maxPrice, plotTop, plotHeight),
  }));
}

/** Straight-segment polyline string ("x1,y1 x2,y2 ...") */
export function buildPolylinePoints(coords: ChartCoord[]): string {
  return coords.map(c => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ');
}

/** SVG Path for the filled area below the line. */
export function buildAreaPath(coords: ChartCoord[], plotBottom: number): string {
  if (coords.length === 0) return '';
  const first = coords[0];
  const last = coords[coords.length - 1];
  const line = coords.map(c => `L ${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ');
  return `M ${first.x.toFixed(1)},${plotBottom} ${line} L ${last.x.toFixed(1)},${plotBottom} Z`;
}

// ─── Indicator calculations ───────────────────────────────────────────────────

/**
 * Exponential Moving Average (EMA).
 * Returns NaN for the first (period-1) positions where there's insufficient data.
 */
export function calcEMA(prices: number[], period: number): number[] {
  if (prices.length < period) return new Array(prices.length).fill(NaN);
  const k = 2 / (period + 1);
  const result: number[] = new Array(prices.length).fill(NaN);

  // Seed with SMA of first `period` prices
  let sma = 0;
  for (let i = 0; i < period; i++) sma += prices[i];
  result[period - 1] = sma / period;

  for (let i = period; i < prices.length; i++) {
    result[i] = prices[i] * k + result[i - 1] * (1 - k);
  }
  return result;
}

/**
 * Simple Moving Average (SMA).
 * Returns NaN where insufficient data.
 */
export function calcSMA(prices: number[], period: number): number[] {
  const result: number[] = new Array(prices.length).fill(NaN);
  for (let i = period - 1; i < prices.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += prices[j];
    result[i] = sum / period;
  }
  return result;
}

/**
 * Relative Strength Index (RSI).
 * Standard 14-period RSI using Wilder's smoothing.
 */
export function calcRSI(prices: number[], period = 14): number[] {
  if (prices.length <= period) return new Array(prices.length).fill(NaN);
  const result: number[] = new Array(prices.length).fill(NaN);

  const changes = prices.slice(1).map((p, i) => p - prices[i]);
  let avgGain = 0;
  let avgLoss = 0;

  for (let i = 0; i < period; i++) {
    if (changes[i] > 0) avgGain += changes[i];
    else avgLoss += Math.abs(changes[i]);
  }
  avgGain /= period;
  avgLoss /= period;

  const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
  result[period] = 100 - 100 / (1 + rs);

  for (let i = period; i < changes.length; i++) {
    const gain = changes[i] > 0 ? changes[i] : 0;
    const loss = changes[i] < 0 ? Math.abs(changes[i]) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    const r = avgLoss === 0 ? 100 : avgGain / avgLoss;
    result[i + 1] = 100 - 100 / (1 + r);
  }
  return result;
}

/**
 * Bollinger Bands (20-period SMA ± 2 standard deviations).
 */
export function calcBollingerBands(
  prices: number[],
  period = 20,
  stdDevMultiplier = 2,
): { upper: number[]; middle: number[]; lower: number[] } {
  const middle = calcSMA(prices, period);
  const upper = new Array(prices.length).fill(NaN);
  const lower = new Array(prices.length).fill(NaN);

  for (let i = period - 1; i < prices.length; i++) {
    const slice = prices.slice(i - period + 1, i + 1);
    const mean = middle[i];
    const variance = slice.reduce((s, p) => s + (p - mean) ** 2, 0) / period;
    const sd = Math.sqrt(variance);
    upper[i] = mean + stdDevMultiplier * sd;
    lower[i] = mean - stdDevMultiplier * sd;
  }
  return { upper, middle, lower };
}

// ─── Formatting ───────────────────────────────────────────────────────────────

export function formatVolume(v: number): string {
  if (v >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(1)}B`;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return String(v);
}

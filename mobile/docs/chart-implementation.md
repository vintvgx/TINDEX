# Chart Implementation

## Overview

The price chart is built using `react-native-svg` (v15) with a fully custom SVG renderer. The previous implementation used `react-native-chart-kit`, which had fundamental issues: label overflow at any reasonable data density, hardcoded dark backgrounds that broke light-mode, no path for overlaying indicator lines, and no touch interaction. The new implementation fixes all of these.

---

## Architecture

```
[ticker].tsx
    └─ SummaryTab.tsx         — period state, data filtering, card layout
           ├─ PriceChart.tsx  — SVG chart renderer (pure display, no data logic)
           └─ chartUtils.ts   — period filtering, math, SVG path builders, indicator calculations
```

### Data flow

```
Backend (POST /ticker/:ticker)
  → useTickerQuery
    → tickerResponse.data.historical_data { dates: string[], prices: number[], volumes: number[] }
      → filterByPeriod(dates, prices, period)   [chartUtils.ts]
        → FilteredChartData { points: ChartDataPoint[], priceChange, priceChangePct, isPositive }
          → <PriceChart points={...} period={...} isPositive={...} />
```

---

## File Responsibilities

### `common/utils/chartUtils.ts`

Pure utility functions — no React, no side effects.

| Export | Purpose |
|---|---|
| `filterByPeriod(dates, prices, period)` | Slices the historical data arrays to the selected period. Returns `FilteredChartData`. |
| `formatAxisLabel(dateStr, period)` | Formats a date string into an appropriate x-axis label for the given period (e.g. `"May 13"` for 1M, ``"2024"` for Max). |
| `formatTooltipDate(dateStr)` | Long-form date for the touch tooltip (e.g. `"Tue, May 13, 2025"`). |
| `getLabelIndices(count, maxLabels)` | Returns the indices within the dataset where x-axis labels should appear. Spreads them evenly and always includes the first and last. |
| `buildCoords(prices, min, max, ...)` | Maps price values to `{ x, y }` SVG coordinates within the plot area. Applies 8% vertical padding so the line never touches the chart edges. |
| `buildPolylinePoints(coords)` | Converts `ChartCoord[]` to an SVG polyline `points` string. |
| `buildAreaPath(coords, plotBottom)` | Builds the SVG `Path` `d` string for the filled area below the line. |
| `priceToY(price, min, max, ...)` | Converts a single price to a y-coordinate (used for indicator overlays). |
| `calcEMA(prices, period)` | Calculates an Exponential Moving Average series. Returns `NaN` for the first `period-1` positions. |
| `calcSMA(prices, period)` | Calculates a Simple Moving Average series. |
| `calcRSI(prices, period)` | Calculates RSI using Wilder's smoothing method. Standard 14-period default. |
| `calcBollingerBands(prices, period, mult)` | Returns `{ upper, middle, lower }` arrays. Defaults to 20-period SMA ± 2σ. |
| `formatVolume(v)` | Formats large numbers: `1500000 → "1.5M"`. |

### `common/components/ticker/PriceChart.tsx`

Pure display component. Receives pre-filtered data and renders SVG.

**Props:**
```typescript
interface Props {
  points: ChartDataPoint[];      // { date: string, price: number }[]
  period: ChartPeriod;           // for axis label formatting
  width: number;                 // available pixel width
  isPositive: boolean;           // true = green, false = red
  indicators?: IndicatorLine[];  // overlay lines (same price scale)
}
```

**`IndicatorLine` shape (for future indicators):**
```typescript
interface IndicatorLine {
  id: string;
  label: string;     // e.g. "EMA 20"
  values: number[];  // same length as points; NaN where not yet calculable
  color: string;
  strokeWidth?: number;
  dashed?: boolean;
}
```

NaN values in `values[]` are automatically excluded — the chart skips them cleanly without errors.

**Layout constants:**
```
Total height: 200px
Padding: top=10, right=52 (y-labels), bottom=28 (x-labels), left=4
Plot area: (4, 10) → (width-52, 182)
```

**Touch interaction:** Uses React Native's responder system (`onStartShouldSetResponder`, `onResponderMove`). No external gesture library needed. Dragging across the chart shows a vertical crosshair, a dot on the price line, and a price+date tooltip bubble. Touch ends on `onResponderRelease`.

### `common/components/ticker/SummaryTab.tsx`

Manages period state and card layout. No longer receives `selectedPeriod` / `onPeriodChange` props from the parent — the period is internal.

**Removed from `[ticker].tsx`:**
- `const [selectedPeriod, setSelectedPeriod] = useState('1D')`
- Props `selectedPeriod` and `onPeriodChange` on `<SummaryTab>`

---

## Period Filtering Logic

| Period | Cutoff |
|---|---|
| `1D` | 2 days back (shows previous close → today with daily data) |
| `1W` | 7 days back |
| `1M` | 1 calendar month back |
| `YTD` | January 1st of the current year |
| `1Y` | 1 year back |
| `5Y` | 5 years back |
| `Max` | All available data |

If the filtered result has fewer than 2 points (e.g. selecting `1D` from a mock with only weekly data), the filter falls back to the last 2 points of the full dataset so the chart always renders. A "Not enough data for this period" message is shown if fewer than 2 points exist after the fallback.

---

## Adding Indicator Overlays (Future)

The chart is already wired for overlay indicators. To add EMA-20 to the chart:

```typescript
// In SummaryTab.tsx
import { calcEMA } from '@/common/utils/chartUtils';

const ema20Values = useMemo(
  () => calcEMA(chartResult.points.map(p => p.price), 20),
  [chartResult],
);

const indicators: IndicatorLine[] = [
  {
    id: 'ema-20',
    label: 'EMA 20',
    values: ema20Values,
    color: '#f59e0b',
    strokeWidth: 1.2,
  },
];

// Pass to PriceChart:
<PriceChart ... indicators={indicators} />
```

The chart renders each indicator as a `Polyline` in the same coordinate space as the price line. NaN values (where the indicator hasn't warmed up yet) are automatically skipped.

### RSI (separate sub-chart panel)

RSI oscillates between 0–100 and cannot share the price y-axis. The planned approach is to add a second `<Svg>` block beneath the main chart with its own y-scale (0–100) and lines at 30 and 70. The `calcRSI` function in `chartUtils.ts` is already implemented and ready to use.

### Expanded view (not yet implemented)

The expanded chart view will be a full-screen modal. Recommended approach:
1. Add an "expand" icon button to the chart card header
2. On press, open a `Modal` with `animationType="slide"`
3. Pass `width={Dimensions.get('window').width - 16}` and a taller `CHART_HEIGHT` override
4. The expanded view is where indicator toggles (EMA 20, 50, 200, RSI, etc.) will live as pill buttons

---

## Known Limitations

| Limitation | Notes |
|---|---|
| Daily data only | The backend currently returns end-of-day closes. `1D` cannot show intraday moves. Resolve by adding an intraday endpoint that returns OHLC bars at 5m/15m intervals. |
| Mock data depth | The mock generator in `useTickerQuery` only produces 23 days of synthetic data. `1Y`, `5Y`, `Max` fall back to the same 23 points. This is a mock limitation, not a chart limitation. |
| No volume bars | Volume is available in `historical_data.volumes` but not yet displayed. The recommended approach is a secondary bar chart below the main line using the same x-axis. |
| Indicator panel | RSI and MACD require a sub-chart below the main price chart (different y-scale). Not yet implemented. |

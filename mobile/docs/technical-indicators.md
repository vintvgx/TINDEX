# Technical Indicators Reference

This document covers the most widely used technical indicators for stock and options analysis, how each is calculated from price/volume data, and why it matters. The final section gives a prioritized recommendation for which to implement first.

---

## Indicator Table

| Indicator | Category | Period(s) | Calculation | What It Shows | Essential? |
|---|---|---|---|---|---|
| **EMA** (Exponential Moving Average) | Trend | 10, 20, 50, 200 | Weighted average of closing prices; recent prices get exponentially more weight via multiplier `k = 2/(n+1)`. `EMA_today = Close * k + EMA_yesterday * (1-k)` | Direction of trend. Price above EMA = bullish; below = bearish. Multiple EMAs crossing signal trend changes. | **Must-have** |
| **SMA** (Simple Moving Average) | Trend | 20, 50, 200 | Unweighted mean of the last `n` closes. `SMA = sum(closes) / n` | Same trend purpose as EMA but slower to react. Used as support/resistance levels (especially 200 SMA). | Important |
| **RSI** (Relative Strength Index) | Momentum | 14 | Ratio of average gains to average losses over `n` periods, scaled 0–100. `RSI = 100 − 100/(1 + avgGain/avgLoss)`. Uses Wilder's smoothing. | Overbought (>70) / oversold (<30). Divergence between RSI and price warns of reversals. | **Must-have** |
| **MACD** (Moving Average Convergence/Divergence) | Momentum + Trend | 12/26/9 | `MACD Line = EMA(12) − EMA(26)`. `Signal Line = EMA(9) of MACD Line`. `Histogram = MACD − Signal`. | Momentum shifts and trend changes. Signal-line crossovers are buy/sell signals. Histogram expansion = strengthening momentum. | **Essential** |
| **Bollinger Bands** | Volatility | 20, ±2σ | `Middle = SMA(20)`. `Upper = SMA + 2 * stddev`. `Lower = SMA − 2 * stddev`. Bands widen in high volatility, narrow in low. | Price touching upper band = potentially overbought; lower band = oversold. Band squeeze predicts volatility expansion. Critical for options IV analysis. | **Essential** |
| **VWAP** (Volume-Weighted Avg Price) | Volume/Price | Intraday | `VWAP = cumulative(price × volume) / cumulative(volume)` — resets daily. | Fair value benchmark for the day. Price above VWAP = bullish intraday; below = bearish. Institutional reference for execution quality. | Essential (intraday) |
| **ATR** (Average True Range) | Volatility | 14 | `True Range = max(High−Low, |High−PrevClose|, |Low−PrevClose|)`. `ATR = Wilder's moving average of TR`. | Absolute price volatility, not direction. Used to set stop-loss levels and position size. High ATR = wider options premiums. | Important |
| **OBV** (On-Balance Volume) | Volume | — | Running total: `OBV += volume` if close > prev close; `OBV −= volume` if close < prev close. | Whether volume is flowing into or out of the stock. OBV divergence from price (e.g. price rising, OBV falling) warns of weak buying conviction. | Good to have |
| **Stochastic Oscillator** | Momentum | 14, 3, 3 | `%K = 100 × (Close − Lowest Low) / (Highest High − Lowest Low)` over n periods. `%D = SMA(3) of %K`. | Like RSI but compares close to high/low range. Crossovers above 80 or below 20 are overbought/oversold signals. Works best in ranging (non-trending) markets. | Supplementary |
| **Volume Bars** | Volume | — | Raw per-bar volume displayed as a histogram below the price chart, colored green/red to match the bar's price direction. | Confirms price moves. Rising price on rising volume = conviction. Rising price on declining volume = weak move, potential reversal. | **Must-have** |
| **Williams %R** | Momentum | 14 | `%R = (Highest High − Close) / (Highest High − Lowest Low) × −100`. Ranges −100 to 0. | Similar to Stochastic. Readings above −20 = overbought; below −80 = oversold. | Supplementary |
| **Fibonacci Retracements** | Price Levels | — | Key levels drawn at 23.6%, 38.2%, 50%, 61.8%, 78.6% of a price swing (not calculated from price series; requires swing high/low input). | Horizontal support and resistance zones. Widely watched by traders, which is partly why they work (self-fulfilling). | Important |

---

## Detailed Explanations

### EMA — Exponential Moving Average

**Why it matters more than SMA:** The exponential weighting makes EMA faster to respond to recent price action. When you use multiple EMA lines together (10, 20, 50, 200), the distance and direction of crossings tell you where momentum is heading.

- **EMA 10 / EMA 20** — Short-term trend. Used by day traders and swing traders to catch early turns.
- **EMA 50** — Medium-term trend. Common stop for swing traders. A break below EMA 50 after a rally is a common exit signal.
- **EMA 200** — The most-watched long-term trend line on the market. Price consistently above EMA 200 = secular uptrend. "Golden cross" (EMA 50 crossing above EMA 200) = bullish regime; "death cross" (EMA 50 crossing below EMA 200) = bearish.

**For options specifically:** EMA alignment helps determine directional bias before selecting a strategy. Selling calls on a stock below EMA 200 reduces assignment risk.

**Implementation:** Already in `chartUtils.ts` → `calcEMA(prices, period)`.

---

### RSI — Relative Strength Index

**Why 70/30 thresholds matter:** A reading above 70 doesn't mean sell — in strong uptrends RSI can stay overbought for weeks. The more powerful signal is **divergence**: price makes a new high but RSI makes a lower high, meaning momentum is fading before price reverses.

**For options:** RSI above 70 heading into earnings = elevated premium, favor credit spreads. RSI below 30 after a selloff = potential bounce trade for long calls.

**Implementation:** Already in `chartUtils.ts` → `calcRSI(prices, period)`.

---

### MACD — Moving Average Convergence/Divergence

**Three components:**
1. **MACD line** (12 EMA − 26 EMA): positive = short-term momentum above long-term = bullish
2. **Signal line** (9 EMA of MACD): crossover above MACD = buy signal
3. **Histogram**: bars show distance between MACD and Signal. Histogram flipping from negative to positive is often the earliest indicator of a momentum shift.

**For options:** MACD crossover on daily chart confirms direction before entering a debit spread. Histogram divergence is useful for timing exits.

---

### Bollinger Bands

**Volatility squeeze:** When the bands narrow significantly (low volatility period), a large move is typically imminent — but direction is unknown. A close above the upper band after a squeeze often signals breakout continuation. A close inside the band after touching the upper band = mean reversion signal.

**For options — critical connection to IV:** Bollinger Bands use historical price volatility (HV). Comparing HV to current Implied Volatility (IV) reveals whether options are expensive or cheap. If BB are narrow (HV low) but IV rank is high, it means the options market is pricing in a move the price action hasn't shown yet — often before earnings.

**Implementation:** Already in `chartUtils.ts` → `calcBollingerBands(prices, period, stdDevMultiplier)`.

---

### VWAP — Volume Weighted Average Price

**Why it resets daily:** VWAP is purely an intraday measure. It represents the average transaction price weighted by volume — the "fair price" most people paid that day. Institutions and algorithms use VWAP as an execution benchmark, which is why price gravitates to it during the session.

**Note for this app:** VWAP requires intraday OHLCV data. With daily closes only, it cannot be calculated. It's relevant once an intraday data endpoint is added.

---

### ATR — Average True Range

**Why it's different from standard deviation:** ATR uses the true range — the largest of (High−Low), (High−PrevClose), (Low−PrevClose). This accounts for gaps, which standard deviation misses. ATR gives you an absolute dollar amount: "this stock typically moves ±$3.50/day."

**For options:** ATR directly informs position sizing and stop placement. Comparing ATR to option premium is a quick sanity check — if a contract's premium is less than one ATR, the stock can easily move through the strike in a single session.

---

## Priority Recommendation

Ranked by impact per implementation complexity:

| Priority | Indicator | Rationale |
|---|---|---|
| 1 | **Volume bars** | Single additional SVG bar series. Confirms every single price candle. Free signal quality filter. |
| 2 | **EMA 20 + EMA 50** | Two overlay lines, already calculated. Immediate trend context for every chart view. |
| 3 | **RSI (14)** | Requires a sub-chart panel (0–100 scale). High signal-to-noise; universally understood by retail traders. |
| 4 | **EMA 200** | The most important support/resistance line in equities. One additional overlay line. |
| 5 | **Bollinger Bands** | Three overlay lines. Critical for options traders evaluating IV vs HV. |
| 6 | **MACD** | Requires sub-chart panel. Best momentum confirmation tool once RSI panel exists. |
| 7 | **ATR display** | Single number shown as a stat (e.g. "14-day ATR: $4.20"). No chart required. Useful for options premium context. |
| 8 | **Fibonacci levels** | Manual input or automatic swing detection needed. High visual noise but traders do watch these levels. |

---

## Implementation Notes for the Chart

The `chartUtils.ts` file already contains `calcEMA`, `calcSMA`, `calcRSI`, and `calcBollingerBands`. Adding any of the price-scale overlays (EMA, Bollinger Bands) to the chart requires:

1. Call the utility function on the filtered price array in `SummaryTab.tsx`
2. Create an `IndicatorLine` object with the calculated values and a color
3. Pass it in the `indicators` array to `<PriceChart>`

RSI, MACD, and Volume bars require a secondary chart panel below the main chart (`<PriceChart>`) and are planned for the expanded chart view.

See `docs/chart-implementation.md` for the full integration walkthrough.

# PriceChart — how it works

> **Two charts live in this folder.** `PriceChart.tsx` (this doc) is the
> minimal in-sheet sparkline: line + gradient, no axes. `AdvancedPriceChart.tsx`
> is the full-screen day-trading chart used by `PriceChartFullScreen.tsx`:
> candlesticks (line fallback/toggle), y-axis price gridlines + labels,
> x-axis time labels, a volume pane, a live last-price tag, a shaded ORB
> band (1D only), and a crosshair that labels both axes and reports full
> OHLC via `onScrub`. It shares this file's scale/gesture approach but
> draws its crosshair from snapped React state instead of Reanimated shared
> values — the crosshair snaps to whole bar indices anyway, so per-frame
> UI-thread animation buys nothing there. Candles require the backend
> history payload's `opens`/`highs`/`lows` arrays (added in
> `api/services/yfinance/yfinance_service.py::get_historical_prices`);
> when a payload only has closes, it silently degrades to line mode.

`PriceChart.tsx` is a hand-built line chart: no charting library, just
`react-native-svg` for drawing, `react-native-gesture-handler` for detecting
the press-and-hold, and `react-native-reanimated` for moving the touch
marker at 60fps without re-rendering React on every frame.

This doc walks through the four pieces: **layout**, **path/gradient/grid
drawing**, **the scrub gesture**, and **how the marker actually moves**.

---

## 1. Layout: turning data into pixels

The component doesn't know its own width until React Native lays it out, so
it starts at `width = 0` and measures itself:

```tsx
const [width, setWidth] = useState(0);
const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);
...
<View onLayout={onLayout} style={{ height, width: '100%' }}>
```

`height` is a fixed prop (default `200`). Once `width` is known, every data
point gets an (x, y) pixel position:

```ts
const xForIndex = (i: number) => (i / (prices.length - 1)) * width;
const yForPrice  = (p: number) => height - ((p - paddedMin) / (paddedMax - paddedMin)) * height;
```

- `xForIndex` spreads N points evenly across the full width — index 0 is
  x=0, the last index is x=width. This means each timeframe (1D's 78 points
  vs 5Y's 130 points) always fills the same horizontal space; only the
  spacing between points differs.
- `yForPrice` flips the y-axis (SVG y grows downward, so the highest price
  maps to the *smallest* y) and normalizes into `[0, height]`.
- `paddedMin`/`paddedMax` are the data's min/max price **expanded by 8%** in
  both directions. Without this, the highest point of the day would sit
  exactly on the top pixel edge and get visually clipped by the stroke
  width — the padding gives it breathing room, matching the reference
  screenshot where the line never touches the card edges.

All of this lives inside one `useMemo` keyed on `[hasData, prices, width, height]`,
so it only recomputes when the underlying series or the measured width
actually changes — not on every render (e.g. not while the scrub marker is
moving, which is driven separately, see §3).

---

## 2. Drawing: path, gradient fill, dotted grid

**The line** is built as a single SVG path string, one `L` (line-to) command
per point:

```ts
let linePath = '';
prices.forEach((p, i) => {
  const x = xForIndex(i);
  const y = yForPrice(p);
  linePath += i === 0 ? `M${x},${y}` : ` L${x},${y}`;
});
```

This is deliberately **straight segments, not a bezier curve**. The
reference screenshot's line is visibly jagged — real intraday ticks, not a
smoothed curve — so matching it meant *not* rounding the corners, which also
happens to be simpler than curve-fitting.

**The gradient fill** reuses the same path, just closed into a shape that
drops down to the bottom of the chart:

```ts
const area = `${linePath} L${width},${height} L0,${height} Z`;
```

That closed shape is filled with a `<LinearGradient>` (defined once in
`<Defs>`) that goes from the line's color at 35% opacity at the top to fully
transparent at the bottom — the soft color wash under the line in the
screenshot.

**Color**: the whole chart is one color, chosen once from the *current*
(non-scrubbing) price direction:

```ts
const lineColor = positive ? colors.success : colors.error;
```

`colors` comes from `useThemeColors()` (the app's theme, `styles/index.ts`)
rather than a hardcoded hex, so the chart is correct in both light and dark
mode automatically. Note: the reference screenshot's active-timeframe pill
is blue, but this app's design system is monochrome (black-on-white /
white-on-black, see `styles/index.ts`'s `accent`/`accentForeground`) — the
timeframe pills use `colors.accent` instead of introducing a one-off blue,
to stay consistent with the rest of the app.

**The dotted background grid** is just a loop of small `<Circle r={1}>`
elements on a `DOT_GRID_COLS × DOT_GRID_ROWS` (14×7) grid, drawn *before*
the gradient/line so they sit behind it:

```tsx
{Array.from({ length: DOT_GRID_ROWS }).map((_, row) =>
  Array.from({ length: DOT_GRID_COLS }).map((_, col) => (
    <Circle cx={((col + 0.5) / DOT_GRID_COLS) * width} cy={((row + 0.5) / DOT_GRID_ROWS) * height} r={1} .../>
  )))}
```

This is a static grid (doesn't depend on the data), so it's cheap even
though it's ~100 SVG nodes.

---

## 3. The scrub gesture: press-and-hold, then drag

The interaction spec was: *press and hold within the chart to reveal a
price point, then drag along the line to scan through the range.*

That maps directly onto `react-native-gesture-handler`'s `Pan` gesture with
one modifier:

```ts
Gesture.Pan()
  .activateAfterLongPress(150)
  .onBegin(...)
  .onUpdate(...)
  .onFinalize(...)
```

`.activateAfterLongPress(150)` is the whole trick: the gesture doesn't
"claim" the touch until the finger has been down for 150ms. Before that
threshold, a quick swipe on the chart still scrolls the sheet normally
(since a plain `Gesture.Pan()` with no threshold would otherwise fight the
sheet's own scroll for every touch that starts on the chart). After 150ms,
it activates and takes over — matching "press and hold", not "swipe".

**Snapping touch position to a data point** happens in a small worklet
function:

```ts
const indexFromX = (x: number, count: number, chartWidth: number) => {
  'worklet';
  const clamped = Math.max(0, Math.min(x, chartWidth));
  return Math.round((clamped / chartWidth) * (count - 1));
};
```

`'worklet'` tells Reanimated's Babel plugin to compile this function so it
can run **on the UI thread**, not the JS thread — this is what makes the
marker track your finger with zero lag, instead of waiting on a JS
round-trip per touch event. It's the inverse of `xForIndex` from §1: given a
pixel x, find the nearest index by proportion, then round to an integer.

`onBegin`/`onUpdate` both call this and write the result into a shared
value:

```ts
const touchIndex = useSharedValue(-1); // -1 = "not scrubbing"
...
.onUpdate((e) => {
  'worklet';
  const next = indexFromX(e.x, prices.length, width);
  if (next !== touchIndex.value) {
    touchIndex.value = next;
    runOnJS(notifyScrub)(next);
  }
})
```

`touchIndex` living in a **shared value** (not React state) is the reason
this doesn't cause a React re-render on every pixel of movement — Reanimated
mutates it directly on the UI thread, and only the SVG marker (§4) is wired
up to react to it.

`runOnJS(notifyScrub)(next)` is the one bridge back to JS: it's how the
scrubbed price actually gets to the rest of the app (the header price/%
swap). `notifyScrub` is a plain JS callback:

```ts
const notifyScrub = useCallback((index: number) => {
  if (index === -1 || !data) { onScrub?.(null); return; }
  onScrub?.({ price: data.prices[index], date: data.dates[index], index });
}, [data, onScrub]);
```

`TickerDetailSheet` passes an `onScrub` that swaps the big price/change text
to the scrubbed value, and reverts it when `onScrub(null)` fires — which
happens in `.onFinalize()`, i.e. on release.

A light haptic (`Haptics.impactAsync(Light)`) fires once in `.onBegin`, so
the moment the long-press activates has a physical tick, same as
Robinhood/Cash App's scrub start.

---

## 4. Making the marker actually move

The dashed vertical line and the dot are regular `react-native-svg`
elements (`Line`, `Circle`), but wrapped once via
`Animated.createAnimatedComponent` so they can take **animated props**
instead of plain props:

```ts
const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const AnimatedLine = Animated.createAnimatedComponent(Line);
```

Their position is computed from `touchIndex` via `useDerivedValue` — a
Reanimated primitive that recomputes automatically, on the UI thread,
whenever a shared value it reads (`touchIndex`) changes:

```ts
const markerX = useDerivedValue(() => {
  if (touchIndex.value === -1 || prices.length < 2) return 0;
  return (touchIndex.value / (prices.length - 1)) * width;
}, [prices.length, width]);

const markerY = useDerivedValue(() => {
  if (touchIndex.value === -1 || prices.length < 2 || maxPrice === minPrice) return 0;
  const p = prices[touchIndex.value] ?? 0;
  return height - ((p - minPrice) / (maxPrice - minPrice)) * height;
}, [prices, minPrice, maxPrice, height]);
```

These are the exact same `xForIndex`/`yForPrice` formulas from §1, just
re-expressed as worklets reading `touchIndex.value` instead of a loop
index — so the marker always lands exactly on the line, never off of it.

Finally, `useAnimatedProps` feeds those derived values into the actual SVG
elements every frame, and doubles as the fade-in/out (`opacity`) when
scrubbing starts/stops:

```ts
const circleProps = useAnimatedProps(() => ({
  cx: markerX.value,
  cy: markerY.value,
  opacity: touchIndex.value === -1 ? 0 : 1,
}));

const lineProps = useAnimatedProps(() => ({
  x1: markerX.value,
  x2: markerX.value,
  opacity: touchIndex.value === -1 ? 0 : 1,
}));
```

```tsx
<AnimatedLine animatedProps={lineProps} y1={0} y2={height} strokeDasharray="4,4" .../>
<AnimatedCircle animatedProps={circleProps} r={5} fill={lineColor} .../>
```

None of this touches React state or triggers a re-render — from the moment
`.onBegin` fires to `.onFinalize`, the only React-level update is the header
price text (via the `onScrub` → `runOnJS` bridge in §3), while the marker
itself is pure UI-thread animation.

---

## Data flow summary

```
useTickerHistoryQuery(ticker, period)   →  { dates, prices, volumes }
        │
        ▼
PriceChart  ──(pan gesture, UI thread)──►  touchIndex (shared value)
   │                                              │
   │ useMemo: path / areaPath / min / max         │ useDerivedValue: markerX / markerY
   ▼                                              ▼
static <Path> (line + gradient fill)     <AnimatedCircle>/<AnimatedLine> (marker)
   │
   └── runOnJS(notifyScrub) ──► onScrub(point | null) ──► TickerDetailSheet swaps header price
```

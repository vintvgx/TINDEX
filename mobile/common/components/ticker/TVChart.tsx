/**
 * TVChart — TradingView lightweight-charts (v5) rendered inside a WebView.
 *
 * This is the spike replacement for the hand-rolled SVG AdvancedPriceChart:
 * TradingView's own open-source chart engine gives us kinetic pan/zoom,
 * crosshair, and canvas rendering for free, instead of reimplementing each
 * TradingView behavior by hand.
 *
 * Architecture:
 *  - mobile/assets/tvchart.html (built by scripts/build-tvchart-html.js)
 *    inlines the lightweight-charts standalone bundle + the chart bootstrap
 *    (scripts/tvchart-bootstrap.js), so the chart works fully offline.
 *  - S/R zone bands are drawn with the v5 PANE PRIMITIVES API (the
 *    documented tool for price-pinned decorations — not custom series).
 *  - Zone score pills are a DOM overlay inside the primitive layer: real
 *    HTML, so they're tappable (canvas can't do that). Taps postMessage
 *    back and the parent opens ZoneDetailSheet.
 *  - ORB/ORH/ORL + watch-zone edges are built-in price lines — one layout
 *    authority for axis labels, so the legacy "band % drawn over ORH"
 *    overlap can't happen.
 *
 * Not in the spike (see parent): infinite pan-back history loading (needs
 * a cursor-paginated history endpoint), watch-zone drag-to-edit, live
 * price streaming into the last bar.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, ActivityIndicator, StyleSheet, AppState } from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import { useThemeColors } from '@/lib/useColorScheme';
import { useWatchZonesVisibility } from '@/hooks/useWatchZonesVisibility';
import { TVCHART_HTML } from './tvchart-html.generated';
import type { TickerHistoryData } from '@/common/types/blogPosts/ticker';
import {
  ChartAutoZone,
  ChartWatchZone,
  ChartReferenceLine,
  INVESTMENT_ZONE_COLOR,
} from './AdvancedPriceChart';
import { AUTO_ZONE_RESISTANCE_COLOR, AUTO_ZONE_SUPPORT_COLOR } from './autoZoneColors';

// ── Bridge protocol ──────────────────────────────────────────────────
interface TVCandle { t: number; o: number; h: number; l: number; c: number; v: number }
export interface TVEmaOverlay { period: number; color: string; visible: boolean }
interface TVZoneBand {
  id: string; low: number; high: number; color: string; opacity: number; edgeOpacity: number; dashed: boolean;
  score?: number;
  /** Auto zones only — picks the pill's trend arrow. */
  kind?: 'resistance' | 'support';
  /** Band starts at this bar (unix s) instead of the left edge — ORB. */
  startTime?: number;
  /** Band ends at this bar instead of the right edge — ORB. */
  endTime?: number;
  /** Edge line color when it differs from the fill (ORB: teal fill, grey edges). */
  edgeColor?: string;
  /** Dashed line through the middle of the band (ORB midpoint). */
  midline?: boolean;
}
interface TVRefLine {
  price: number; color: string; title: string; dashed: boolean;
  lineWidth?: 1 | 2;
  /** false = axis label only (the band primitive already draws the line). */
  lineVisible?: boolean;
  /** Overrides `dashed` — legacy '2,3'-style dashes render as dots. */
  dotted?: boolean;
  /** Fold this price into the autoscaled y-range (like the legacy chart
   *  does for every reference line) so e.g. an EMA is never off-screen. */
  fitInScale?: boolean;
  /** Draw `title` as small plain text above the line instead of the
   *  built-in filled title box (technicals lines). */
  textLabel?: boolean;
  axisLabelVisible?: boolean;
}
interface TVTheme {
  background: string; text: string; textSecondary: string; grid: string;
  separator: string; crosshair: string; up: string; down: string;
}
type WVOutbound =
  | { type: 'init'; theme: TVTheme }
  | { type: 'setData'; candles: TVCandle[]; ohlc: boolean; fit: boolean; preserve?: boolean; visibleFrom?: number }
  /** Live-tick path: update the last bar and/or append one — no full reload. */
  | { type: 'updateBars'; bars: TVCandle[] }
  | { type: 'setZones'; auto: TVZoneBand[]; watch: TVZoneBand[]; bands: TVZoneBand[] }
  | { type: 'setRefLines'; lines: TVRefLine[] }
  | { type: 'setEmaOverlays'; emas: TVEmaOverlay[] }
  | { type: 'setVwap'; visible: boolean }
  | { type: 'setHistoryExhausted'; exhausted: boolean }
  | { type: 'setOptions'; crosshair: boolean }
  | { type: 'setCountdown'; barSeconds: number | null }
  | { type: 'applyTheme'; theme: TVTheme };
type WVInbound =
  | { type: 'loaded' }
  | { type: 'ready' }
  | { type: 'requestMoreHistory' }
  /** The page's ⊕ (shown after a long-press) was tapped at this price. */
  | { type: 'addAlert'; price: number }
  | { type: 'zone-tap'; id: string; kind: 'auto' | 'watch' }
  | { type: 'log'; message: string }
  | { type: 'error'; message: string };

export interface TVChartProps {
  data?: TickerHistoryData | null;
  isLoading?: boolean;
  autoZones?: ChartAutoZone[] | null;
  watchZones?: ChartWatchZone[] | null;
  orbRange?: { high: number; low: number } | null;
  showOrbRange?: boolean;
  sessionReferenceLines?: ChartReferenceLine[] | null;
  /** Technicals overlays from useChartSettings — VWAP, daily EMA-20/50,
   *  options walls. Already filtered by their own toggles. */
  referenceLines?: ChartReferenceLine[] | null;
  /** The "Pre / post-market lines" setting — sessionReferenceLines are
   *  hidden unless this is on (same as AdvancedPriceChart). */
  showSessionLines?: boolean;
  livePrice?: number | null;
  onAutoZoneTap?: (zone: ChartAutoZone) => void;
  onWatchZoneTap?: (zone: ChartWatchZone) => void;
  /** Changing identity (ticker/period) refits the viewport. */
  resetKey?: string;
  /** Timeframe EMA overlays — computed in-page from the loaded bars. */
  emas?: TVEmaOverlay[] | null;
  /** Chart style setting, already resolved to the period's default when
   *  unset. 'line' draws a close line even when OHLC data exists. */
  mode?: 'candle' | 'line';
  /** "Data points" setting — off hides the press-and-hold crosshair. */
  crosshair?: boolean;
  /** Initial viewport width in seconds (the date range is only the initial
   *  viewport now that history lazy-loads). Applied on fit. */
  visibleSeconds?: number;
  /** Fired when the user pans near the oldest loaded bar — backfill more. */
  onRequestMoreHistory?: () => void;
  /** No older history exists — stop asking the page to request it. */
  historyExhausted?: boolean;
  /** Long-press (press-and-hold) on the chart resolved to this price —
   *  the caller offers a "set crossing alert here" action. */
  onAddAlertAtPrice?: (price: number) => void;
  style?: any;
}

// Auto zones stay deliberately quiet (fill 0.03-0.08, faint edges) so the
// ORB box is always the dominant shaded region on the chart.
// Legacy SVG dash pattern ('2,3', '5,3', …) → price-line style: a short
// first segment reads as dots, anything else as dashes; no pattern = dashed
// (AdvancedPriceChart's default is '4,4').
const refLineStyle = (dash?: string) => {
  const seg = dash ? parseFloat(dash) : NaN;
  return { dashed: true, dotted: isFinite(seg) && seg <= 2 };
};

const zoneOpacityForScore = (score: number) =>
  0.03 + (Math.max(0, Math.min(100, score)) / 100) * 0.05;

// TradingView's own default palette — candles, volume, ORB box.
const TV_UP = '#089981';
const TV_DOWN = '#F23645';
const TV_ORB_EDGE = '#B2B5BE';

/** Bar length per history interval — drives live-candle bucketing. */
const INTERVAL_SECONDS: Record<string, number> = { '1m': 60, '5m': 300, '15m': 900, '30m': 1800, '1h': 3600 };
const SESSION_OPEN_MIN = 9 * 60 + 30;
const SESSION_CLOSE_MIN = 16 * 60;

/** ET calendar date + minute-of-day + second-of-day for a unix time.
 *  Cached: the ORB scan runs over every bar on each live tick, and
 *  toLocaleString is far too slow to call thousands of times a second. */
const etCache = new Map<number, { date: string; mins: number; secs: number; weekday: string }>();
function etParts(t: number) {
  const hit = etCache.get(t);
  if (hit) return hit;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, weekday: 'short',
  }).formatToParts(new Date(t * 1000));
  const get = (k: string) => parts.find(p => p.type === k)?.value ?? '';
  const hh = Number(get('hour')) % 24;
  const mm = Number(get('minute'));
  const ss = Number(get('second'));
  const v = {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    mins: hh * 60 + mm,
    secs: hh * 3600 + mm * 60 + ss,
    weekday: get('weekday'),
  };
  if (etCache.size > 50_000) etCache.clear();
  etCache.set(t, v);
  return v;
}

export function TVChart({
  data, isLoading, autoZones, watchZones, orbRange, showOrbRange,
  sessionReferenceLines, referenceLines, showSessionLines, onAutoZoneTap, onWatchZoneTap, resetKey, emas, mode, crosshair = true, style,
  visibleSeconds, onRequestMoreHistory, historyExhausted, onAddAlertAtPrice, livePrice,
}: TVChartProps) {
  const colors = useThemeColors();
  const { visible: showWatchZones } = useWatchZonesVisibility();
  const webViewRef = useRef<WebView>(null);
  const readyRef = useRef(false);
  const queueRef = useRef<WVOutbound[]>([]);
  const [htmlReady, setHtmlReady] = useState(false);
  const [chartReady, setChartReady] = useState(false);
  // Bumped on every page (re)load so the handshake watchdog re-arms.
  const [reloadNonce, setReloadNonce] = useState(0);
  const watchdogReloads = useRef(0);
  const [pageError, setPageError] = useState<string | null>(null);
  const prevResetKey = useRef<string | undefined>(undefined);
  // Long-press price from the page — shows the "set alert here" pill until
  // tapped, dismissed, or replaced by a newer long-press.
  const onAddAlertRef = useRef(onAddAlertAtPrice);
  onAddAlertRef.current = onAddAlertAtPrice;

  // The chart HTML is bundled as a TS string (generated by
  // scripts/build-tvchart-html.js) — no expo-asset, no file:// URLs, no
  // native modules beyond the already-installed webview.
  useEffect(() => {
    console.log('[TVChart] bundled html length:', TVCHART_HTML.length);
    setHtmlReady(true);
  }, []);

  const theme: TVTheme = useMemo(() => ({
    background: colors.background,
    text: colors.text,
    textSecondary: colors.textSecondary,
    grid: colors.separator,
    separator: colors.separator,
    crosshair: colors.textTertiary,
    up: TV_UP,
    down: TV_DOWN,
  }), [colors]);

  // Overlay messages (zones, lines, EMAs, theme…) are re-derived on every
  // live tick; skip ones identical to the last of their type so the page
  // isn't rebuilding price lines every second. Bar data is never deduped.
  const lastSentJson = useRef<Record<string, string>>({});
  const send = useCallback((msg: WVOutbound) => {
    if (msg.type !== 'setData' && msg.type !== 'updateBars' && msg.type !== 'init') {
      const json = JSON.stringify(msg);
      if (lastSentJson.current[msg.type] === json) return;
      lastSentJson.current[msg.type] = json;
    }
    if (!readyRef.current || !webViewRef.current) {
      // Queue until the page script has loaded; flushed after init.
      queueRef.current.push(msg);
      return;
    }
    webViewRef.current.postMessage(JSON.stringify(msg));
  }, []);

  const flush = useCallback(() => {
    const q = queueRef.current;
    queueRef.current = [];
    for (const m of q) webViewRef.current?.postMessage(JSON.stringify(m));
  }, []);

  // ── Data ───────────────────────────────────────────────────────────
  const baseCandles: TVCandle[] | null = useMemo(() => {
    if (!data?.dates?.length || !data.prices?.length) return null;
    const n = Math.min(data.dates.length, data.prices.length);
    const hasOhlc = !!data.opens && !!data.highs && !!data.lows;
    const out: TVCandle[] = [];
    for (let i = 0; i < n; i++) {
      const t = Math.floor(new Date(data.dates[i]).getTime() / 1000);
      if (!isFinite(t)) continue;
      const c = data.prices[i];
      out.push({
        t,
        o: hasOhlc ? data.opens![i] : c,
        h: hasOhlc ? data.highs![i] : c,
        l: hasOhlc ? data.lows![i] : c,
        c,
        v: data.volumes?.[i] ?? 0,
      });
    }
    return out;
  }, [data]);

  // ── Live candle ────────────────────────────────────────────────────
  // Streamed price ticks build the forming bar between history polls, like
  // TradingView: a tick inside the latest bar's interval moves its close
  // (stretching high/low); a tick past it opens a new bar. Regular session
  // only (09:30-16:00 ET, weekdays) — the candles are regular-session bars,
  // so pre/post-market ticks would distort them. Daily bars take ticks into
  // today's bar once the poll/history has it.
  const barSec = data?.interval ? INTERVAL_SECONDS[data.interval] : undefined;
  const isDailyBars = data?.interval === '1d';
  // The forming bar is tied to the series it was seeded from (key +
  // interval). Before, a bar seeded from the previous ticker's last candle
  // survived the switch — the new ticker's history then landed on the same
  // time bucket and inherited its high/low (IWM's candle reaching SPY's
  // $774), blowing out the price scale.
  const liveKey = `${resetKey ?? ''}|${data?.interval ?? ''}`;
  const [liveBar, setLiveBar] = useState<(TVCandle & { k: string }) | null>(null);
  useEffect(() => {
    if (livePrice == null || !isFinite(livePrice) || livePrice <= 0 || !baseCandles?.length) return;
    if (!barSec && !isDailyBars) return;
    const now = Math.floor(Date.now() / 1000);
    const et = etParts(now);
    if (et.weekday === 'Sat' || et.weekday === 'Sun') return;
    if (et.mins < SESSION_OPEN_MIN || et.mins >= SESSION_CLOSE_MIN) return;
    const baseLast = baseCandles[baseCandles.length - 1];
    let bucket: number;
    if (barSec) {
      const sinceOpen = et.secs - SESSION_OPEN_MIN * 60;
      bucket = now - (sinceOpen % barSec);
    } else {
      // Daily: only extend today's bar, never invent one.
      if (etParts(baseLast.t).date !== et.date) return;
      bucket = baseLast.t;
    }
    const p = livePrice;
    const k = liveKey;
    setLiveBar(prev => {
      if (bucket < baseLast.t) return null; // history already past this bar
      if (prev && prev.k === k && prev.t === bucket) {
        return { ...prev, h: Math.max(prev.h, p), l: Math.min(prev.l, p), c: p };
      }
      if (bucket === baseLast.t) {
        return { ...baseLast, h: Math.max(baseLast.h, p), l: Math.min(baseLast.l, p), c: p, k };
      }
      return { t: bucket, o: p, h: p, l: p, c: p, v: 0, k };
    });
  }, [livePrice, baseCandles, barSec, isDailyBars, liveKey]);

  // History + the live bar: replaces the matching bar (keeping the poll's
  // volume and the wider of the two high/low) or appends a new one.
  const candles: TVCandle[] | null = useMemo(() => {
    if (!baseCandles?.length || !liveBar || liveBar.k !== liveKey) return baseCandles;
    const last = baseCandles[baseCandles.length - 1];
    if (liveBar.t < last.t) return baseCandles;
    if (liveBar.t === last.t) {
      const merged = { ...last, h: Math.max(last.h, liveBar.h), l: Math.min(last.l, liveBar.l), c: liveBar.c };
      return [...baseCandles.slice(0, -1), merged];
    }
    const { k: _k, ...bar } = liveBar;
    return [...baseCandles, bar];
  }, [baseCandles, liveBar, liveKey]);
  const ohlc = !!(data?.opens && data?.highs && data?.lows) && mode !== 'line';

  // Fit the viewport exactly once per resetKey — on the first setData that
  // carries the NEW key's own candles. A render-time
  // `prevResetKey.current !== resetKey` check is true for a single render:
  // on mount that's the render where chartReady is still false, and on a
  // period/interval change it's the render still showing the old key's
  // candles — so the fit request always died before any setData could carry
  // it. The pending flag survives until the setData effect actually sends.
  const fitPending = useRef(true);
  const candlesAtKeyChange = useRef<TVCandle[] | null>(null);
  const prevFirstT = useRef<number | null>(null);
  useEffect(() => {
    if (prevResetKey.current !== resetKey) {
      prevResetKey.current = resetKey;
      fitPending.current = true;
      candlesAtKeyChange.current = candles;
      prevFirstT.current = null;
    }
  });
  // Backfill detection: same key, first candle got older (bars were
  // prepended on the left). A live poll appends on the right instead.
  const isBackfill =
    !!candles?.length && prevFirstT.current != null && candles[0].t < prevFirstT.current;

  // The date range is only the initial viewport — frame it on fit.
  // 1D on intraday bars frames the latest bar's trading day (from its first
  // bar, premarket included) instead of a rolling 24h that starts in the
  // middle of yesterday — with a ~30-bar floor so an early-morning chart
  // isn't three stretched candles.
  const visibleFrom = useMemo(() => {
    if (!visibleSeconds || !candles?.length) return undefined;
    const last = candles[candles.length - 1];
    if (visibleSeconds <= 86_400 && barSec) {
      const day = etParts(last.t).date;
      let i = candles.length - 1;
      while (i > 0 && etParts(candles[i - 1].t).date === day) i--;
      return Math.min(candles[i].t, last.t - 30 * barSec);
    }
    return last.t - visibleSeconds;
  }, [visibleSeconds, candles, barSec]);

  // Full setData only when the history itself changed (load, poll,
  // backfill, ticker/range switch, style). A live tick that only moved the
  // last bar — or opened one new bar — goes as a tiny 'updateBars' message,
  // so the page never reloads thousands of bars per second.
  const sentRef = useRef<{ base: TVCandle[] | null; ohlc: boolean; key?: string; ready: boolean; lastT?: number }>({ base: null, ohlc: false, ready: false });
  useEffect(() => {
    if (!chartReady || !candles) return;
    const prev = sentRef.current;
    const historyChanged = !prev.ready || prev.base !== baseCandles || prev.ohlc !== ohlc || prev.key !== resetKey;
    const last = candles[candles.length - 1];
    sentRef.current = { base: baseCandles, ohlc, key: resetKey, ready: true, lastT: last.t };
    // A 30s tail poll only rewrites the forming bar and appends a few new
    // ones. Re-sending the whole series for that (~3,000 bars stringified,
    // bridged, re-set and re-rendered every 30s) was the steady-state cost
    // while watching a chart — send just the tail as an incremental update.
    const pb = prev.base;
    const tailOnly =
      historyChanged && prev.ready && !!pb?.length && !!baseCandles?.length &&
      prev.ohlc === ohlc && prev.key === resetKey &&
      baseCandles[0].t === pb[0].t &&
      baseCandles.length >= pb.length && baseCandles.length - pb.length <= 30 &&
      baseCandles[pb.length - 1].t === pb[pb.length - 1].t;
    if (tailOnly) {
      send({ type: 'updateBars', bars: candles.slice(pb!.length - 1) });
      return;
    }
    if (!historyChanged && baseCandles?.length) {
      // When a new bar just opened, finalize the one before it too (the
      // page can only update the newest bar, so it must go first).
      const opened = prev.lastT !== undefined && last.t > prev.lastT && candles.length >= 2;
      send({ type: 'updateBars', bars: opened ? [candles[candles.length - 2], last] : [last] });
      return;
    }
    // First setData carrying this key's own candles → frame it. While the
    // previous key's candles are still on screen (or on a backfill), send
    // without fit so the incoming range — not the outgoing one — gets
    // framed, and backfilled bars shift the view instead of refitting it.
    const fit = fitPending.current && candles !== candlesAtKeyChange.current;
    if (fit) fitPending.current = false;
    send({ type: 'setData', candles, ohlc, fit, preserve: !fit && isBackfill, visibleFrom: fit ? visibleFrom : undefined });
  }, [chartReady, candles, baseCandles, ohlc, isBackfill, visibleFrom, resetKey, send]);
  // A page reload re-sends everything as a full setData.
  useEffect(() => { if (!chartReady) sentRef.current = { base: null, ohlc: false, ready: false }; }, [chartReady]);

  useEffect(() => {
    if (candles?.length) prevFirstT.current = candles[0].t;
  });

  // ── Zones → primitive bands ────────────────────────────────────────
  const autoBands: TVZoneBand[] = useMemo(() => (autoZones ?? []).map(z => ({
    id: z.id, low: z.low, high: z.high, score: z.score, kind: z.type,
    color: z.type === 'resistance' ? AUTO_ZONE_RESISTANCE_COLOR : AUTO_ZONE_SUPPORT_COLOR,
    opacity: zoneOpacityForScore(z.score), edgeOpacity: 0.25, dashed: false,
  })), [autoZones]);

  const watchBands: TVZoneBand[] = useMemo(() => (showWatchZones ? watchZones ?? [] : []).map(z => {
    // Tracked prices are white (theme text) — never green/red, so they
    // can't be mistaken for the live last-price line/tag.
    const color = z.zoneType === 'investment' ? INVESTMENT_ZONE_COLOR : colors.text;
    return {
      id: z.id, low: z.low, high: z.high, color,
      opacity: 0.06, edgeOpacity: 0.9, dashed: z.status === 'watching',
    };
  }), [showWatchZones, watchZones, colors]);

  // Per-day ORB boxes (TradingView-style context): for each trading day in
  // intraday data, the 09:30–09:45 ET high/low becomes a box from the first
  // 09:45 bar to the day's last bar. Today's box prefers the backend's
  // orbRange (1-min precision) when available. On daily+ bars there's no
  // intraday data, so only today's backend box is drawn.
  const orbBands: TVZoneBand[] = useMemo(() => {
    if (!showOrbRange || !candles?.length) return [];
    const intraday = candles.length >= 2 && (candles[1].t - candles[0].t) < 86400;
    const box = (id: string, low: number, high: number, startTime: number | undefined, endTime: number | undefined): TVZoneBand => ({
      id, low, high, startTime, endTime,
      color: TV_UP, opacity: 0.18, edgeColor: TV_ORB_EDGE, edgeOpacity: 0.75,
      dashed: false, midline: true,
    });
    if (!intraday) {
      if (!orbRange) return [];
      return [box('__orb__', orbRange.low, orbRange.high, undefined, candles[candles.length - 1].t)];
    }
    const byDay = new Map<string, typeof candles>();
    for (const c of candles) {
      const { date } = etParts(c.t);
      const arr = byDay.get(date);
      if (arr) arr.push(c); else byDay.set(date, [c]);
    }
    const todayKey = etParts(candles[candles.length - 1].t).date;
    const bands: TVZoneBand[] = [];
    for (const [date, dc] of byDay) {
      let hi = -Infinity, lo = Infinity, startT: number | undefined, formStartT: number | undefined;
      for (const c of dc) {
        const { mins } = etParts(c.t);
        if (mins >= 570 && mins < 585) {
          if (c.h > hi) hi = c.h;
          if (c.l < lo) lo = c.l;
          if (formStartT === undefined) formStartT = c.t;
        }
        if (mins >= 585 && startT === undefined) startT = c.t;
      }
      if (hi === -Infinity) continue;
      if (startT === undefined) {
        // Still forming (09:30-09:45, today only): a box over the bars so
        // far that grows with every tick, like TradingView's live ORB.
        if (date === todayKey) {
          bands.push(box(`__orb__${date}`, lo, hi, formStartT, dc[dc.length - 1].t));
        }
        continue;
      }
      let high = hi, low = lo;
      if (date === todayKey && orbRange) { high = orbRange.high; low = orbRange.low; }
      bands.push(box(`__orb__${date}`, low, high, startT, dc[dc.length - 1].t));
    }
    return bands;
  }, [showOrbRange, orbRange, candles]);

  useEffect(() => {
    if (!chartReady) return;
    send({ type: 'setZones', auto: autoBands, watch: watchBands, bands: orbBands });
  }, [chartReady, autoBands, watchBands, orbBands, send]);

  // ── Reference lines (ORB edges, session lines) ─────────────────────
  const lastBarDate = candles?.length ? etParts(candles[candles.length - 1].t).date : null;
  const refLines: TVRefLine[] = useMemo(() => {
    const lines: TVRefLine[] = [];
    // ORH/ORL axis tags follow today's box (live while it forms); daily
    // bars, with no intraday box, fall back to the backend range.
    const todayBox = orbBands.length ? orbBands[orbBands.length - 1] : null;
    const orbTag = todayBox && lastBarDate && todayBox.id === `__orb__${lastBarDate}`
      ? { high: todayBox.high, low: todayBox.low }
      : orbRange;
    if (showOrbRange && orbTag) {
      // The box primitive draws the ORB lines; these are axis tags only.
      lines.push({ price: orbTag.high, color: TV_ORB_EDGE, title: 'ORH', dashed: false, lineVisible: false });
      lines.push({ price: orbTag.low, color: TV_ORB_EDGE, title: 'ORL', dashed: false, lineVisible: false });
    }
    if (showSessionLines) {
      for (const l of sessionReferenceLines ?? []) {
        lines.push({ price: l.price, color: l.color ?? colors.textSecondary, title: l.label, ...refLineStyle(l.dash) });
      }
    }
    for (const l of referenceLines ?? []) {
      // VWAP is drawn as a dynamic session series in-page (setVwap) instead
      // of the backend's straight price line — skip it here.
      if (l.label === 'VWAP') continue;
      lines.push({
        price: l.price, color: l.color ?? colors.textSecondary, title: l.label,
        ...refLineStyle(l.dash), fitInScale: true, textLabel: true,
      });
    }
    // Watch levels: price-axis tag per edge. The band primitive already
    // draws the dashed/solid line, so these are label-only.
    for (const b of watchBands) {
      lines.push({ price: b.high, color: b.color, title: '', dashed: false, lineVisible: false });
      if (b.low !== b.high) {
        lines.push({ price: b.low, color: b.color, title: '', dashed: false, lineVisible: false });
      }
    }
    return lines;
  }, [showOrbRange, orbRange, orbBands, lastBarDate, showSessionLines, sessionReferenceLines, referenceLines, watchBands, colors]);

  useEffect(() => {
    if (!chartReady) return;
    send({ type: 'setRefLines', lines: refLines });
  }, [chartReady, refLines, send]);

  // ── Dynamic session VWAP ──────────────────────────────────────────
  // The VWAP reference line (1D only, from the technicals check) becomes a
  // per-bar series in-page instead of a straight price line.
  const vwapVisible = useMemo(
    () => (referenceLines ?? []).some((l) => l.label === 'VWAP'),
    [referenceLines],
  );
  useEffect(() => {
    if (!chartReady) return;
    send({ type: 'setVwap', visible: vwapVisible });
  }, [chartReady, vwapVisible, send]);

  // ── EMA overlays ───────────────────────────────────────────────────
  useEffect(() => {
    if (!chartReady) return;
    send({ type: 'setEmaOverlays', emas: emas ?? [] });
  }, [chartReady, emas, send]);

  // ── Next-candle countdown (intraday bars only) ─────────────────────
  useEffect(() => {
    if (!chartReady) return;
    send({ type: 'setCountdown', barSeconds: barSec ?? null });
  }, [chartReady, barSec, send]);

  // ── Crosshair ("Data points") ──────────────────────────────────────
  useEffect(() => {
    if (!chartReady) return;
    send({ type: 'setOptions', crosshair });
  }, [chartReady, crosshair, send]);

  // ── Theme ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!chartReady) return;
    send({ type: 'applyTheme', theme });
  }, [chartReady, theme, send]);

  // ── Inbound ────────────────────────────────────────────────────────
  const handleMessage = useCallback((e: WebViewMessageEvent) => {
    let msg: WVInbound;
    try { msg = JSON.parse(e.nativeEvent.data); } catch { return; }
    console.log('[TVChart] ← page:', msg.type);
    if (msg.type === 'loaded') {
      // Page script is live → create the chart. The page replies `ready`.
      readyRef.current = true;
      webViewRef.current?.postMessage(JSON.stringify({ type: 'init', theme } as WVOutbound));
      flush();
    } else if (msg.type === 'ready') {
      // Also (re)opens the outbound channel: if a stray onLoadStart landed
      // after `loaded`, readyRef would be false here and every setData
      // would sit in the queue forever behind a "ready" chart.
      readyRef.current = true;
      flush();
      setChartReady(true);
      setPageError(null);
    } else if (msg.type === 'log') {
      console.log('[TVChart] page log:', msg.message);
    } else if (msg.type === 'error') {
      console.warn('[TVChart] page error:', msg.message);
      setPageError(msg.message);
    } else if (msg.type === 'requestMoreHistory') {
      onRequestMoreHistory?.();
    } else if (msg.type === 'addAlert') {
      // TradingView flow: long-press → the page pins a ⊕ on that price's
      // line → tapping it lands here and creates the alert directly (no
      // confirmation pill; the new line on the chart is the confirmation).
      if (typeof msg.price === 'number' && isFinite(msg.price)) {
        onAddAlertRef.current?.(msg.price);
      }
    } else if (msg.type === 'zone-tap') {
      if (msg.kind === 'auto') {
        const z = (autoZones ?? []).find(z => z.id === msg.id);
        if (z) onAutoZoneTap?.(z);
      } else {
        const z = (watchZones ?? []).find(z => z.id === msg.id);
        if (z) onWatchZoneTap?.(z);
      }
    }
  }, [autoZones, watchZones, onAutoZoneTap, onWatchZoneTap, onRequestMoreHistory, theme, send, flush]);

  // Handshake watchdog: if the page hasn't reported `ready` a few seconds
  // after (re)loading, or when the app returns to the foreground still not
  // ready, reload the WebView. Before this, a lost handshake left the
  // spinner up until iOS happened to recycle the WebView in the background.
  useEffect(() => {
    if (chartReady) { watchdogReloads.current = 0; return; }
    if (!htmlReady) return;
    // Capped: a WebView parked offscreen may not run JS at all — don't
    // reload it every 6s forever. Foregrounding still gets a retry.
    const t = watchdogReloads.current < 3 ? setTimeout(() => {
      watchdogReloads.current += 1;
      console.warn('[TVChart] no ready after 6s — reloading WebView');
      webViewRef.current?.reload();
    }, 6_000) : undefined;
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active') webViewRef.current?.reload();
    });
    return () => { if (t) clearTimeout(t); sub.remove(); };
  }, [chartReady, htmlReady, reloadNonce]);

  // Tell the page when there's no older history so it stops asking.
  useEffect(() => {
    if (!chartReady) return;
    send({ type: 'setHistoryExhausted', exhausted: !!historyExhausted });
  }, [chartReady, historyExhausted, send]);

  // Rebuild the HTML if it's regenerated (dev).
  return (
    <View style={[{ flex: 1 }, style]}>
      {htmlReady ? (
        <WebView
          ref={webViewRef}
          source={{ html: TVCHART_HTML, baseUrl: '' }}
          originWhitelist={['*']}
          style={[StyleSheet.absoluteFill, { backgroundColor: colors.background }]}
          javaScriptEnabled
          domStorageEnabled={false}
          scrollEnabled={false}
          bounces={false}
          // WKWebView's own long-press recognizers (text selection loupe,
          // link preview) can claim a press-and-hold and cancel the page's
          // touches before the alert long-press arms.
          textInteractionEnabled={false}
          allowsLinkPreview={false}
          showsVerticalScrollIndicator={false}
          showsHorizontalScrollIndicator={false}
          onLoadStart={() => {
            console.log('[TVChart] WebView onLoadStart');
            readyRef.current = false;
            // A reload (e.g. iOS reclaimed the WebView while backgrounded)
            // starts a blank page — dropping chartReady makes every effect
            // re-send its state once the new page reports `ready`. Re-arm
            // the fit too (with a cleared snapshot so the unchanged candles
            // still count as this key's own) so the initial viewport is
            // restored instead of the default full-range view.
            fitPending.current = true;
            candlesAtKeyChange.current = null;
            queueRef.current = [];
            lastSentJson.current = {};
            setChartReady(false);
            setReloadNonce((n) => n + 1);
          }}
          onContentProcessDidTerminate={() => webViewRef.current?.reload()}
          onLoadEnd={() => console.log('[TVChart] WebView onLoadEnd')}
          onError={(e) => console.warn('[TVChart] WebView onError', JSON.stringify(e.nativeEvent))}
          onHttpError={(e) => console.warn('[TVChart] WebView onHttpError', JSON.stringify(e.nativeEvent))}
          onMessage={handleMessage}
        />
      ) : null}
      {pageError ? (
        <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background, padding: 24 }]}>
          <Text style={{ color: colors.error, fontSize: 13, textAlign: 'center' }}>{pageError}</Text>
        </View>
      ) : (!chartReady || (isLoading && !candles?.length)) && (
        // Only when there's nothing to draw — a background reload/refetch
        // must never hide candles that are already on the chart.
        <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background }]}>
          <ActivityIndicator size="small" color={colors.textSecondary} />
        </View>
      )}
    </View>
  );
}

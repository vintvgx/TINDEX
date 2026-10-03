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
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
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
  | { type: 'setData'; candles: TVCandle[]; ohlc: boolean; fit: boolean }
  | { type: 'setZones'; auto: TVZoneBand[]; watch: TVZoneBand[]; bands: TVZoneBand[] }
  | { type: 'setRefLines'; lines: TVRefLine[] }
  | { type: 'setEmaOverlays'; emas: TVEmaOverlay[] }
  | { type: 'applyTheme'; theme: TVTheme };
type WVInbound =
  | { type: 'loaded' }
  | { type: 'ready' }
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

export function TVChart({
  data, isLoading, autoZones, watchZones, orbRange, showOrbRange,
  sessionReferenceLines, referenceLines, showSessionLines, onAutoZoneTap, onWatchZoneTap, resetKey, emas, style,
}: TVChartProps) {
  const colors = useThemeColors();
  const { visible: showWatchZones } = useWatchZonesVisibility();
  const webViewRef = useRef<WebView>(null);
  const readyRef = useRef(false);
  const queueRef = useRef<WVOutbound[]>([]);
  const [htmlReady, setHtmlReady] = useState(false);
  const [chartReady, setChartReady] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const prevResetKey = useRef<string | undefined>(undefined);

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

  const send = useCallback((msg: WVOutbound) => {
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
  const candles: TVCandle[] | null = useMemo(() => {
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
  const ohlc = !!(data?.opens && data?.highs && data?.lows);

  const fit = prevResetKey.current !== resetKey;
  useEffect(() => { prevResetKey.current = resetKey; });

  useEffect(() => {
    if (!chartReady || !candles) return;
    send({ type: 'setData', candles, ohlc, fit });
  }, [chartReady, candles, ohlc, fit, send]);

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
    const etParts = (t: number) => {
      const s = new Date(t * 1000).toLocaleString('en-US', {
        timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hour12: false,
      });
      const [date, hm] = s.split(', ');
      const [hh, mm] = hm.split(':').map(Number);
      return { date, mins: hh * 60 + mm };
    };
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
      let hi = -Infinity, lo = Infinity, startT: number | undefined;
      for (const c of dc) {
        const { mins } = etParts(c.t);
        if (mins >= 570 && mins < 585) {
          if (c.h > hi) hi = c.h;
          if (c.l < lo) lo = c.l;
        }
        if (mins >= 585 && startT === undefined) startT = c.t;
      }
      if (hi === -Infinity || startT === undefined) continue;
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
  const refLines: TVRefLine[] = useMemo(() => {
    const lines: TVRefLine[] = [];
    if (showOrbRange && orbRange) {
      // The box primitive draws the ORB lines; these are axis tags only.
      lines.push({ price: orbRange.high, color: TV_ORB_EDGE, title: 'ORH', dashed: false, lineVisible: false });
      lines.push({ price: orbRange.low, color: TV_ORB_EDGE, title: 'ORL', dashed: false, lineVisible: false });
    }
    if (showSessionLines) {
      for (const l of sessionReferenceLines ?? []) {
        lines.push({ price: l.price, color: l.color ?? colors.textSecondary, title: l.label, ...refLineStyle(l.dash) });
      }
    }
    for (const l of referenceLines ?? []) {
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
  }, [showOrbRange, orbRange, showSessionLines, sessionReferenceLines, referenceLines, watchBands, colors]);

  useEffect(() => {
    if (!chartReady) return;
    send({ type: 'setRefLines', lines: refLines });
  }, [chartReady, refLines, send]);

  // ── EMA overlays ───────────────────────────────────────────────────
  useEffect(() => {
    if (!chartReady) return;
    send({ type: 'setEmaOverlays', emas: emas ?? [] });
  }, [chartReady, emas, send]);

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
      setChartReady(true);
      setPageError(null);
    } else if (msg.type === 'log') {
      console.log('[TVChart] page log:', msg.message);
    } else if (msg.type === 'error') {
      console.warn('[TVChart] page error:', msg.message);
      setPageError(msg.message);
    } else if (msg.type === 'zone-tap') {
      if (msg.kind === 'auto') {
        const z = (autoZones ?? []).find(z => z.id === msg.id);
        if (z) onAutoZoneTap?.(z);
      } else {
        const z = (watchZones ?? []).find(z => z.id === msg.id);
        if (z) onWatchZoneTap?.(z);
      }
    }
  }, [autoZones, watchZones, onAutoZoneTap, onWatchZoneTap, theme, send, flush]);

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
          showsVerticalScrollIndicator={false}
          showsHorizontalScrollIndicator={false}
          onLoadStart={() => {
            console.log('[TVChart] WebView onLoadStart');
            readyRef.current = false;
          }}
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
      ) : (!chartReady || isLoading) && (
        <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background }]}>
          <ActivityIndicator size="small" color={colors.textSecondary} />
        </View>
      )}
    </View>
  );
}

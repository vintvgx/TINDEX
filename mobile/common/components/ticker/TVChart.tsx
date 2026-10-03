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
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import { Asset } from 'expo-asset';
import * as FileSystem from 'expo-file-system';
import { useThemeColors } from '@/lib/useColorScheme';
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
interface TVZoneBand { id: string; low: number; high: number; color: string; opacity: number; edgeOpacity: number; dashed: boolean; score?: number }
interface TVRefLine { price: number; color: string; title: string; dashed: boolean }
interface TVTheme {
  background: string; text: string; textSecondary: string; grid: string;
  separator: string; crosshair: string; up: string; down: string;
}
type WVOutbound =
  | { type: 'init'; theme: TVTheme }
  | { type: 'setData'; candles: TVCandle[]; ohlc: boolean; fit: boolean }
  | { type: 'setZones'; auto: TVZoneBand[]; watch: TVZoneBand[]; bands: TVZoneBand[] }
  | { type: 'setRefLines'; lines: TVRefLine[] }
  | { type: 'applyTheme'; theme: TVTheme };
type WVInbound =
  | { type: 'ready' }
  | { type: 'zone-tap'; id: string; kind: 'auto' | 'watch' };

export interface TVChartProps {
  data?: TickerHistoryData | null;
  isLoading?: boolean;
  autoZones?: ChartAutoZone[] | null;
  watchZones?: ChartWatchZone[] | null;
  orbRange?: { high: number; low: number } | null;
  showOrbRange?: boolean;
  sessionReferenceLines?: ChartReferenceLine[] | null;
  livePrice?: number | null;
  onAutoZoneTap?: (zone: ChartAutoZone) => void;
  onWatchZoneTap?: (zone: ChartWatchZone) => void;
  /** Changing identity (ticker/period) refits the viewport. */
  resetKey?: string;
  style?: any;
}

const zoneOpacityForScore = (score: number) =>
  0.05 + (Math.max(0, Math.min(100, score)) / 100) * 0.17;

export function TVChart({
  data, isLoading, autoZones, watchZones, orbRange, showOrbRange,
  sessionReferenceLines, onAutoZoneTap, onWatchZoneTap, resetKey, style,
}: TVChartProps) {
  const colors = useThemeColors();
  const webViewRef = useRef<WebView>(null);
  const readyRef = useRef(false);
  const queueRef = useRef<WVOutbound[]>([]);
  const [html, setHtml] = useState<string | null>(null);
  const [chartReady, setChartReady] = useState(false);
  const prevResetKey = useRef<string | undefined>(undefined);

  // Load the bundled chart HTML via expo-asset, then read it into a string.
  // source={{ html }} (not a file:// URI) is what reliably renders local
  // HTML on iOS — file:// URLs hit "Unable to open URL" in the WebView.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        // Relative require — Metro bundles .html via the default assetExts.
        const asset = Asset.fromModule(require('../../../assets/tvchart.html'));
        await asset.downloadAsync();
        const uri = asset.localUri ?? asset.uri;
        const htmlString = await FileSystem.readAsStringAsync(uri);
        if (alive) setHtml(htmlString);
      } catch (e) {
        console.warn('[TVChart] failed to load tvchart.html asset', e);
      }
    })();
    return () => { alive = false; };
  }, []);

  const theme: TVTheme = useMemo(() => ({
    background: colors.background,
    text: colors.text,
    textSecondary: colors.textSecondary,
    grid: colors.separator,
    separator: colors.separator,
    crosshair: colors.textTertiary,
    up: colors.success,
    down: colors.error,
  }), [colors]);

  const send = useCallback((msg: WVOutbound) => {
    if (!readyRef.current || !webViewRef.current) {
      // init is always first; everything else queues behind ready.
      if (msg.type !== 'init') queueRef.current.push(msg);
      else queueRef.current.unshift(msg);
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
    id: z.id, low: z.low, high: z.high, score: z.score,
    color: z.type === 'resistance' ? AUTO_ZONE_RESISTANCE_COLOR : AUTO_ZONE_SUPPORT_COLOR,
    opacity: zoneOpacityForScore(z.score), edgeOpacity: 0.5, dashed: false,
  })), [autoZones]);

  const watchBands: TVZoneBand[] = useMemo(() => (watchZones ?? []).map(z => {
    const color = z.zoneType === 'investment' ? INVESTMENT_ZONE_COLOR
      : z.direction === 'either' ? colors.accent
      : z.direction === 'bullish' ? colors.success : colors.error;
    return {
      id: z.id, low: z.low, high: z.high, color,
      opacity: 0.08, edgeOpacity: 0.85, dashed: z.status === 'watching',
    };
  }), [watchZones, colors]);

  const orbBands: TVZoneBand[] = useMemo(() => {
    if (!showOrbRange || !orbRange) return [];
    return [{
      id: '__orb__', low: orbRange.low, high: orbRange.high,
      color: colors.textTertiary, opacity: 0.05, edgeOpacity: 0.4, dashed: false,
    }];
  }, [showOrbRange, orbRange, colors]);

  useEffect(() => {
    if (!chartReady) return;
    send({ type: 'setZones', auto: autoBands, watch: watchBands, bands: orbBands });
  }, [chartReady, autoBands, watchBands, orbBands, send]);

  // ── Reference lines (ORB edges, session lines) ─────────────────────
  const refLines: TVRefLine[] = useMemo(() => {
    const lines: TVRefLine[] = [];
    if (showOrbRange && orbRange) {
      lines.push({ price: orbRange.high, color: colors.textSecondary, title: 'ORH', dashed: false });
      lines.push({ price: orbRange.low, color: colors.textSecondary, title: 'ORL', dashed: false });
    }
    for (const l of sessionReferenceLines ?? []) {
      lines.push({ price: l.price, color: l.color ?? colors.textSecondary, title: l.label, dashed: true });
    }
    return lines;
  }, [showOrbRange, orbRange, sessionReferenceLines, colors]);

  useEffect(() => {
    if (!chartReady) return;
    send({ type: 'setRefLines', lines: refLines });
  }, [chartReady, refLines, send]);

  // ── Theme ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!chartReady) return;
    send({ type: 'applyTheme', theme });
  }, [chartReady, theme, send]);

  // ── Inbound ────────────────────────────────────────────────────────
  const handleMessage = useCallback((e: WebViewMessageEvent) => {
    let msg: WVInbound;
    try { msg = JSON.parse(e.nativeEvent.data); } catch { return; }
    if (msg.type === 'ready') {
      readyRef.current = true;
      setChartReady(true);
      send({ type: 'init', theme });
      flush();
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
      {html ? (
        <WebView
          ref={webViewRef}
          source={{ html, baseUrl: '' }}
          originWhitelist={['*']}
          style={[StyleSheet.absoluteFill, { backgroundColor: colors.background }]}
          javaScriptEnabled
          domStorageEnabled={false}
          scrollEnabled={false}
          bounces={false}
          showsVerticalScrollIndicator={false}
          showsHorizontalScrollIndicator={false}
          onMessage={handleMessage}
          onError={(e) => console.warn('[TVChart] WebView error', e.nativeEvent)}
        />
      ) : null}
      {(!chartReady || isLoading) && (
        <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background }]}>
          <ActivityIndicator size="small" color={colors.textSecondary} />
        </View>
      )}
    </View>
  );
}

import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useQueryClient } from '@tanstack/react-query';
import { TickerLogo } from '@/common/components/ui/TickerLogo';
import { INTERVAL_LABEL } from '@/lib/chartIntervals';
import { PERIOD_STOPS } from './TimeframeChips';
import { PressableStyled } from './PressableStyled';
import type { PricePeriod, TickerResponse } from '@/common/types/blogPosts/ticker';
import type { WatchlistResponse } from '@/common/types/watchlist';

interface TickerQuote {
  logoUrl?: string;
  changePct: number | null;
}

/**
 * Day % and logo per ticker, read from data the app ALREADY has cached — no
 * new requests, no polling:
 *  1. the `['ticker', symbol, userId]` cache (useTickerQuery — every ticker
 *     opened in the chart this session): `price_change_percent`, `logo_url`;
 *  2. else the movers watchlists cache (`['watchlist']`, useWatchlists — fed
 *     by the ticker tape): `change_percent`.
 * A ticker in neither gets no % line (and the logo's letter fallback).
 * Read once per open — the sheet mounts fresh each time it opens.
 */
function useCachedQuotes(tickers: string[]): Record<string, TickerQuote> {
  const qc = useQueryClient();
  return useMemo(() => {
    const out: Record<string, TickerQuote> = {};
    const watch = qc.getQueryData<WatchlistResponse>(['watchlist']);
    const movers = new Map<string, number>();
    for (const list of Object.values(watch?.watchlists ?? {})) {
      for (const st of list?.data ?? []) {
        if (st?.ticker && st.change_percent != null && !movers.has(st.ticker)) movers.set(st.ticker, st.change_percent);
      }
    }
    for (const t of tickers) {
      let logoUrl: string | undefined;
      let changePct: number | null = null;
      // Any user id — the key's 3rd part is the signed-in user.
      for (const [, res] of qc.getQueriesData<TickerResponse>({ queryKey: ['ticker', t] })) {
        const d = res?.success ? res.data : undefined;
        if (!d) continue;
        logoUrl = logoUrl ?? d.logo_url ?? undefined;
        if (changePct == null && Number.isFinite(d.price_change_percent)) changePct = d.price_change_percent;
      }
      if (changePct == null) changePct = movers.get(t) ?? null;
      out[t] = { logoUrl, changePct };
    }
    return out;
  }, [qc, tickers]);
}

const fmtPct = (p: number) => `${p >= 0 ? '+' : ''}${p.toFixed(2)}%`;

/**
 * TickerSwitcherSheet body (the chart's "Tickers & timeframe" sheet): one
 * sideways row of ticker cards (round logo, symbol, day %) ending in a
 * Search card, then PERIOD and INTERVAL segmented controls. Mounts each
 * time the sheet opens (the Modal doesn't render hidden content), and
 * centers the active ticker on mount and whenever the selection changes.
 */
export function TickerSwitcherContent({
  tickers, activeTicker, onSelectTicker, onSearchPress,
  period, onPeriodChange, interval, allowedIntervals, onIntervalChange, colors,
}: {
  tickers: string[];
  activeTicker: string;
  onSelectTicker: (t: string) => void;
  onSearchPress: () => void;
  period: PricePeriod;
  onPeriodChange: (p: PricePeriod) => void;
  interval: string;
  /** The current period's allowed intervals (ALLOWED_INTERVALS[period]). */
  allowedIntervals: string[];
  onIntervalChange: (i: string) => void;
  colors: any;
}) {
  const quotes = useCachedQuotes(tickers);
  const scrollRef = useRef<ScrollView>(null);
  const layouts = useRef<Record<string, { x: number; w: number }>>({});
  const viewW = useRef(0);
  const didInitialCenter = useRef(false);

  const center = useCallback((t: string, animated: boolean) => {
    const l = layouts.current[t];
    if (!l || !viewW.current) return false;
    scrollRef.current?.scrollTo({ x: Math.max(0, l.x + l.w / 2 - viewW.current / 2), animated });
    return true;
  }, []);

  const tryInitialCenter = () => {
    if (!didInitialCenter.current && center(activeTicker, false)) didInitialCenter.current = true;
  };

  useEffect(() => {
    if (didInitialCenter.current) center(activeTicker, true);
  }, [activeTicker, center]);

  const tick = () => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}); };

  return (
    <View style={s.sections}>
      <ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        style={s.list}
        contentContainerStyle={s.listContent}
        onLayout={(e) => { viewW.current = e.nativeEvent.layout.width; tryInitialCenter(); }}
        accessibilityLabel="Tickers, scroll sideways"
      >
        {tickers.map(t => {
          const active = t === activeTicker;
          const q = quotes[t];
          const pct = q?.changePct;
          return (
            <PressableStyled
              key={t}
              onPress={() => { if (!active) onSelectTicker(t); }}
              onLayout={(e) => {
                const prevX = layouts.current[t]?.x;
                layouts.current[t] = { x: e.nativeEvent.layout.x, w: e.nativeEvent.layout.width };
                if (t !== activeTicker) return;
                // First layout: center without animating. Later, the active
                // card can move without the selection changing (tickers
                // inserted before it as positions update) — follow it.
                if (!didInitialCenter.current) tryInitialCenter();
                else if (prevX !== e.nativeEvent.layout.x) center(t, true);
              }}
              accessibilityRole="button"
              accessibilityLabel={pct != null ? `${t}, ${fmtPct(pct)} today` : t}
              accessibilityState={{ selected: active }}
              style={[
                s.card,
                { borderColor: active ? colors.text : colors.border },
                active && { backgroundColor: colors.text },
              ]}
              pressedStyle={active ? undefined : { backgroundColor: colors.surfaceSecondary }}
            >
              <TickerLogo uri={q?.logoUrl} ticker={t} size={26} borderRadius={13} />
              <Text style={[s.symbol, { color: active ? colors.background : colors.text }]} numberOfLines={1}>{t}</Text>
              {pct != null && (
                <Text style={[s.pct, { color: pct >= 0 ? colors.success : colors.error }]}>{fmtPct(pct)}</Text>
              )}
            </PressableStyled>
          );
        })}
        <PressableStyled
          onPress={onSearchPress}
          accessibilityRole="button"
          accessibilityLabel="Search tickers"
          style={[s.card, { borderColor: colors.border }]}
          pressedStyle={{ backgroundColor: colors.surfaceSecondary }}
        >
          <Ionicons name="search" size={26} color={colors.textSecondary} />
          <Text style={[s.symbol, { color: colors.textSecondary }]}>Search</Text>
        </PressableStyled>
      </ScrollView>

      <Segment
        label="PERIOD"
        options={PERIOD_STOPS.map(p => ({ value: p, label: p }))}
        value={period}
        // The interval list follows the period; useChartInterval falls back
        // to DEFAULT_INTERVAL[period] when the current one isn't allowed.
        onChange={(p) => { if (p !== period) { tick(); onPeriodChange(p as PricePeriod); } }}
        colors={colors}
      />
      <Segment
        label="INTERVAL"
        options={allowedIntervals.map(i => ({ value: i, label: INTERVAL_LABEL[i] ?? i }))}
        value={interval}
        onChange={(i) => { if (i !== interval) { tick(); onIntervalChange(i); } }}
        colors={colors}
      />
    </View>
  );
}

function Segment({ label, options, value, onChange, colors }: {
  label: string;
  options: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
  colors: any;
}) {
  return (
    <View style={s.section}>
      <Text style={[s.segLabel, { color: colors.textTertiary }]}>{label}</Text>
      <View
        style={[s.seg, { borderColor: colors.border, backgroundColor: colors.background }]}
        accessibilityRole="radiogroup"
        accessibilityLabel={label.toLowerCase()}
      >
        {options.map(o => {
          const active = o.value === value;
          return (
            <Pressable
              key={o.value}
              onPress={() => onChange(o.value)}
              accessibilityRole="radio"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`${label.toLowerCase()} ${o.label}`}
              style={[s.segBtn, active && { backgroundColor: colors.surfaceSecondary }]}
            >
              <Text style={[s.segText, { color: active ? colors.text : colors.textTertiary }]}>{o.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  sections: { gap: 14 },
  // (No edge-to-edge bleed: ChartBottomSheet's own ScrollView would clip a
  // negative margin.)
  list: { flexGrow: 0 },
  listContent: { paddingVertical: 2, gap: 8 },
  card: {
    minWidth: 66,
    paddingVertical: 9,
    paddingHorizontal: 10,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  symbol: { fontSize: 13, fontWeight: '700' },
  pct: { fontSize: 10, fontWeight: '600', fontVariant: ['tabular-nums'] },
  section: { gap: 8 },
  segLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 0.9 },
  seg: { flexDirection: 'row', borderWidth: 1, borderRadius: 10, padding: 3, gap: 4 },
  segBtn: { flex: 1, paddingVertical: 7, borderRadius: 7, alignItems: 'center', justifyContent: 'center' },
  segText: { fontSize: 13, fontWeight: '700' },
});

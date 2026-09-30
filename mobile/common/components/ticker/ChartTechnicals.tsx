import React from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { fetchEntryCheck, type ChartSignal, type EntryCheck } from '@/hooks/queries/technicals/useEntryCheck';
import { formatAsOf } from '@/common/components/trade/EntryTechnicalsPanel';
import type { ChartReferenceLine } from '@/common/components/ticker/AdvancedPriceChart';
import type { PricePeriod } from '@/common/types/blogPosts/ticker';

/**
 * Chart "Technicals" view — the same four technicals the entry sheet and the
 * strategy gate use (Trend, RSI-14, VWAP, ORB; from /strategy/entry-check),
 * plus a direction-free signal (BUY CALL / BUY PUT / WAIT / N/A). Price
 * levels draw as chart lines (technicalsReferenceLines); RSI isn't a price,
 * so it lives in the chip strip above the chart.
 */

const VWAP_COLOR = '#A855F7';
const EMA20_COLOR = '#4A9EFF';
const EMA50_COLOR = '#F59E0B';
// On 1D, a daily EMA further than this from price would stretch the y-axis
// and flatten the intraday candles — leave it off rather than squash the chart.
const EMA_1D_MAX_DISTANCE = 0.015;

/** Height ChartTechnicalsStrip adds above the chart (row + margin). */
export const CHART_TECHNICALS_STRIP_HEIGHT = 36;

export function useChartTechnicals(ticker: string | null | undefined, enabled: boolean) {
  return useQuery<EntryCheck>({
    queryKey: ['chart-technicals', ticker],
    enabled: !!ticker && enabled,
    staleTime: 10_000,
    refetchInterval: enabled ? 15_000 : false,
    // Response carries both directions' verdicts; CALL just picks `verdict`.
    queryFn: () => fetchEntryCheck(ticker!, 'CALL'),
  });
}

export function signalMeta(signal: ChartSignal | undefined, colors: any): { label: string; color: string } {
  switch (signal) {
    case 'CALL': return { label: 'BUY CALL', color: colors.success };
    case 'PUT':  return { label: 'BUY PUT', color: colors.error };
    case 'WAIT': return { label: 'WAIT', color: colors.warning };
    case 'NA':   return { label: 'N/A', color: colors.textTertiary ?? colors.tabBarInactive };
    default:     return { label: '—', color: colors.textTertiary ?? colors.tabBarInactive };
  }
}

export function technicalsReferenceLines(
  check: EntryCheck | undefined,
  period: PricePeriod,
  show: { vwap: boolean; ema: boolean } = { vwap: true, ema: true },
): ChartReferenceLine[] {
  if (!check) return [];
  const { trend, vwap } = check.rows;
  const lines: ChartReferenceLine[] = [];
  const isIntraday = period === '1D';
  // VWAP is a session level — meaningless on multi-day views.
  if (show.vwap && isIntraday && vwap) lines.push({ label: 'VWAP', price: vwap.value, color: VWAP_COLOR, dash: '5,3' });
  if (show.ema && trend) {
    const near = (lvl: number) => Math.abs(lvl - check.price) / check.price <= EMA_1D_MAX_DISTANCE;
    if (!isIntraday || near(trend.ema20)) {
      lines.push({ label: 'EMA-20 (D)', price: trend.ema20, color: EMA20_COLOR, dash: '2,3' });
    }
    if (trend.ema50 != null && (!isIntraday || near(trend.ema50))) {
      lines.push({ label: 'EMA-50 (D)', price: trend.ema50, color: EMA50_COLOR, dash: '2,3' });
    }
  }
  return lines;
}

/** Signal pill + the four technicals as chips — sits right above the chart. */
export function ChartTechnicalsStrip({ check, isLoading, colors }: { check: EntryCheck | undefined; isLoading: boolean; colors: any }) {
  const muted = colors.textSecondary;
  if (!check) {
    return (
      <View style={s.strip}>
        {isLoading ? <ActivityIndicator size="small" color={muted} /> : null}
        <Text style={[s.chipText, { color: muted }]}>{isLoading ? 'Loading technicals…' : 'Technicals unavailable'}</Text>
      </View>
    );
  }
  const sig = signalMeta(check.signal, colors);
  const { trend, rsi, vwap, orb } = check.rows;
  const chips: [string, string][] = [
    ['Trend', trend?.label ?? '—'],
    ['RSI', rsi ? rsi.value.toFixed(0) : '—'],
    ['VWAP', vwap?.position ?? '—'],
    ['ORB', orb?.position ?? '—'],
  ];
  return (
    <View style={s.strip}>
      <View style={[s.signal, { backgroundColor: sig.color }]}>
        <Text style={s.signalText}>{sig.label}</Text>
      </View>
      {chips.map(([k, v]) => (
        <View key={k} style={[s.chip, { borderColor: colors.separator }]}>
          <Text style={[s.chipText, { color: muted }]}>{k} </Text>
          <Text style={[s.chipText, { color: colors.text, fontWeight: '700' }]}>{v}</Text>
        </View>
      ))}
    </View>
  );
}

/** Body of the chart's Technicals modal — signal, both directions' reasons, and every row. */
export function ChartTechnicalsInfo({ check, isLoading, error, colors }: {
  check: EntryCheck | undefined; isLoading: boolean; error: Error | null; colors: any;
}) {
  const muted = colors.textSecondary;
  if (!check) {
    return (
      <View style={s.infoWrap}>
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
          {isLoading ? <ActivityIndicator size="small" color={muted} /> : null}
          <Text style={{ color: muted, fontSize: 12 }}>{isLoading ? 'Loading…' : `Unavailable — ${error?.message ?? 'try again'}`}</Text>
        </View>
      </View>
    );
  }
  const sig = signalMeta(check.signal, colors);
  const { trend, rsi, vwap, orb, sector } = check.rows;
  const pct = (v: number | null | undefined) => (v == null ? '' : ` (${v > 0 ? '+' : ''}${v.toFixed(2)}%)`);
  const rows: [string, string, string?][] = [
    ['Trend (daily)', trend?.label ?? '—',
      trend ? `EMA-20 $${trend.ema20.toFixed(2)}${trend.ema50 != null ? ` · EMA-50 $${trend.ema50.toFixed(2)}` : ''}` : undefined],
    ['RSI-14', rsi ? `${rsi.value.toFixed(0)} · ${rsi.zone}` : '—', 'Daily, Wilder-smoothed'],
    ['VWAP', vwap ? `${vwap.position}${pct(vwap.distance_pct)}` : '—', vwap ? `$${vwap.value.toFixed(2)}` : undefined],
    ['ORB', orb ? `${orb.position}${orb.distance_pct != null ? pct(orb.distance_pct) : ''}` : '—',
      orb ? `High $${orb.high.toFixed(2)} · Low $${orb.low.toFixed(2)}` : undefined],
  ];
  if (sector && sector.label !== 'n/a') {
    rows.push(['Sector', `${sector.label}${pct(sector.relative_pct)}`, `${sector.etf} vs SPY today`]);
  }
  // `verdicts`/`signal` arrived with a later API version — an older deploy
  // only returns the CALL `verdict`, so read defensively instead of crashing.
  const reason = (d: 'CALL' | 'PUT') =>
    check.verdicts?.[d]?.reason ?? (d === 'CALL' ? check.verdict?.reason : null) ?? 'Update the API to see this side';

  return (
    <View style={s.infoWrap}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text style={{ color: muted, fontSize: 11 }}>
          {check.market_open ? '' : 'closed · '}as of {formatAsOf(check.as_of)} ET
        </Text>
      </View>

      <View style={[s.bigSignal, { backgroundColor: sig.color + '1F', borderColor: sig.color + '66' }]}>
        <Text style={[s.bigSignalLabel, { color: sig.color }]}>{sig.label}</Text>
        <Text style={{ color: muted, fontSize: 11.5 }}>
          {!check.signal ? 'Signal needs the latest API deploy'
            : check.signal === 'NA' ? 'Neither side has a setup'
            : check.signal === 'WAIT' ? 'Close — conditions still missing' : 'Signal'}
        </Text>
      </View>

      {rows.map(([k, v, sub]) => (
        <View key={k} style={s.infoRow}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.text, fontSize: 13, fontWeight: '600' }}>{k}</Text>
            {sub ? <Text style={{ color: muted, fontSize: 11 }}>{sub}</Text> : null}
          </View>
          <Text style={{ color: colors.text, fontSize: 13, fontWeight: '700' }}>{v}</Text>
        </View>
      ))}

      <Text style={[s.reason, { color: muted }]}><Text style={{ fontWeight: '700', color: colors.success }}>Call: </Text>{reason('CALL')}</Text>
      <Text style={[s.reason, { color: muted }]}><Text style={{ fontWeight: '700', color: colors.error }}>Put: </Text>{reason('PUT')}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  strip:      { flexDirection: 'row', alignItems: 'center', gap: 6, height: 28, marginBottom: 8, flexWrap: 'nowrap', overflow: 'hidden' },
  signal:     { paddingHorizontal: 8, height: 24, borderRadius: 6, justifyContent: 'center' },
  signalText: { color: '#fff', fontSize: 11, fontWeight: '800', letterSpacing: 0.4 },
  chip:       { flexDirection: 'row', alignItems: 'center', height: 24, paddingHorizontal: 7, borderRadius: 6, borderWidth: 1 },
  chipText:   { fontSize: 11 },

  infoWrap:   { gap: 8 },
  bigSignal:  { borderRadius: 10, borderWidth: 1, paddingVertical: 10, alignItems: 'center', gap: 2 },
  bigSignalLabel: { fontSize: 20, fontWeight: '900', letterSpacing: 0.6 },
  infoRow:    { flexDirection: 'row', alignItems: 'center', gap: 8 },
  reason:     { fontSize: 11.5, lineHeight: 16 },
});

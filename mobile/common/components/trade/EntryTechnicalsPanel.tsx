import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { EntryCheck, EntryDecision } from '@/hooks/queries/technicals/useEntryCheck';

/**
 * Pre-entry technicals panel for the trade entry sheets: a verdict banner
 * (ENTER / WAIT / DON'T ENTER + one-line reason) over five Robinhood-style
 * rows — label left, value right, tap to expand the detail. Data and rules
 * come from /strategy/entry-check (see useEntryCheck).
 */

export function verdictColor(decision: EntryDecision | undefined, colors: any): string {
  if (decision === 'ENTER') return colors.success;
  if (decision === 'WAIT') return colors.warning;
  if (decision === 'DONT_ENTER') return colors.error;
  return colors.tabBarInactive;
}

export function verdictLabel(decision: EntryDecision): string {
  return decision === 'DONT_ENTER' ? "DON'T ENTER" : decision;
}

/** "HH:MM:SS" from the server's ET timestamp — shown as-is (ET), not converted to device time. */
export function formatAsOf(iso: string): string {
  const m = iso.match(/T(\d{2}:\d{2}:\d{2})/);
  return m ? m[1] : iso;
}

const pct = (v: number | null | undefined, digits = 2) =>
  v == null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(digits)}%`;

interface Props {
  data: EntryCheck | undefined;
  isLoading: boolean;
  error: Error | null;
  direction: 'CALL' | 'PUT';
  colors: any;
}

export function EntryTechnicalsPanel({ data, isLoading, error, direction, colors }: Props) {
  const muted = colors.textSecondary ?? colors.tabBarInactive;

  if (!data) {
    return (
      <View style={[s.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={s.loadingRow}>
          {isLoading ? <ActivityIndicator size="small" color={muted} /> : <Ionicons name="alert-circle-outline" size={16} color={colors.warning} />}
          <Text style={[s.loadingText, { color: muted }]}>
            {isLoading ? 'Checking technicals…' : `Technicals unavailable — ${error?.message ?? 'try again'}`}
          </Text>
        </View>
      </View>
    );
  }

  const { verdict, rows } = data;
  const vColor = verdictColor(verdict.decision, colors);
  const isCall = direction === 'CALL';

  // Colour each value relative to the trade: green when it supports this
  // direction, red when it works against it, neutral otherwise.
  const tone = (supports: boolean | null) =>
    supports == null ? colors.text : supports ? colors.success : colors.error;

  return (
    <View style={[s.card, { backgroundColor: colors.card, borderColor: vColor + '66' }]}>
      {/* Verdict — always the first thing in the panel */}
      <View style={[s.verdict, { backgroundColor: vColor + '1A' }]}>
        <View style={s.verdictTop}>
          <View style={[s.verdictPill, { backgroundColor: vColor }]}>
            <Text style={s.verdictPillText}>{verdictLabel(verdict.decision)}</Text>
          </View>
          <Text style={[s.verdictScore, { color: muted }]}>
            {verdict.factors_agree}/{verdict.factors_total} factors
          </Text>
          <Text style={[s.asOf, { color: muted }]}>
            {data.market_open ? '' : 'closed · '}as of {formatAsOf(data.as_of)} ET
          </Text>
        </View>
        <Text style={[s.verdictReason, { color: colors.text }]}>
          {verdict.reason.replace(/^(ENTER|WAIT|DON'T ENTER) — /, '')}
        </Text>
        {verdict.blockers.length > 1 && verdict.blockers.slice(1).map(b => (
          <Text key={b} style={[s.verdictExtra, { color: colors.error }]}>• {b}</Text>
        ))}
      </View>

      <Row
        label="Trend" colors={colors}
        value={rows.trend?.label ?? '—'}
        valueColor={rows.trend ? tone(rows.trend.label === 'Chop' ? null : (rows.trend.label === 'Bullish') === isCall) : undefined}
        detail={rows.trend && (
          `Price $${rows.trend.price.toFixed(2)} · EMA-20 $${rows.trend.ema20.toFixed(2)}` +
          (rows.trend.ema50 != null ? ` · EMA-50 $${rows.trend.ema50.toFixed(2)}` : '') +
          (rows.trend.ema200 != null ? ` · EMA-200 $${rows.trend.ema200.toFixed(2)}` : '') +
          '\nBullish = EMA-20 above EMA-50 and price above EMA-20 (daily).'
        )}
      />
      <Row
        label="RSI-14" colors={colors}
        value={rows.rsi ? `${rows.rsi.value.toFixed(0)} · ${rows.rsi.zone}` : '—'}
        valueColor={rows.rsi ? tone(
          rows.rsi.zone === 'Neutral'
            ? (isCall ? rows.rsi.value >= 50 : rows.rsi.value <= 50)
            : false,
        ) : undefined}
        detail={rows.rsi && `Daily RSI using the live price. Above 70 = overbought (chasing a call), below 30 = oversold (chasing a put).`}
      />
      <Row
        label="VWAP" colors={colors}
        value={rows.vwap ? `${rows.vwap.position} · ${pct(rows.vwap.distance_pct)}` : '—'}
        valueColor={rows.vwap ? tone((rows.vwap.position === 'Above') === isCall) : undefined}
        detail={rows.vwap && `Session VWAP $${rows.vwap.value.toFixed(2)}`}
      />
      <Row
        label="ORB" colors={colors}
        value={rows.orb ? `${rows.orb.position}${rows.orb.distance_pct != null ? ` · ${pct(rows.orb.distance_pct)}` : ''}` : '—'}
        valueColor={rows.orb ? tone(
          rows.orb.position === 'Inside' || rows.orb.position === 'Forming'
            ? null
            : (rows.orb.position === 'Above high') === isCall,
        ) : undefined}
        detail={rows.orb && `Opening range (9:30–9:45 ET): high $${rows.orb.high.toFixed(2)} · low $${rows.orb.low.toFixed(2)}`}
      />
      <Row
        label="Sector" colors={colors} last
        value={rows.sector
          ? rows.sector.label === 'n/a' ? 'n/a' : `${rows.sector.label} · ${pct(rows.sector.relative_pct, 1)}`
          : '—'}
        valueColor={rows.sector && rows.sector.label !== 'n/a' ? tone(
          rows.sector.label === 'Inline' ? null : (rows.sector.label === 'Leading') === isCall,
        ) : undefined}
        detail={rows.sector && (rows.sector.etf
          ? `${rows.sector.sector} (${rows.sector.etf}) ${pct(rows.sector.sector_change_pct)} vs SPY ${pct(rows.sector.spy_change_pct)} today`
          : 'No sector for this ticker (ETF or index).')}
      />
    </View>
  );
}

function Row({ label, value, valueColor, detail, colors, last }: {
  label: string; value: string; valueColor?: string; detail?: string | null | false; colors: any; last?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const muted = colors.textSecondary ?? colors.tabBarInactive;
  return (
    <TouchableOpacity
      activeOpacity={detail ? 0.7 : 1}
      onPress={() => detail && setOpen(o => !o)}
      style={[s.row, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }]}
    >
      <View style={s.rowMain}>
        <Text style={[s.rowLabel, { color: muted }]}>{label}</Text>
        <Text style={[s.rowValue, { color: valueColor ?? colors.text }]}>{value}</Text>
        {detail ? <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={14} color={muted} style={{ marginLeft: 6 }} /> : null}
      </View>
      {open && detail ? <Text style={[s.rowDetail, { color: muted }]}>{detail}</Text> : null}
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  card:          { borderRadius: 12, borderWidth: 1, overflow: 'hidden' },
  loadingRow:    { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 14 },
  loadingText:   { fontSize: 13 },

  verdict:       { paddingHorizontal: 14, paddingVertical: 12 },
  verdictTop:    { flexDirection: 'row', alignItems: 'center', gap: 8 },
  verdictPill:   { paddingHorizontal: 9, paddingVertical: 3, borderRadius: 6 },
  verdictPillText: { color: '#fff', fontSize: 12, fontWeight: '800', letterSpacing: 0.5 },
  verdictScore:  { fontSize: 12, fontWeight: '600' },
  asOf:          { fontSize: 11, marginLeft: 'auto' },
  verdictReason: { fontSize: 13.5, fontWeight: '600', lineHeight: 19, marginTop: 8 },
  verdictExtra:  { fontSize: 12, lineHeight: 17, marginTop: 4 },

  row:           { paddingHorizontal: 14, paddingVertical: 11 },
  rowMain:       { flexDirection: 'row', alignItems: 'center' },
  rowLabel:      { fontSize: 13, fontWeight: '500' },
  rowValue:      { fontSize: 13.5, fontWeight: '700', marginLeft: 'auto' },
  rowDetail:     { fontSize: 12, lineHeight: 17, marginTop: 6 },
});

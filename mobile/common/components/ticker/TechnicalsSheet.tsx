import React from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors } from '@/lib/useColorScheme';
import { signalMeta } from './ChartTechnicals';
import type { EntryCheck } from '@/hooks/queries/technicals/useEntryCheck';

type IconName = keyof typeof Ionicons.glyphMap;

interface FactorCard {
  key: string;
  icon: IconName;
  title: string;
  value: string;
  sub?: string;
  color: string;
}

/**
 * TechnicalsSheet — Analysis-hub-style Technicals bottom sheet: a hero
 * signal card, then a 2-column grid of factor cards (Trend / RSI / VWAP /
 * ORB / Sector), then the call/put verdict reasons.
 */
export function TechnicalsSheet({
  check,
  isLoading,
  error,
}: {
  check: EntryCheck | undefined;
  isLoading: boolean;
  error: Error | null;
}) {
  const colors = useThemeColors();
  const muted = colors.textSecondary;

  if (!check) {
    return (
      <View style={s.empty}>
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
          {isLoading ? <ActivityIndicator size="small" color={muted} /> : null}
          <Text style={{ color: muted, fontSize: 12 }}>
            {isLoading ? 'Loading…' : `Unavailable — ${error?.message ?? 'try again'}`}
          </Text>
        </View>
      </View>
    );
  }

  const sig = signalMeta(check.signal, colors);
  const { trend, rsi, vwap, orb, sector } = check.rows;

  const cards: FactorCard[] = [];
  if (trend) {
    const c = trend.label === 'Bullish' ? colors.success : trend.label === 'Bearish' ? colors.error : colors.warning;
    cards.push({
      key: 'trend', icon: trend.label === 'Bearish' ? 'trending-down-outline' : 'trending-up-outline',
      title: 'Trend', value: trend.label,
      sub: `EMA-20 $${trend.ema20.toFixed(2)}${trend.ema50 != null ? ` · EMA-50 $${trend.ema50.toFixed(2)}` : ''}`,
      color: c,
    });
  }
  if (rsi) {
    const c = rsi.zone === 'Neutral' ? colors.textTertiary : colors.warning;
    cards.push({
      key: 'rsi', icon: 'speedometer-outline', title: 'RSI-14',
      value: `${rsi.value.toFixed(0)} · ${rsi.zone}`, sub: 'Daily, Wilder-smoothed', color: c,
    });
  }
  if (vwap) {
    const c = vwap.position === 'Above' ? colors.success : colors.error;
    const d = vwap.distance_pct;
    cards.push({
      key: 'vwap', icon: 'git-commit-outline', title: 'VWAP',
      value: `${vwap.position}${d != null ? ` (${d > 0 ? '+' : ''}${d.toFixed(2)}%)` : ''}`,
      sub: `$${vwap.value.toFixed(2)}`, color: c,
    });
  }
  if (orb) {
    const c = orb.position === 'Above high' ? colors.success : orb.position === 'Below low' ? colors.error : colors.textTertiary;
    cards.push({
      key: 'orb', icon: 'resize-outline', title: 'ORB',
      value: orb.position, sub: `High $${orb.high.toFixed(2)} · Low $${orb.low.toFixed(2)}`, color: c,
    });
  }
  if (sector && sector.label !== 'n/a') {
    const c = sector.label === 'Leading' ? colors.success : sector.label === 'Lagging' ? colors.error : colors.textTertiary;
    const rp = sector.relative_pct;
    cards.push({
      key: 'sector', icon: 'pie-chart-outline', title: 'Sector',
      value: `${sector.label}${rp != null ? ` (${rp > 0 ? '+' : ''}${rp.toFixed(2)}%)` : ''}`,
      sub: sector.etf ? `${sector.etf} vs SPY today` : undefined, color: c,
    });
  }

  const reason = (d: 'CALL' | 'PUT') =>
    check.verdicts?.[d]?.reason ?? (d === 'CALL' ? check.verdict?.reason : null) ?? 'Update the API to see this side';

  return (
    <View style={{ gap: 14 }}>
      {/* Hero signal */}
      <View style={[s.hero, { backgroundColor: sig.color + '1F', borderColor: sig.color + '66' }]}>
        <Text style={[s.heroLabel, { color: sig.color }]}>{sig.label}</Text>
        <Text style={{ color: muted, fontSize: 11.5 }}>
          {check.market_open ? '' : 'closed · '}as of {formatAsOf(check.as_of)} ET
          {!check.signal ? ' — signal needs the latest API deploy'
            : check.signal === 'NA' ? ' — neither side has a setup'
            : check.signal === 'WAIT' ? ' — close, conditions still missing' : ''}
        </Text>
      </View>

      {/* Factor grid */}
      <View>
        <Text style={[s.sectionTitle, { color: colors.textTertiary }]}>FACTORS</Text>
        <View style={s.grid}>
          {cards.map(c => (
            <View key={c.key} style={[s.card, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}>
              <View style={s.cardHeader}>
                <Ionicons name={c.icon} size={15} color={c.color} />
                <Text style={[s.cardTitle, { color: muted }]}>{c.title}</Text>
              </View>
              <Text style={[s.cardValue, { color: c.color }]} numberOfLines={1}>{c.value}</Text>
              {c.sub ? <Text style={[s.cardSub, { color: muted }]} numberOfLines={2}>{c.sub}</Text> : null}
            </View>
          ))}
        </View>
      </View>

      {/* Verdict reasons */}
      <View>
        <Text style={[s.sectionTitle, { color: colors.textTertiary }]}>WHY</Text>
        <View style={{ gap: 8 }}>
          <View style={[s.reasonCard, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}>
            <Text style={[s.reasonSide, { color: colors.success }]}>Call</Text>
            <Text style={[s.reasonText, { color: muted }]}>{reason('CALL')}</Text>
          </View>
          <View style={[s.reasonCard, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}>
            <Text style={[s.reasonSide, { color: colors.error }]}>Put</Text>
            <Text style={[s.reasonText, { color: muted }]}>{reason('PUT')}</Text>
          </View>
        </View>
      </View>
    </View>
  );
}

function formatAsOf(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('en-US', {
      timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', hour12: true,
    });
  } catch {
    return iso;
  }
}

const s = StyleSheet.create({
  empty: { paddingVertical: 24, alignItems: 'center' },
  hero: {
    borderRadius: 14, borderWidth: 1, paddingVertical: 14, paddingHorizontal: 16,
    alignItems: 'center', gap: 4,
  },
  heroLabel: { fontSize: 22, fontWeight: '900', letterSpacing: 0.6 },
  sectionTitle: { fontSize: 11, fontWeight: '700', letterSpacing: 0.8, marginBottom: 8 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  card: {
    flexBasis: '48%', flexGrow: 1, borderRadius: 12, borderWidth: 1,
    padding: 12, gap: 4,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  cardTitle: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  cardValue: { fontSize: 15, fontWeight: '800' },
  cardSub: { fontSize: 11, lineHeight: 14 },
  reasonCard: { borderRadius: 12, borderWidth: 1, padding: 12, gap: 4 },
  reasonSide: { fontSize: 12, fontWeight: '800' },
  reasonText: { fontSize: 12, lineHeight: 16 },
});

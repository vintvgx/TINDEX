import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import type { ZeroDTEOpportunity } from '@/common/types/zero_dte';
import { TIER_CONFIG } from '@/common/types/zero_dte';

function fmt_dollars(val: number): string {
  if (val >= 1_000_000) return `$${(val / 1_000_000).toFixed(2)}M`;
  if (val >= 1_000)     return `$${(val / 1_000).toFixed(0)}K`;
  return `$${val.toFixed(0)}`;
}

interface Props {
  item: ZeroDTEOpportunity;
  rank: number;
  onPress?: (item: ZeroDTEOpportunity) => void;
}

export function ZeroDTECard({ item, rank, onPress }: Props) {
  const tier   = TIER_CONFIG[item.tier];
  const isCall = item.contract_type === 'call';

  return (
    <TouchableOpacity
      style={styles.card}
      onPress={() => onPress?.(item)}
      activeOpacity={0.8}
    >
      <View style={styles.headerRow}>
        <View style={styles.rankBadge}>
          <Text style={styles.rankText}>#{rank}</Text>
        </View>
        <Text style={styles.ticker}>{item.ticker}</Text>
        <View style={[styles.tierBadge, { backgroundColor: tier.bg }]}>
          <Text style={styles.tierEmoji}>{tier.emoji}</Text>
          <Text style={[styles.tierLabel, { color: tier.color }]}>{tier.label}</Text>
        </View>
      </View>

      <View style={styles.contractRow}>
        <Text style={[styles.side, { color: isCall ? '#10B981' : '#EF4444' }]}>
          {isCall ? '▲ CALL' : '▼ PUT'}
        </Text>
        <Text style={styles.strike}>${item.strike.toFixed(0)}</Text>
        <Text style={styles.expiry}>exp {item.expiry}</Text>
        <Text style={styles.otm}>{item.otm_pct.toFixed(1)}% OTM</Text>
      </View>

      <View style={styles.scoreRow}>
        <View style={styles.scoreBarBg}>
          <View style={[styles.scoreBarFill, { width: `${item.composite_score}%`, backgroundColor: tier.color }]} />
        </View>
        <Text style={[styles.scoreText, { color: tier.color }]}>{item.composite_score.toFixed(1)}</Text>
      </View>

      <View style={styles.statsRow}>
        <StatChip label="Flow" value={fmt_dollars(item.dollar_flow)} />
        <StatChip label="V/OI" value={item.vol_oi.toFixed(2)} highlight={item.vol_oi > 0.5} />
        <StatChip label="IV" value={`${item.iv_pct.toFixed(0)}%`} />
        <StatChip label="UW" value={item.uw_score.toFixed(0)} />
        {item.above_vwap !== null && (
          <StatChip
            label="VWAP"
            value={item.above_vwap ? 'Above' : 'Below'}
            highlight={
              (isCall && item.above_vwap === true) ||
              (!isCall && item.above_vwap === false)
            }
          />
        )}
      </View>

      <View style={styles.tagsRow}>
        {item.is_sweep && (
          <View style={styles.tag}>
            <Text style={styles.tagText}>SWEEP</Text>
          </View>
        )}
        {item.is_floor && (
          <View style={styles.tag}>
            <Text style={styles.tagText}>FLOOR</Text>
          </View>
        )}
        {item.trend_aligned && (
          <View style={[styles.tag, styles.tagGreen]}>
            <Text style={[styles.tagText, { color: '#10B981' }]}>TREND ✓</Text>
          </View>
        )}
        <Text style={styles.premium}>
          ${item.premium.toFixed(2)}/share · ${(item.premium * 100).toFixed(0)}/contract
        </Text>
      </View>
    </TouchableOpacity>
  );
}

function StatChip({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <View style={styles.chip}>
      <Text style={styles.chipLabel}>{label}</Text>
      <Text style={[styles.chipValue, highlight && styles.chipHighlight]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card:          { backgroundColor: '#0F172A', borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: '#1E293B' },
  headerRow:     { flexDirection: 'row', alignItems: 'center', marginBottom: 8, gap: 8 },
  rankBadge:     { backgroundColor: '#1E293B', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  rankText:      { color: '#64748B', fontSize: 11, fontWeight: '700' },
  ticker:        { color: '#F1F5F9', fontSize: 18, fontWeight: '700', flex: 1 },
  tierBadge:     { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, gap: 4 },
  tierEmoji:     { fontSize: 12 },
  tierLabel:     { fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  contractRow:   { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  side:          { fontSize: 13, fontWeight: '700' },
  strike:        { color: '#F1F5F9', fontSize: 13, fontWeight: '600' },
  expiry:        { color: '#64748B', fontSize: 12 },
  otm:           { color: '#94A3B8', fontSize: 12, marginLeft: 'auto' },
  scoreRow:      { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  scoreBarBg:    { flex: 1, height: 4, backgroundColor: '#1E293B', borderRadius: 2, overflow: 'hidden' },
  scoreBarFill:  { height: 4, borderRadius: 2 },
  scoreText:     { fontSize: 13, fontWeight: '700', minWidth: 36, textAlign: 'right' },
  statsRow:      { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
  chip:          { backgroundColor: '#1E293B', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 },
  chipLabel:     { color: '#475569', fontSize: 9, marginBottom: 1 },
  chipValue:     { color: '#CBD5E1', fontSize: 12, fontWeight: '600' },
  chipHighlight: { color: '#10B981' },
  tagsRow:       { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  tag:           { backgroundColor: '#1E293B', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  tagGreen:      { borderWidth: 1, borderColor: '#064E3B' },
  tagText:       { color: '#94A3B8', fontSize: 10, fontWeight: '700' },
  premium:       { color: '#475569', fontSize: 11, marginLeft: 'auto' },
});

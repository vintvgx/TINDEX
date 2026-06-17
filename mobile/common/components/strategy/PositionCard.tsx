import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors } from '@/lib/useColorScheme';
import type { StrategyPosition, ProfileKey } from '@/common/types/strategy';

const PROFILE_EMOJI: Record<ProfileKey, string> = {
  BULL_DOG:    '🐂',
  THUNDER_CAT: '🐱',
  WOLF:        '🐺',
  TREND_RIDER: '🚀',
  RETESTER:    '🎯',
  REVERSAL:    '🔄',
  CUSTOM:      '⚙️',
  SCALPER:     '⚡',
  PRECISION:   '🎯',
  MOMENTUM:    '📈',
  CONVICTION:  '💎',
  ALL_IN:      '🔥',
};

interface Props {
  position: StrategyPosition;
  onForceClose?: () => void;
}

export const PositionCard: React.FC<Props> = ({ position, onForceClose }) => {
  const colors = useThemeColors();

  if (!position.active) {
    return (
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Ionicons name="moon-outline" size={28} color={colors.tabBarInactive} style={{ marginBottom: 8 }} />
        <Text style={[styles.noPos, { color: colors.tabBarInactive }]}>No active position</Text>
        <Text style={[styles.subtext, { color: colors.tabBarInactive }]}>
          Waiting for next ORB breakout on {position.ticker}
        </Text>
      </View>
    );
  }

  const pnl     = position.unrealized_pnl ?? 0;
  const pnlPct  = position.unrealized_pnl_pct ?? 0;
  const pnlColor = pnl >= 0 ? colors.success : colors.error;
  const dirColor = position.direction === 'CALL' ? colors.success : colors.error;
  const mktVal  = (position.current_price != null && position.qty_remaining != null)
    ? position.current_price * position.qty_remaining * 100
    : null;

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      {/* Header row */}
      <View style={styles.headerRow}>
        <View>
          <Text style={[styles.contract, { color: colors.text }]}>{position.contract}</Text>
          <View style={styles.badges}>
            <View style={[styles.badge, { backgroundColor: dirColor + '22' }]}>
              <Text style={[styles.badgeText, { color: dirColor }]}>{position.direction}</Text>
            </View>
            <View style={[styles.badge, { backgroundColor: colors.border }]}>
              <Text style={[styles.badgeText, { color: colors.text }]}>
                {PROFILE_EMOJI[position.profile]} {position.profile.replace('_', ' ')}
              </Text>
            </View>
            {position.paper_mode && (
              <View style={[styles.badge, { backgroundColor: '#FF9F0A22' }]}>
                <Text style={[styles.badgeText, { color: '#FF9F0A' }]}>PAPER</Text>
              </View>
            )}
          </View>
        </View>
        <View style={styles.pnlBlock}>
          <Text style={[styles.pnlValue, { color: pnlColor }]}>
            {pnl >= 0 ? '+' : ''}{pnl.toFixed(2)}
          </Text>
          <Text style={[styles.pnlPct, { color: pnlColor }]}>
            {pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(1)}%
          </Text>
          {mktVal != null && (
            <Text style={[styles.mktVal, { color: colors.tabBarInactive }]}>
              Mkt ${mktVal.toFixed(2)}
            </Text>
          )}
        </View>
      </View>

      {/* Price levels */}
      <View style={styles.levelRow}>
        <Level label="Entry"    value={position.entry_premium} colors={colors} />
        <Level label="Current"  value={position.current_price}  colors={colors} highlight />
        <Level label="Qty"      value={`${position.qty_remaining}/${position.qty_total}`} colors={colors} isText />
      </View>

      {/* Stop / TP levels */}
      <StopBar position={position} colors={colors} />

      {/* Force close */}
      {onForceClose && (
        <TouchableOpacity
          onPress={onForceClose}
          style={[styles.closeBtn, { borderColor: colors.error }]}
        >
          <Text style={[styles.closeBtnText, { color: colors.error }]}>Force Close Position</Text>
        </TouchableOpacity>
      )}
    </View>
  );
};

const Level = ({ label, value, colors, highlight, isText }: any) => (
  <View style={styles.level}>
    <Text style={[styles.levelLabel, { color: colors.tabBarInactive }]}>{label}</Text>
    <Text style={[styles.levelValue, { color: highlight ? colors.accent : colors.text }]}>
      {isText ? value : (typeof value === 'number' ? `$${value.toFixed(2)}` : '—')}
    </Text>
  </View>
);

const StopBar = ({ position, colors }: { position: StrategyPosition; colors: any }) => {
  const stages = [
    { label: 'Stop', value: position.hard_stop, active: !position.tp1_hit && !position.be_stop_active, color: colors.error },
    { label: 'BE', value: position.entry_premium, active: position.be_stop_active && !position.tp1_hit, color: '#FF9F0A' },
    { label: 'TP1', value: position.tp1, active: position.tp1_hit && !position.tp2_hit, color: '#4A9EFF' },
    { label: 'TP2', value: position.tp2, active: position.tp2_hit, color: colors.success },
  ];

  return (
    <View style={styles.stopBar}>
      {stages.map((s, i) => (
        <View key={i} style={styles.stopStage}>
          <View style={[styles.stopDot, { backgroundColor: s.active ? s.color : colors.border }]} />
          <Text style={[styles.stopLabel, { color: s.active ? s.color : colors.tabBarInactive }]}>
            {s.label}
          </Text>
          {s.value != null && (
            <Text style={[styles.stopValue, { color: colors.tabBarInactive }]}>
              ${s.value.toFixed(2)}
            </Text>
          )}
        </View>
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    gap: 14,
  },
  noPos:    { fontSize: 16, fontWeight: '600', textAlign: 'center' },
  subtext:  { fontSize: 12, textAlign: 'center', marginTop: 4 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  contract: { fontSize: 15, fontWeight: '700', marginBottom: 6 },
  badges:   { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  badge:    { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  badgeText: { fontSize: 11, fontWeight: '600' },
  pnlBlock: { alignItems: 'flex-end' },
  pnlValue: { fontSize: 20, fontWeight: '700' },
  pnlPct:   { fontSize: 13, fontWeight: '500', marginTop: 1 },
  mktVal:   { fontSize: 11, fontWeight: '600', marginTop: 4 },
  levelRow: { flexDirection: 'row', justifyContent: 'space-between' },
  level:    { alignItems: 'center', flex: 1 },
  levelLabel: { fontSize: 10, marginBottom: 2 },
  levelValue: { fontSize: 13, fontWeight: '600' },
  stopBar:   { flexDirection: 'row', justifyContent: 'space-between', paddingTop: 4 },
  stopStage: { alignItems: 'center', flex: 1 },
  stopDot:   { width: 8, height: 8, borderRadius: 4, marginBottom: 4 },
  stopLabel: { fontSize: 10, fontWeight: '600' },
  stopValue: { fontSize: 9, marginTop: 2 },
  closeBtn: { borderWidth: 1, borderRadius: 10, padding: 10, alignItems: 'center', marginTop: 4 },
  closeBtnText: { fontSize: 13, fontWeight: '600' },
});

import { useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useStrategyProfiles } from '@/hooks/queries/strategy/useStrategyProfiles';
import type { SimProfileKey } from '@/hooks/mutations/strategy/useRunSimulation';

/**
 * Profile picker scoped to a simulation: only the 6 automated ORB-breakout
 * profiles are selectable (Bull Dog/Thunder Cat/Wolf/Trend Rider/Retester/
 * Reversal) — the manual "Trade Now" profiles (Scalper, Precision, etc.,
 * see ImmediateProfilePicker.tsx) and Manual/No Stop Loss have no reachable
 * auto TP/SL to demo, so they're excluded. Backed by useStrategyProfiles(),
 * the same source strategy.tsx's config screen uses, so the numbers shown
 * here are always the real backend thresholds.
 */

const SIM_PROFILE_KEYS: SimProfileKey[] = [
  'BULL_DOG', 'THUNDER_CAT', 'WOLF', 'TREND_RIDER', 'RETESTER', 'REVERSAL',
];

const riskColor = (r: string, colors: any): string => {
  if (r === 'Low') return '#22C55E';
  if (r === 'Medium') return '#F59E0B';
  if (r === 'Medium-High') return '#F97316';
  if (r === 'High') return '#EF4444';
  return colors.accent;
};

interface SimProfilePickerProps {
  selectedKey: SimProfileKey;
  onSelect: (key: SimProfileKey) => void;
  colors: any;
}

export function SimProfilePicker({ selectedKey, onSelect, colors }: SimProfilePickerProps) {
  const [open, setOpen] = useState(false);
  const { data: allProfiles, isLoading } = useStrategyProfiles();

  const profiles = (allProfiles ?? []).filter(p => SIM_PROFILE_KEYS.includes(p.key as SimProfileKey));
  const selected = profiles.find(p => p.key === selectedKey);

  if (isLoading || !selected) {
    return (
      <View style={[s.ddTrigger, { backgroundColor: colors.card, borderColor: colors.border, justifyContent: 'center' }]}>
        <ActivityIndicator size="small" color={colors.textTertiary} />
      </View>
    );
  }

  return (
    <View>
      <TouchableOpacity
        onPress={() => setOpen(o => !o)}
        activeOpacity={0.8}
        style={[s.ddTrigger, { backgroundColor: colors.card, borderColor: open ? colors.accent : colors.border }]}
      >
        <Text style={s.ddTriggerEmoji}>{selected.emoji}</Text>
        <View style={{ flex: 1 }}>
          <Text style={[s.ddTriggerName, { color: colors.text }]}>{selected.display_name}</Text>
          <Text style={[s.ddTriggerSub, { color: colors.textTertiary }]} numberOfLines={1}>
            {`Stop −${selected.max_loss_pct}%  ·  TP1 +${selected.tp1_pct}%  ·  ${selected.use_tp2 ? `TP2 +${selected.tp2_pct}%` : 'Runner'}`}
          </Text>
        </View>
        <View style={[s.ddRiskBadge, { backgroundColor: riskColor(selected.risk_level, colors) + '22' }]}>
          <Text style={[s.ddRiskText, { color: riskColor(selected.risk_level, colors) }]}>{selected.risk_level}</Text>
        </View>
        <Ionicons
          name={open ? 'chevron-up' : 'chevron-down'}
          size={16}
          color={colors.textTertiary}
          style={{ marginLeft: 6 }}
        />
      </TouchableOpacity>

      {open && (
        <View style={[s.ddList, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <ScrollView style={s.ddScroll} nestedScrollEnabled keyboardShouldPersistTaps="handled">
            {profiles.map((p) => {
              const active = p.key === selectedKey;
              const rc = riskColor(p.risk_level, colors);
              return (
                <TouchableOpacity
                  key={p.key}
                  onPress={() => { onSelect(p.key as SimProfileKey); setOpen(false); }}
                  activeOpacity={0.75}
                  style={[
                    s.ddItem,
                    { borderBottomColor: colors.border },
                    active && { backgroundColor: colors.accent + '12' },
                  ]}
                >
                  <View style={s.ddItemHeader}>
                    <Text style={s.ddItemEmoji}>{p.emoji}</Text>
                    <Text style={[s.ddItemName, { color: colors.text }]}>{p.display_name}</Text>
                    {active && (
                      <Ionicons name="checkmark-circle" size={15} color={colors.accent} style={{ marginLeft: 4 }} />
                    )}
                    <View style={[s.ddRiskBadge, { backgroundColor: rc + '22', marginLeft: 'auto' }]}>
                      <Text style={[s.ddRiskText, { color: rc }]}>{p.risk_level}</Text>
                    </View>
                  </View>
                  <View style={s.ddItemStats}>
                    <DDStat label="Stop" value={`−${p.max_loss_pct}%`} color="#EF4444" colors={colors} />
                    <DDStat label="TP1" value={`+${p.tp1_pct}%`} color="#22C55E" colors={colors} />
                    <DDStat
                      label={p.use_tp2 ? 'TP2' : 'Exit'}
                      value={p.use_tp2 ? `+${p.tp2_pct}%` : 'Runner'}
                      color={p.use_tp2 ? '#22C55E' : colors.accent}
                      colors={colors}
                    />
                    <DDStat label="Qty" value={String(p.contracts)} colors={colors} />
                  </View>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      )}
    </View>
  );
}

const DDStat = ({ label, value, color, colors }: { label: string; value: string; color?: string; colors: any }) => (
  <View style={s.ddStatItem}>
    <Text style={[s.ddStatValue, { color: color ?? colors.text }]}>{value}</Text>
    <Text style={[s.ddStatLabel, { color: colors.textTertiary }]}>{label}</Text>
  </View>
);

const s = StyleSheet.create({
  ddTrigger:      { flexDirection: 'row', alignItems: 'center', borderRadius: 12, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10, gap: 10, minHeight: 56 },
  ddTriggerEmoji: { fontSize: 22 },
  ddTriggerName:  { fontSize: 15, fontWeight: '700', marginBottom: 1 },
  ddTriggerSub:   { fontSize: 11 },
  ddRiskBadge:    { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 },
  ddRiskText:     { fontSize: 10, fontWeight: '700' },
  ddList:         { borderRadius: 12, borderWidth: 1, overflow: 'hidden', marginTop: 6, maxHeight: 320 },
  ddScroll:       { maxHeight: 320 },
  ddItem:         { padding: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  ddItemHeader:   { flexDirection: 'row', alignItems: 'center', marginBottom: 8, gap: 6 },
  ddItemEmoji:    { fontSize: 16 },
  ddItemName:     { fontSize: 14, fontWeight: '700' },
  ddItemStats:    { flexDirection: 'row', gap: 16 },
  ddStatItem:     { alignItems: 'center' },
  ddStatValue:    { fontSize: 13, fontWeight: '700' },
  ddStatLabel:    { fontSize: 10, marginTop: 1 },
});

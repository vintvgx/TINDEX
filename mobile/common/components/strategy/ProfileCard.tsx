import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors } from '@/lib/useColorScheme';
import type { StrategyProfile, ProfileKey } from '@/common/types/strategy';

interface Props {
  profile: StrategyProfile;
  selected: boolean;
  onSelect: (key: ProfileKey) => void;
}

const BORDER_COLORS: Record<ProfileKey, string> = {
  BULL_DOG:    '#FF6B35',
  THUNDER_CAT: '#4A9EFF',
  WOLF:        '#4CAF84',
};

export const ProfileCard: React.FC<Props> = ({ profile, selected, onSelect }) => {
  const colors = useThemeColors();
  const border = BORDER_COLORS[profile.key];

  return (
    <TouchableOpacity
      onPress={() => onSelect(profile.key)}
      activeOpacity={0.8}
      style={[
        styles.card,
        { backgroundColor: colors.card, borderColor: selected ? border : colors.border },
        selected && { borderWidth: 2 },
      ]}
    >
      {selected && (
        <View style={[styles.activeBadge, { backgroundColor: border }]}>
          <Ionicons name="checkmark" size={10} color="#fff" />
        </View>
      )}

      <Text style={styles.emoji}>{profile.emoji}</Text>
      <Text style={[styles.name, { color: colors.text }]}>{profile.display_name}</Text>
      <Text style={[styles.risk, { color: border }]}>{profile.risk_level} Risk</Text>

      <View style={styles.statsGrid}>
        <Stat label="Contracts" value={String(profile.contracts)} colors={colors} />
        <Stat label="Max Loss" value={`-${profile.max_loss_pct}%`} colors={colors} />
        <Stat label="TP1" value={`+${profile.tp1_pct}%`} colors={colors} />
        <Stat label="TP2" value={`+${profile.tp2_pct}%`} colors={colors} />
        <Stat label="VIX Max" value={String(profile.vix_max)} colors={colors} />
        <Stat label="Runner" value={profile.runner ? 'Yes' : 'No'} colors={colors} />
      </View>
    </TouchableOpacity>
  );
};

const Stat = ({ label, value, colors }: { label: string; value: string; colors: any }) => (
  <View style={styles.stat}>
    <Text style={[styles.statLabel, { color: colors.textSecondary ?? colors.tabBarInactive }]}>{label}</Text>
    <Text style={[styles.statValue, { color: colors.text }]}>{value}</Text>
  </View>
);

const styles = StyleSheet.create({
  card: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    marginBottom: 12,
    position: 'relative',
  },
  activeBadge: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emoji: { fontSize: 28, marginBottom: 4 },
  name:  { fontSize: 16, fontWeight: '700', marginBottom: 2 },
  risk:  { fontSize: 12, fontWeight: '600', marginBottom: 10 },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  stat: { width: '30%' },
  statLabel: { fontSize: 10, marginBottom: 1 },
  statValue: { fontSize: 13, fontWeight: '600' },
});

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors } from '@/lib/useColorScheme';
import type { UseLivePositionsDataResult } from '@/common/components/strategy/LivePositionsSection';
import { PositionBriefCard } from './PositionBriefCard';

/**
 * 0.7 redesign positions list — same data contract as LivePositionsBody
 * (hidden banner, empty state, live-update reporting) but every position
 * renders as a brief-style card.
 */
export function BriefPositionsBody({
  data,
  mode,
  colors,
  emptySubtitle,
}: {
  data: UseLivePositionsDataResult;
  mode?: 'live' | 'paper';
  colors: ReturnType<typeof useThemeColors>;
  emptySubtitle?: string;
}) {
  const {
    isLoading, displayedPositions, hiddenCount, showHidden, setShowHidden, handleLiveUpdate,
  } = data;

  return (
    <>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10, paddingHorizontal: 2 }}>
        <Text style={[styles.mono, { fontSize: 11, fontWeight: '700', letterSpacing: 2, color: colors.textSecondary }]}>
          LIVE POSITIONS
        </Text>
        {displayedPositions.length > 0 && (
          <View style={[styles.countBadge, { backgroundColor: colors.success + '1E' }]}>
            <Text style={[styles.mono, { fontSize: 10, fontWeight: '800', color: colors.success }]}>
              {displayedPositions.length}
            </Text>
          </View>
        )}
      </View>

      {hiddenCount > 0 && (
        <TouchableOpacity
          onPress={() => setShowHidden((v: boolean) => !v)}
          activeOpacity={0.75}
          style={[styles.hiddenBanner, { backgroundColor: '#4A9EFF1A', borderColor: colors.border }]}
        >
          <Ionicons name="eye-off-outline" size={14} color="#4A9EFF" />
          <Text style={[styles.hiddenBannerText, { color: '#4A9EFF' }]}>
            {showHidden ? 'Showing Hidden — Tap to Return' : `${hiddenCount} Hidden`}
          </Text>
          <Ionicons name={showHidden ? 'chevron-up' : 'chevron-forward'} size={14} color="#4A9EFF" />
        </TouchableOpacity>
      )}

      {isLoading ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: 24 }} />
      ) : displayedPositions.length === 0 ? (
        <View style={styles.emptyState}>
          <Ionicons name="pulse-outline" size={40} color={colors.tabBarInactive} style={{ opacity: 0.4 }} />
          <Text style={[styles.emptyTitle, { color: colors.tabBarInactive }]}>
            {`No ${mode === 'paper' ? 'Paper' : mode === 'live' ? 'Live' : 'Open'} Positions`}
          </Text>
          {!!emptySubtitle && (
            <Text style={[styles.emptySubtitle, { color: colors.tabBarInactive }]}>{emptySubtitle}</Text>
          )}
        </View>
      ) : (
        displayedPositions.map((pos) => (
          <PositionBriefCard
            key={pos.strategy_id}
            pos={pos}
            colors={colors}
            onLiveUpdate={handleLiveUpdate}
          />
        ))
      )}
    </>
  );
}

const styles = StyleSheet.create({
  mono: { fontFamily: 'Menlo' },
  countBadge: {
    marginLeft: 8,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },
  hiddenBanner: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 9, borderRadius: 10, borderWidth: 1, marginBottom: 10,
  },
  hiddenBannerText: { fontSize: 12, fontWeight: '700' },
  emptyState: { alignItems: 'center', justifyContent: 'center', paddingVertical: 32, gap: 8 },
  emptyTitle: { fontSize: 15, fontWeight: '600', marginTop: 4 },
  emptySubtitle: { fontSize: 12, textAlign: 'center', maxWidth: 260, lineHeight: 17 },
});

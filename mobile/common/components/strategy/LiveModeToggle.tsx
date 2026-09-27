import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';

export type AccountMode = 'live' | 'paper';

interface Props {
  mode: AccountMode;
  onChange: (mode: AccountMode) => void;
  /** Optional per-mode count badge (e.g. open positions, trades today). */
  counts?: { live: number; paper: number };
  colors: any;
}

/**
 * Shared LIVE/PAPER account switch — one segmented capsule (single border,
 * single track) with the active side rendered as an inset filled pill,
 * rather than two independently-bordered buttons sitting side by side.
 * Deliberately a different shape from a filter-chip row (e.g. tradelog.tsx's
 * time-range chips) — this is the one account-identity control, not one
 * filter among several, and shouldn't read as the same kind of control.
 *
 * Same visual pattern originally built for position.tsx, reused by
 * strategy.tsx and tradelog.tsx so all three screens decouple live vs.
 * paper identically.
 */
export function LiveModeToggle({ mode, onChange, counts, colors }: Props) {
  return (
    <View style={[styles.row, { borderBottomColor: colors.border }]}>
      <View style={[styles.track, { backgroundColor: colors.card, borderColor: colors.border }]}>
        {(['live', 'paper'] as const).map(m => {
          const isActive = mode === m;
          const accentClr = m === 'live' ? '#30D158' : '#FF9F0A';
          const count = counts ? (m === 'live' ? counts.live : counts.paper) : null;
          return (
            <TouchableOpacity
              key={m}
              onPress={() => onChange(m)}
              activeOpacity={0.8}
              style={[styles.segment, isActive && { backgroundColor: accentClr + '22' }]}
            >
              {m === 'live' && (
                <View style={[styles.dot, { backgroundColor: isActive ? '#30D158' : colors.textTertiary }]} />
              )}
              <Text style={[styles.segmentText, { color: isActive ? accentClr : colors.textTertiary }]}>
                {m === 'live' ? 'LIVE' : 'PAPER'}
              </Text>
              {!!count && count > 0 && (
                <View style={[styles.badge, { backgroundColor: isActive ? accentClr : colors.border }]}>
                  <Text style={[styles.badgeText, { color: isActive ? colors.accentForeground : colors.textSecondary }]}>
                    {count}
                  </Text>
                </View>
              )}
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  track: {
    flexDirection: 'row', alignSelf: 'flex-start',
    borderRadius: 12, borderWidth: 1, padding: 3,
  },
  segment: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 14, paddingVertical: 7, borderRadius: 9,
  },
  dot:      { width: 6, height: 6, borderRadius: 3 },
  segmentText: { fontSize: 12, fontWeight: '700', letterSpacing: 0.5 },
  badge:    { borderRadius: 8, paddingHorizontal: 6, paddingVertical: 1, minWidth: 18, alignItems: 'center' },
  badgeText:{ fontSize: 11, fontWeight: '700' },
});

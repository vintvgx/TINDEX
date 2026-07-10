import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useOrbHubHealth } from '@/hooks/queries/orb/useOrbHubHealth';

/**
 * Persistent warning when the shared ORB bar/breakout feed is down or stale.
 * Every strategy on this screen depends on this single feed — if it's dead,
 * "armed" strategy cards are cosmetic only, nothing will actually fire.
 * See 2026-07-09 incident: the feed silently died mid-session while every
 * strategy still looked healthy in the UI.
 */
export function OrbHubHealthBanner({ colors }: { colors: any }) {
  const { data } = useOrbHubHealth();

  if (!data || data.healthy) return null;

  const stale = data.running && data.market_hours;
  const message = stale
    ? `Live data feed appears stale (no bars in ${Math.round((data.seconds_since_last_bar ?? 0) / 60)}m) — strategies may not detect breakouts. Auto-recovery is running; check back shortly.`
    : 'Live data feed is not running — strategies cannot detect breakouts until it restarts.';

  return (
    <View style={[styles.banner, { backgroundColor: '#FF453A14', borderColor: '#FF453A55' }]}>
      <Ionicons name="warning" size={18} color="#FF453A" style={{ marginTop: 1 }} />
      <Text style={[styles.text, { color: colors.text }]}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    gap: 10,
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    marginBottom: 12,
  },
  text: {
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '500',
  },
});

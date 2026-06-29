import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { TickerTechnicals } from '@/hooks/queries/technicals/useTickerTechnicals';

const ZONE_CONFIG = {
  bullish:  { label: 'Bullish',  color: '#10B981', bg: '#064E3B' },
  extended: { label: 'Extended', color: '#F59E0B', bg: '#451A03' },
  neutral:  { label: 'Neutral',  color: '#94A3B8', bg: '#1E293B' },
  bearish:  { label: 'Bearish',  color: '#EF4444', bg: '#450A0A' },
};

interface Props {
  zone: TickerTechnicals['zone'];
  size?: 'sm' | 'md';
}

export function EMAZoneBadge({ zone, size = 'md' }: Props) {
  const cfg = ZONE_CONFIG[zone] ?? ZONE_CONFIG.neutral;
  return (
    <View style={[styles.badge, { backgroundColor: cfg.bg }, size === 'sm' && styles.sm]}>
      <View style={[styles.dot, { backgroundColor: cfg.color }]} />
      <Text style={[styles.label, { color: cfg.color }, size === 'sm' && styles.smText]}>
        {cfg.label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge:  { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, gap: 5 },
  sm:     { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  dot:    { width: 6, height: 6, borderRadius: 3 },
  label:  { fontSize: 12, fontWeight: '600', letterSpacing: 0.2 },
  smText: { fontSize: 10 },
});

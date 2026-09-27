import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

/**
 * Full-width Paper/Live banner + tint for the trade entry sheets. The old
 * Paper/Live segmented toggle alone was too easy to miss — this makes a
 * live-money sheet look unmistakably different from a paper one.
 */
export function accountModeColor(paperMode: boolean, colors: any): string {
  return paperMode ? colors.warning : colors.error;
}

export function AccountModeBanner({ paperMode, colors }: { paperMode: boolean; colors: any }) {
  const tint = accountModeColor(paperMode, colors);
  return (
    <View style={[s.banner, { backgroundColor: tint }]}>
      <Ionicons name={paperMode ? 'document-text-outline' : 'cash'} size={15} color="#fff" />
      <Text style={s.title}>{paperMode ? 'PAPER TRADING' : 'LIVE TRADING'}</Text>
      <Text style={s.sub}>{paperMode ? 'Simulated money — no real order' : 'Real money — real order'}</Text>
    </View>
  );
}

/** Absolute-fill wash behind the sheet content, in the mode's colour. */
export function AccountModeTint({ paperMode, colors }: { paperMode: boolean; colors: any }) {
  return (
    <View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, { backgroundColor: accountModeColor(paperMode, colors) + (paperMode ? '0A' : '14') }]}
    />
  );
}

const s = StyleSheet.create({
  banner: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 16, paddingVertical: 8 },
  title:  { color: '#fff', fontSize: 12.5, fontWeight: '800', letterSpacing: 0.8 },
  sub:    { color: '#fff', fontSize: 12, fontWeight: '500', opacity: 0.9, marginLeft: 'auto' },
});

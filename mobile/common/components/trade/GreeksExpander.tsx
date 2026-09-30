import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface Greeks {
  delta?: number | null;
  gamma?: number | null;
  theta?: number | null;
  vega?: number | null;
  rho?: number | null;
  implied_volatility?: number | null;
}

/** Robinhood-style "The Greeks" row — collapsed by default; Greeks aren't a pre-entry decision input. */
export function GreeksExpander({ greeks, colors }: { greeks: Greeks; colors: any }) {
  const [open, setOpen] = useState(false);
  const muted = colors.textSecondary ?? colors.tabBarInactive;
  const fmt = (v: number | null | undefined, d = 4) => (v == null ? '—' : v.toFixed(d));
  const items: [string, string][] = [
    ['Delta', fmt(greeks.delta)],
    ['Gamma', fmt(greeks.gamma)],
    ['Theta', fmt(greeks.theta)],
    ['Vega', fmt(greeks.vega)],
    ['Rho', fmt(greeks.rho)],
    ['Implied vol', greeks.implied_volatility == null ? '—' : `${(greeks.implied_volatility * 100).toFixed(1)}%`],
  ];

  return (
    <View style={[s.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <TouchableOpacity onPress={() => setOpen(o => !o)} activeOpacity={0.7} style={s.header}>
        <Text style={[s.title, { color: colors.text }]}>The Greeks</Text>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={16} color={muted} style={{ marginLeft: 'auto' }} />
      </TouchableOpacity>
      {open && (
        <View style={[s.grid, { borderTopColor: colors.border }]}>
          {items.map(([k, v]) => (
            <View key={k} style={s.cell}>
              <Text style={[s.k, { color: muted }]}>{k}</Text>
              <Text style={[s.v, { color: colors.text }]}>{v}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  card:   { borderRadius: 12, borderWidth: 1, overflow: 'hidden' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 12 },
  title:  { fontSize: 14, fontWeight: '600' },
  grid:   { flexDirection: 'row', flexWrap: 'wrap', borderTopWidth: StyleSheet.hairlineWidth, paddingVertical: 6 },
  cell:   { width: '33.33%', paddingHorizontal: 14, paddingVertical: 6 },
  k:      { fontSize: 11 },
  v:      { fontSize: 13.5, fontWeight: '600', marginTop: 2 },
});

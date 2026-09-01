import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

export interface ChartToggleConfig {
  key: string;
  /** Icon shown always — color communicates on/off, not a different glyph. */
  icon: keyof typeof Ionicons.glyphMap;
  active: boolean;
  onPress: () => void;
  /** Shown only in the ⓘ explainer, never on the button itself — icon-only
   *  buttons are the whole point (see the "taking up too much space" ask). */
  label: string;
  description: string;
}

interface Props {
  toggles: ChartToggleConfig[];
  colors: any;
}

/**
 * Icon-only chart toggle row + a single ⓘ button that explains what each
 * one does. Used above both the Charts tab and the full-screen chart, so the
 * meaning of "Data Points"/"S/R" etc. lives in exactly one place. The
 * explainer renders as a plain absolutely-positioned overlay, NOT a native
 * Modal — this component gets used from inside PriceChartFullScreen, which
 * is already a Modal itself, and RN only reliably presents one Modal at a
 * time (see TradeContractQuickCard for the same pattern/reasoning).
 */
export function ChartControlToggles({ toggles, colors }: Props) {
  const [infoOpen, setInfoOpen] = useState(false);

  return (
    <>
      <View style={s.row}>
        {toggles.map((t) => (
          <Pressable
            key={t.key}
            onPress={t.onPress}
            hitSlop={8}
            style={[
              s.iconBtn,
              {
                borderColor: t.active ? colors.accent : colors.separator,
                backgroundColor: t.active ? colors.accent + '18' : 'transparent',
              },
            ]}
          >
            <Ionicons name={t.icon} size={15} color={t.active ? colors.accent : colors.textTertiary} />
          </Pressable>
        ))}
        <Pressable onPress={() => setInfoOpen(true)} hitSlop={8} style={[s.iconBtn, { borderColor: colors.separator }]}>
          <Ionicons name="information-circle-outline" size={16} color={colors.textTertiary} />
        </Pressable>
      </View>

      {infoOpen && (
        <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
          <Pressable style={[StyleSheet.absoluteFill, s.backdrop]} onPress={() => setInfoOpen(false)} />
          <View style={s.centerWrap} pointerEvents="box-none">
            <View style={[s.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={s.cardHeader}>
                <Text style={[s.cardTitle, { color: colors.text }]}>Chart Controls</Text>
                <Pressable onPress={() => setInfoOpen(false)} hitSlop={8}>
                  <Ionicons name="close" size={20} color={colors.textSecondary} />
                </Pressable>
              </View>
              {toggles.map((t) => (
                <View key={t.key} style={s.explainerRow}>
                  <View style={[s.explainerIcon, { backgroundColor: colors.accent + '14' }]}>
                    <Ionicons name={t.icon} size={15} color={colors.accent} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Text style={[s.explainerLabel, { color: colors.text }]}>{t.label}</Text>
                      <Text style={{ color: t.active ? colors.success : colors.textTertiary, fontSize: 10, fontWeight: '700' }}>
                        {t.active ? 'ON' : 'OFF'}
                      </Text>
                    </View>
                    <Text style={[s.explainerDesc, { color: colors.textSecondary }]}>{t.description}</Text>
                  </View>
                </View>
              ))}
            </View>
          </View>
        </View>
      )}
    </>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
  iconBtn: {
    width: 30, height: 30, borderRadius: 15, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
  },
  backdrop: { backgroundColor: '#000', opacity: 0.5 },
  centerWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 },
  card: { width: '100%', maxWidth: 360, borderRadius: 16, borderWidth: 1, padding: 18, gap: 14 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 },
  cardTitle: { fontSize: 16, fontWeight: '700' },
  explainerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  explainerIcon: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  explainerLabel: { fontSize: 13.5, fontWeight: '700' },
  explainerDesc: { fontSize: 12, lineHeight: 16, marginTop: 2 },
});

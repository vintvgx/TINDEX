import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView, Switch, Modal } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

type IconName = keyof typeof Ionicons.glyphMap;

export type ChartSettingRow =
  | { kind: 'toggle'; key: string; icon: IconName; label: string; description?: string; value: boolean; onChange: (v: boolean) => void; color?: string }
  | { kind: 'segment'; key: string; label: string; value: string; options: { value: string; label: string; icon?: IconName }[]; onChange: (v: string) => void }
  | { kind: 'action'; key: string; icon: IconName; label: string; description?: string; onPress: () => void };

export interface ChartSettingsSection {
  title: string;
  rows: ChartSettingRow[];
}

interface Props {
  sections: ChartSettingsSection[];
  colors: any;
  /** Body of the Technicals modal (the signal/Trend/RSI/VWAP/ORB readout). */
  technicals: React.ReactNode;
  /** Lets the caller fetch technicals only while that modal is open. */
  onTechnicalsOpenChange?: (open: boolean) => void;
  /** Body of the Options Positioning modal (same section as the ticker
   *  sheet). The button only shows when this is passed. */
  positioning?: React.ReactNode;
}

type OpenSheet = 'technicals' | 'positioning' | 'settings' | null;

/**
 * The chart's header buttons: Technicals readout, Options Positioning (when
 * `positioning` is passed), and the chart-settings modal holding every display option (style,
 * technicals overlays, session lines, watch levels, data points…) instead
 * of a row of icon buttons above the chart. Each renders in a transparent
 * native Modal so it's centered on the whole screen — an absoluteFill
 * overlay would be clipped to the small header row these buttons sit in.
 * Inside PriceChartFullScreen it's a Modal nested in that Modal's content
 * (presented on top of it), which RN supports; only sibling Modals are
 * unreliable.
 */
export function ChartControlToggles({ sections, colors, technicals, onTechnicalsOpenChange, positioning }: Props) {
  const [openSheet, setOpenSheetState] = useState<OpenSheet>(null);
  const setOpenSheet = (v: OpenSheet) => {
    setOpenSheetState(v);
    onTechnicalsOpenChange?.(v === 'technicals');
  };
  const close = () => setOpenSheet(null);

  return (
    <>
      <View style={s.row}>
        <Pressable onPress={() => setOpenSheet('technicals')} hitSlop={8} style={[s.iconBtn, { borderColor: colors.separator }]}>
          <Ionicons name="pulse-outline" size={16} color={colors.textTertiary} />
        </Pressable>
        {positioning ? (
          <Pressable
            onPress={() => setOpenSheet('positioning')}
            hitSlop={8}
            style={[s.iconBtn, { borderColor: colors.separator }]}
            accessibilityLabel="Options positioning"
          >
            <Ionicons name="bar-chart-outline" size={15} color={colors.textTertiary} />
          </Pressable>
        ) : null}
        <Pressable onPress={() => setOpenSheet('settings')} hitSlop={8} style={[s.iconBtn, { borderColor: colors.separator }]}>
          <Ionicons name="options-outline" size={16} color={colors.textTertiary} />
        </Pressable>
      </View>

      <CenteredSheet visible={openSheet === 'technicals'} title="Technicals" onClose={close} colors={colors}>
        {technicals}
      </CenteredSheet>

      {positioning ? (
        <CenteredSheet visible={openSheet === 'positioning'} title="Options Positioning" onClose={close} colors={colors}>
          {positioning}
        </CenteredSheet>
      ) : null}

      <CenteredSheet visible={openSheet === 'settings'} title="Chart settings" onClose={close} colors={colors}>
        {sections.map(section => (
          <View key={section.title} style={{ gap: 10 }}>
            <Text style={[s.sectionTitle, { color: colors.textTertiary }]}>{section.title.toUpperCase()}</Text>
            {section.rows.map(row => (
              <SettingRow key={row.key} row={row} colors={colors} onAction={close} />
            ))}
          </View>
        ))}
      </CenteredSheet>
    </>
  );
}

function CenteredSheet({ visible, title, onClose, colors, children }: {
  visible: boolean; title: string; onClose: () => void; colors: any; children: React.ReactNode;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
        <Pressable style={[StyleSheet.absoluteFill, s.backdrop]} onPress={onClose} />
        <View style={s.centerWrap} pointerEvents="box-none">
          <View style={[s.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={s.cardHeader}>
              <Text style={[s.cardTitle, { color: colors.text }]}>{title}</Text>
              <Pressable onPress={onClose} hitSlop={8}>
                <Ionicons name="close" size={20} color={colors.textSecondary} />
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={{ gap: 16, paddingBottom: 4 }} showsVerticalScrollIndicator={false} bounces={false}>
              {children}
            </ScrollView>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function SettingRow({ row, colors, onAction }: { row: ChartSettingRow; colors: any; onAction: () => void }) {
  const muted = colors.textSecondary;

  if (row.kind === 'segment') {
    return (
      <View style={s.rowLine}>
        <Text style={[s.rowLabel, { color: colors.text, flex: 1 }]}>{row.label}</Text>
        <View style={[s.segment, { borderColor: colors.border, backgroundColor: colors.surface }]}>
          {row.options.map(o => {
            const active = o.value === row.value;
            return (
              <Pressable
                key={o.value}
                onPress={() => row.onChange(o.value)}
                style={[s.segmentBtn, active && { backgroundColor: colors.accent + '22' }]}
              >
                {o.icon ? <Ionicons name={o.icon} size={13} color={active ? colors.accent : colors.textTertiary} /> : null}
                <Text style={{ fontSize: 12, fontWeight: '700', color: active ? colors.accent : colors.textTertiary }}>{o.label}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    );
  }

  if (row.kind === 'action') {
    return (
      <Pressable
        onPress={() => { onAction(); row.onPress(); }}
        style={[s.actionBtn, { borderColor: colors.accent + '55', backgroundColor: colors.accent + '12' }]}
      >
        <Ionicons name={row.icon} size={16} color={colors.accent} />
        <View style={{ flex: 1 }}>
          <Text style={[s.rowLabel, { color: colors.accent }]}>{row.label}</Text>
          {row.description ? <Text style={[s.rowDesc, { color: muted }]}>{row.description}</Text> : null}
        </View>
        <Ionicons name="chevron-forward" size={15} color={colors.accent} />
      </Pressable>
    );
  }

  return (
    <View style={s.rowLine}>
      <View style={[s.rowIcon, { backgroundColor: colors.accent + '14' }]}>
        <Ionicons name={row.icon} size={14} color={colors.accent} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[s.rowLabel, { color: colors.text }]}>{row.label}</Text>
        {row.description ? <Text style={[s.rowDesc, { color: muted }]}>{row.description}</Text> : null}
      </View>
      <Switch
        value={row.value}
        onValueChange={row.onChange}
        thumbColor={row.value ? '#30D158' : '#ccc'}
        trackColor={{ true: '#30D15855', false: colors.border }}
      />
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
  iconBtn: {
    width: 30, height: 30, borderRadius: 15, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
  },
  backdrop: { backgroundColor: '#000', opacity: 0.5 },
  centerWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 },
  card: { width: '100%', maxWidth: 400, maxHeight: '86%', borderRadius: 16, borderWidth: 1, padding: 18, gap: 12 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardTitle: { fontSize: 17, fontWeight: '800' },
  sectionTitle: { fontSize: 11, fontWeight: '700', letterSpacing: 0.6 },

  rowLine: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  rowIcon: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  rowLabel: { fontSize: 13.5, fontWeight: '600' },
  rowDesc: { fontSize: 11.5, lineHeight: 15, marginTop: 1 },

  segment: { flexDirection: 'row', borderRadius: 9, borderWidth: 1, padding: 2 },
  segmentBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 7 },

  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 10, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10 },
});

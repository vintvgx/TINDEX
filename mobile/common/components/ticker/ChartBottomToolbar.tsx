import React, { useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, Switch, Modal, KeyboardAvoidingView, Platform, StatusBar } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors } from '@/lib/useColorScheme';
import { TickerWheel } from './TickerWheel';
import { PeriodSlider } from './PeriodSlider';
import { ChartBottomSheet } from './ChartBottomSheet';
import { ImmediateTradePanel } from '@/common/components/strategy/ImmediateTradePanel';
import type { PricePeriod } from '@/common/types/blogPosts/ticker';
import type { ChartSettingsSection } from './ChartControlToggles';

type IconName = keyof typeof Ionicons.glyphMap;

interface ToolButton {
  key: string;
  icon: IconName;
  label: string;
  onPress: () => void;
  accent?: boolean;
  badge?: number;
}

/**
 * ChartBottomToolbar — TradingView-style bottom bar for the Charts tab.
 * Fixed left: ticker wheel + period slider (unaffected by scrolling).
 * Scrollable right: Trade, Technicals, Options Positioning, Open Positions,
 * Chart Settings, Contracts. Technicals/Positioning/Settings open bottom
 * sheets; Trade opens the immediate-trade panel.
 */
export function ChartBottomToolbar({
  tickers,
  activeTicker,
  onSelectTicker,
  onSearchPress,
  period,
  onPeriodChange,
  technicalsContent,
  positioningContent,
  settingsSections,
  onContractsPress,
  onPositionsPress,
  openPositionCount,
}: {
  tickers: string[];
  activeTicker: string;
  onSelectTicker: (t: string) => void;
  onSearchPress: () => void;
  period: PricePeriod;
  onPeriodChange: (p: PricePeriod) => void;
  technicalsContent: React.ReactNode;
  positioningContent: React.ReactNode;
  settingsSections: ChartSettingsSection[];
  onContractsPress: () => void;
  onPositionsPress: () => void;
  openPositionCount: number;
}) {
  const colors = useThemeColors();
  const [sheet, setSheet] = useState<'technicals' | 'positioning' | 'settings' | null>(null);
  const [tradeOpen, setTradeOpen] = useState(false);

  const buttons: ToolButton[] = [
    { key: 'trade', icon: 'flash', label: 'Trade', onPress: () => setTradeOpen(true), accent: true },
    { key: 'technicals', icon: 'pulse-outline', label: 'Technicals', onPress: () => setSheet('technicals') },
    { key: 'positioning', icon: 'bar-chart-outline', label: 'Positioning', onPress: () => setSheet('positioning') },
    { key: 'positions', icon: 'briefcase-outline', label: 'Positions', onPress: onPositionsPress, badge: openPositionCount || undefined },
    { key: 'settings', icon: 'options-outline', label: 'Settings', onPress: () => setSheet('settings') },
    { key: 'contracts', icon: 'layers-outline', label: 'Contracts', onPress: onContractsPress },
  ];

  return (
    <>
      <View style={[s.bar, { backgroundColor: colors.background, borderTopColor: colors.separator }]}>
        {/* Fixed left — ticker wheel + period slider, never scrolls away */}
        <View style={s.fixed}>
          <TickerWheel
            tickers={tickers}
            activeTicker={activeTicker}
            onSelect={onSelectTicker}
            onSearchPress={onSearchPress}
          />
          <PeriodSlider period={period} onChange={onPeriodChange} />
        </View>
        <View style={[s.divider, { backgroundColor: colors.separator }]} />
        {/* Scrollable tool buttons */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={s.scrollContent}
          style={{ flex: 1 }}
        >
          {buttons.map(b => (
            <Pressable
              key={b.key}
              onPress={b.onPress}
              hitSlop={6}
              style={({ pressed }) => [
                s.toolBtn,
                { opacity: pressed ? 0.6 : 1 },
              ]}
              accessibilityRole="button"
              accessibilityLabel={b.label}
            >
              <View style={{ position: 'relative' }}>
                <Ionicons
                  name={b.icon}
                  size={21}
                  color={b.accent ? colors.accent : colors.textSecondary}
                />
                {b.badge ? (
                  <View style={[s.badge, { backgroundColor: colors.accent }]}>
                    <Text style={[s.badgeText, { color: colors.accentForeground }]}>{b.badge}</Text>
                  </View>
                ) : null}
              </View>
              <Text style={[s.toolLabel, { color: b.accent ? colors.accent : colors.textSecondary }]}>
                {b.label}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      <ChartBottomSheet visible={sheet === 'technicals'} title="Technicals" onClose={() => setSheet(null)}>
        {technicalsContent}
      </ChartBottomSheet>

      <ChartBottomSheet visible={sheet === 'positioning'} title="Options Positioning" onClose={() => setSheet(null)}>
        {positioningContent}
      </ChartBottomSheet>

      <ChartBottomSheet visible={sheet === 'settings'} title="Chart settings" onClose={() => setSheet(null)}>
        {settingsSections.map(section => (
          <View key={section.title} style={{ gap: 10 }}>
            <Text style={[s.sectionTitle, { color: colors.textTertiary }]}>{section.title.toUpperCase()}</Text>
            {section.rows.map(row => (
              <SettingsRow key={row.key} row={row} colors={colors} />
            ))}
          </View>
        ))}
      </ChartBottomSheet>

      {/* Immediate trade — moved here from the old global AppHeader */}
      <Modal
        visible={tradeOpen}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setTradeOpen(false)}
      >
        <StatusBar barStyle="light-content" />
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={{ flex: 1, backgroundColor: colors.background }}
        >
          <View style={[s.panelHeader, { borderBottomColor: colors.border }]}>
            <Pressable onPress={() => setTradeOpen(false)} hitSlop={12} style={{ width: 64 }}>
              <Text style={{ fontSize: 15, fontWeight: '600', color: colors.accent }}>Close</Text>
            </Pressable>
            <Text style={{ fontSize: 17, fontWeight: '700', color: colors.text }}>Immediate Trade</Text>
            <View style={{ width: 64 }} />
          </View>
          <ImmediateTradePanel
            colors={colors}
            tickerOptions={tickers}
            visible={tradeOpen}
            onClose={() => setTradeOpen(false)}
          />
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}

/** Minimal settings-row renderer for phase 1 — phase 2 replaces this whole
 *  sheet with the Analysis-hub-style redesign. */
function SettingsRow({ row, colors }: { row: ChartSettingsSection['rows'][number]; colors: any }) {
  if (row.kind === 'toggle') {
    return (
      <View style={s.rowLine}>
        <View style={[s.rowIcon, { backgroundColor: colors.accent + '14' }]}>
          <Ionicons name={row.icon} size={14} color={colors.accent} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[s.rowLabel, { color: colors.text }]}>{row.label}</Text>
          {row.description ? <Text style={[s.rowDesc, { color: colors.textSecondary }]}>{row.description}</Text> : null}
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
                <Text style={{ fontSize: 12, fontWeight: '700', color: active ? colors.accent : colors.textTertiary }}>
                  {o.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    );
  }
  return (
    <Pressable onPress={row.onPress} style={s.rowLine}>
      <View style={[s.rowIcon, { backgroundColor: colors.accent + '14' }]}>
        <Ionicons name={row.icon} size={14} color={colors.accent} />
      </View>
      <Text style={[s.rowLabel, { color: colors.text, flex: 1 }]}>{row.label}</Text>
      <Ionicons name="chevron-forward" size={15} color={colors.textTertiary} />
    </Pressable>
  );
}

const s = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingVertical: 8,
    paddingLeft: 10,
    minHeight: 76,
  },
  fixed: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  divider: {
    width: StyleSheet.hairlineWidth,
    alignSelf: 'stretch',
    marginHorizontal: 10,
    marginVertical: 4,
  },
  scrollContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingRight: 12,
  },
  toolBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    paddingHorizontal: 11,
    paddingVertical: 4,
    minWidth: 62,
  },
  toolLabel: {
    fontSize: 10,
    fontWeight: '600',
  },
  badge: {
    position: 'absolute',
    top: -6,
    right: -10,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '800',
  },
  sectionTitle: { fontSize: 11, fontWeight: '700', letterSpacing: 0.6 },
  rowLine: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  rowIcon: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  rowLabel: { fontSize: 13.5, fontWeight: '600' },
  rowDesc: { fontSize: 11.5, lineHeight: 15, marginTop: 1 },
  segment: { flexDirection: 'row', borderRadius: 9, borderWidth: 1, padding: 2 },
  segmentBtn: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 7 },
  panelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});

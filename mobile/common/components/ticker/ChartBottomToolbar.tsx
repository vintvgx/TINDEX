import React, { useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, Switch } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors } from '@/lib/useColorScheme';
import { TickerWheel, type TickerStatus } from './TickerWheel';
import { TimeframeChips } from './TimeframeChips';
import { ChartBottomSheet } from './ChartBottomSheet';
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
 * Fixed left: ticker wheel + date-range / bar-size chips (unaffected by
 * scrolling). Scrollable right, icon-only: Technicals, Options
 * Positioning, Open Positions, Chart Settings. Technicals/Positioning/
 * Settings open bottom sheets.
 * (Contracts moved to the ticker tape's signal pill.)
 */
export function ChartBottomToolbar({
  tickers,
  activeTicker,
  onSelectTicker,
  onSearchPress,
  period,
  onPeriodChange,
  interval,
  allowedIntervals,
  onIntervalChange,
  technicalsContent,
  positioningContent,
  settingsSections,
  onPositionsPress,
  openPositionCount,
  tickerStatus,
}: {
  tickers: string[];
  activeTicker: string;
  onSelectTicker: (t: string) => void;
  onSearchPress: () => void;
  period: PricePeriod;
  onPeriodChange: (p: PricePeriod) => void;
  interval: string;
  allowedIntervals: string[];
  onIntervalChange: (i: string) => void;
  technicalsContent: React.ReactNode;
  positioningContent: React.ReactNode;
  settingsSections: ChartSettingsSection[];
  onPositionsPress: () => void;
  openPositionCount: number;
  /** Per-ticker position/watch state for the wheel's letter badges. */
  tickerStatus?: Record<string, TickerStatus>;
}) {
  const colors = useThemeColors();
  const [sheet, setSheet] = useState<'technicals' | 'positioning' | 'settings' | null>(null);

  const buttons: ToolButton[] = [
    { key: 'technicals', icon: 'pulse-outline', label: 'Technicals', onPress: () => setSheet('technicals') },
    { key: 'positioning', icon: 'bar-chart-outline', label: 'Positioning', onPress: () => setSheet('positioning') },
    { key: 'positions', icon: 'briefcase-outline', label: 'Positions', onPress: onPositionsPress, badge: openPositionCount || undefined },
    { key: 'settings', icon: 'options-outline', label: 'Settings', onPress: () => setSheet('settings') },
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
            status={tickerStatus}
          />
          <TimeframeChips
            period={period}
            onPeriodChange={onPeriodChange}
            interval={interval}
            allowedIntervals={allowedIntervals}
            onIntervalChange={onIntervalChange}
          />
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
              hitSlop={4}
              style={({ pressed }) => [
                s.toolBtn,
                {
                  backgroundColor: pressed ? colors.surfaceSecondary : 'transparent',
                },
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

    </>
  );
}

/** Minimal settings-row renderer for phase 1 — phase 2 replaces this whole
 *  sheet with the Analysis-hub-style redesign. */
function SettingsRow({ row, colors }: { row: ChartSettingsSection['rows'][number]; colors: any }) {
  if (row.kind === 'toggle') {
    const accent = row.color ?? colors.accent;
    return (
      <View style={s.rowLine}>
        <View style={[s.rowIcon, { backgroundColor: accent + '14' }]}>
          <Ionicons name={row.icon} size={14} color={accent} />
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
    // More than 3 options (e.g. the 7 date ranges) won't fit beside the
    // label — stack the label above a full-width, wrapping segment.
    const stacked = row.options.length > 3;
    return (
      <View style={stacked ? { gap: 6 } : s.rowLine}>
        <Text style={[s.rowLabel, { color: colors.text }, !stacked && { flex: 1 }]}>{row.label}</Text>
        <View style={[s.segment, stacked && { flexWrap: 'wrap', alignSelf: 'stretch' }, { borderColor: colors.border, backgroundColor: colors.surface }]}>
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
    paddingVertical: 5,
    paddingLeft: 10,
  },
  // Generous gaps so the wheel and the two timeframe labels never
  // steal each other's touches; the tool buttons scroll, so they give up
  // the width.
  fixed: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 18,
  },
  divider: {
    width: StyleSheet.hairlineWidth,
    alignSelf: 'stretch',
    marginHorizontal: 10,
    marginVertical: 4,
  },
  // Icon-only buttons spread across whatever width is left; if it ever
  // runs out they still scroll.
  scrollContent: {
    flexGrow: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-evenly',
    gap: 4,
    paddingRight: 8,
    // Room for the Positions count badge (sits 6px above its icon) — the
    // ScrollView clips anything outside its content box.
    paddingVertical: 8,
  },
  toolBtn: {
    width: 40,
    height: 40,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
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
});

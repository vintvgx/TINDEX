import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Switch } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors } from '@/lib/useColorScheme';
import { TickerWheel, type TickerStatus } from './TickerWheel';
import { IntervalWheel } from './IntervalWheel';
import { TickerSwitcherContent } from './TickerSwitcherContent';
import { PressableStyled } from './PressableStyled';
import { ChartBottomSheet } from './ChartBottomSheet';
import type { PricePeriod } from '@/common/types/blogPosts/ticker';
import type { ChartSettingsSection } from './ChartControlToggles';
import TickerSheetService from '@/common/services/TickerSheetService';

type IconName = keyof typeof Ionicons.glyphMap;
type SheetKind = 'technicals' | 'positioning' | 'settings' | 'more' | 'switcher';

/** iOS drops a modal presented while another is still animating closed —
 *  wait this long after closing a sheet before presenting the next one
 *  (same as charts.tsx reviewEntryFromTechnicals). */
const MODAL_HANDOFF_MS = 350;

const PILL_H = 52;
const PILL_BOTTOM = 8;
/** Vertical footprint of the floating pill row (pill + its bottom offset,
 *  no extra room — close to 0.7's ~51px strip). The chart area pads its
 *  plot by this much so the time axis and newest candles stay visible
 *  above the pills, while the area's background still runs underneath. */
export const CHART_PILLS_CLEARANCE = PILL_H + PILL_BOTTOM;

interface ToolButton {
  key: string;
  icon: IconName;
  label: string;
  onPress: () => void;
}

/**
 * ChartBottomToolbar — two floating pills over the bottom of the chart
 * (the caller renders this inside the chart area; the pill row is
 * absolutely positioned there).
 *
 * - TickerPill (left): TickerWheel (endless loop, tap = search) and
 *   IntervalWheel (clamped to the period's intervals) side by side. Press
 *   and hold either wheel — or tap the interval wheel — for the
 *   TickerSwitcherSheet (one sideways row of tickers + period/interval).
 * - ToolsPill (right): Technicals, Positioning, Settings — each opens its
 *   bottom sheet — and More (Positions, Follow, Info).
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
  isFollowed,
  onToggleFollow,
  openPositionCount,
  tickerStatus,
  bottomInset: _bottomInset = 0,
  technicalsOpen,
  onTechnicalsOpenChange,
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
  /** Whether the active ticker is followed (in the chart list via follow). */
  isFollowed: boolean;
  /** Follow row (More sheet): follow / unfollow the active ticker. */
  onToggleFollow: () => void;
  /** Per-ticker position/watch state for the wheel's letter badges. */
  tickerStatus?: Record<string, TickerStatus>;
  /** Unused since 0.8 — the pills float over the chart, clear of the home
   *  indicator. Still accepted so callers don't break. */
  bottomInset?: number;
  /** Optional control of the Technicals sheet, so the caller can open it
   *  (strip chips) and close it (Review Entry). Uncontrolled when omitted. */
  technicalsOpen?: boolean;
  onTechnicalsOpenChange?: (open: boolean) => void;
}) {
  const colors = useThemeColors();
  const [sheet, setSheetState] = useState<SheetKind | null>(null);
  const techControlled = technicalsOpen !== undefined;
  const techVisible = techControlled ? technicalsOpen : sheet === 'technicals';
  const setSheet = (v: SheetKind | null) => {
    if (techControlled) {
      onTechnicalsOpenChange?.(v === 'technicals');
      setSheetState(v === 'technicals' ? null : v);
    } else {
      setSheetState(v);
    }
  };
  const closeSheet = () => setSheet(null);

  // Close the current sheet, then run an action that presents another
  // modal once the dismiss animation is done.
  const handoff = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (handoff.current) clearTimeout(handoff.current); }, []);
  const closeThen = (action: () => void) => {
    closeSheet();
    if (handoff.current) clearTimeout(handoff.current);
    handoff.current = setTimeout(action, MODAL_HANDOFF_MS);
  };

  const openSwitcher = useCallback(() => {
    if (techControlled) onTechnicalsOpenChange?.(false);
    setSheetState('switcher');
  }, [techControlled, onTechnicalsOpenChange]);

  const buttons: ToolButton[] = [
    { key: 'technicals', icon: 'pulse-outline', label: 'Technicals', onPress: () => setSheet('technicals') },
    { key: 'positioning', icon: 'bar-chart-outline', label: 'Positioning', onPress: () => setSheet('positioning') },
    { key: 'settings', icon: 'options-outline', label: 'Settings', onPress: () => setSheet('settings') },
    { key: 'more', icon: 'ellipsis-horizontal', label: 'More', onPress: () => setSheet('more') },
  ];

  return (
    <>
      <View style={s.row} pointerEvents="box-none">
        {/* TickerPill — ticker wheel + interval wheel, an even split */}
        <View style={[s.pill, s.tickerPill, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <TickerWheel
            tickers={tickers}
            activeTicker={activeTicker}
            onSelect={onSelectTicker}
            onSearchPress={onSearchPress}
            onLongPress={openSwitcher}
            status={tickerStatus}
            variant="pill"
          />
          <IntervalWheel
            intervals={allowedIntervals}
            interval={interval}
            onIntervalChange={onIntervalChange}
            onPress={openSwitcher}
            onLongPress={openSwitcher}
          />
        </View>

        {/* ToolsPill */}
        <View
          style={[s.pill, s.toolsPill, { backgroundColor: colors.surface, borderColor: colors.border }]}
          accessibilityRole="toolbar"
          accessibilityLabel="Chart tools"
        >
          {buttons.map(b => (
            <PressableStyled
              key={b.key}
              onPress={b.onPress}
              hitSlop={4}
              style={[s.toolBtn, { backgroundColor: 'transparent' }]}
              pressedStyle={{ backgroundColor: colors.surfaceSecondary }}
              accessibilityRole="button"
              accessibilityLabel={b.label}
            >
              <Ionicons name={b.icon} size={21} color={colors.textSecondary} />
            </PressableStyled>
          ))}
        </View>
      </View>

      <ChartBottomSheet visible={techVisible} title="Technicals" onClose={closeSheet}>
        {technicalsContent}
      </ChartBottomSheet>

      <ChartBottomSheet visible={sheet === 'positioning'} title="Options Positioning" onClose={closeSheet}>
        {positioningContent}
      </ChartBottomSheet>

      <ChartBottomSheet visible={sheet === 'settings'} title="Chart settings" onClose={closeSheet}>
        {settingsSections.map(section => (
          <View key={section.title} style={{ gap: 10 }}>
            <Text style={[s.sectionTitle, { color: colors.textTertiary }]}>{section.title.toUpperCase()}</Text>
            {section.rows.map(row => (
              <SettingsRow key={row.key} row={row} colors={colors} />
            ))}
          </View>
        ))}
      </ChartBottomSheet>

      {/* MoreSheet */}
      <ChartBottomSheet visible={sheet === 'more'} title={`${activeTicker} · More`} onClose={closeSheet}>
        <View>
          <MoreRow
            icon="briefcase-outline"
            label="Positions"
            accessibilityLabel="Positions"
            colors={colors}
            // Not a modal (expands the position strip in place) — just
            // close the sheet so the strip is visible.
            onPress={() => { closeSheet(); onPositionsPress(); }}
            trailing={openPositionCount ? (
              <View style={[s.count, { backgroundColor: colors.text }]}>
                <Text style={[s.countText, { color: colors.background }]}>{openPositionCount}</Text>
              </View>
            ) : (
              <Text style={[s.hint, { color: colors.textTertiary }]}>None open</Text>
            )}
          />
          <MoreRow
            icon={isFollowed ? 'star' : 'star-outline'}
            iconColor={isFollowed ? colors.warning : undefined}
            label={`${isFollowed ? 'Unfollow' : 'Follow'} ${activeTicker}`}
            accessibilityLabel={isFollowed ? `Unfollow ${activeTicker}` : `Follow ${activeTicker}`}
            colors={colors}
            // Toggles in place — the star turns gold / clears right here.
            onPress={onToggleFollow}
          />
          <MoreRow
            icon="information-circle-outline"
            label={`${activeTicker} info`}
            accessibilityLabel={`${activeTicker} info`}
            colors={colors}
            last
            // The ticker's detail sheet is a native modal — present it only
            // after this sheet has finished closing.
            onPress={() => {
              const t = activeTicker;
              if (!t) return;
              closeThen(() => TickerSheetService.getInstance().open(t));
            }}
            trailing={<Ionicons name="chevron-forward" size={15} color={colors.textTertiary} />}
          />
        </View>
      </ChartBottomSheet>

      {/* TickerSwitcherSheet */}
      <ChartBottomSheet visible={sheet === 'switcher'} title="Tickers & timeframe" onClose={closeSheet}>
        <TickerSwitcherContent
          tickers={tickers}
          activeTicker={activeTicker}
          onSelectTicker={onSelectTicker}
          // Search is its own modal — hand off after this sheet closes.
          onSearchPress={() => closeThen(onSearchPress)}
          period={period}
          onPeriodChange={onPeriodChange}
          interval={interval}
          allowedIntervals={allowedIntervals}
          onIntervalChange={onIntervalChange}
          colors={colors}
        />
      </ChartBottomSheet>
    </>
  );
}

/** One row of the More sheet. */
function MoreRow({ icon, iconColor, label, accessibilityLabel, onPress, trailing, last, colors }: {
  icon: IconName;
  iconColor?: string;
  label: string;
  accessibilityLabel: string;
  onPress: () => void;
  trailing?: React.ReactNode;
  last?: boolean;
  colors: any;
}) {
  return (
    <PressableStyled
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={[
        s.moreRow,
        !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.separator },
      ]}
      pressedStyle={{ opacity: 0.6 }}
    >
      <View style={[s.moreIcon, { backgroundColor: colors.surfaceSecondary }]}>
        <Ionicons name={icon} size={18} color={iconColor ?? colors.textSecondary} />
      </View>
      <Text style={[s.moreLabel, { color: colors.text }]} numberOfLines={1}>{label}</Text>
      {trailing}
    </PressableStyled>
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
  // The pill row floats over the bottom of the chart area (the caller
  // renders the toolbar inside it).
  row: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: PILL_BOTTOM,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  // Both pills flex: 1 → an even 50/50 split.
  pill: {
    flex: 1,
    minWidth: 0,
    height: PILL_H,
    borderRadius: 28,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.16,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  tickerPill: {
    paddingHorizontal: 6,
  },
  toolsPill: {
    paddingHorizontal: 4,
    justifyContent: 'space-evenly',
  },
  toolBtn: {
    width: 40,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // More sheet
  moreRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 4 },
  moreIcon: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  moreLabel: { flex: 1, fontSize: 14.5, fontWeight: '600' },
  count: { minWidth: 22, height: 20, borderRadius: 10, paddingHorizontal: 7, alignItems: 'center', justifyContent: 'center' },
  countText: { fontSize: 12, fontWeight: '800' },
  hint: { fontSize: 12 },
  sectionTitle: { fontSize: 11, fontWeight: '700', letterSpacing: 0.6 },
  rowLine: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  rowIcon: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  rowLabel: { fontSize: 13.5, fontWeight: '600' },
  rowDesc: { fontSize: 11.5, lineHeight: 15, marginTop: 1 },
  segment: { flexDirection: 'row', borderRadius: 9, borderWidth: 1, padding: 2 },
  segmentBtn: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 7 },
});

import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useThemeColors } from '@/lib/useColorScheme';
import { INTERVAL_LABEL } from '@/lib/chartIntervals';
import type { PricePeriod } from '@/common/types/blogPosts/ticker';

export const PERIOD_STOPS: PricePeriod[] = ['1D', '1W', '1M', '3M', 'YTD', '1Y', '5Y'];

/** Bar sizes the interval chip steps through, in order. A period only
 *  offers the ones its data supports (see ALLOWED_INTERVALS); periods with
 *  none of these (3M+) fall back to their own daily/weekly choices. */
const INTERVAL_CYCLE = ['1m', '5m', '15m', '30m', '1h'];

export function intervalCycleFor(allowed: string[]): string[] {
  const intraday = INTERVAL_CYCLE.filter(i => allowed.includes(i));
  return intraday.length ? intraday : allowed;
}

/**
 * TimeframeChips — two side-by-side tap-to-cycle chips for the chart
 * toolbar, [1D] [15m]: date range (1D → 1W → … → 5Y → 1D) and bar size (1m → 5m → 15m → 30m →
 * 1h → 1m). Long-press steps backwards.
 */
export function TimeframeChips({
  period,
  onPeriodChange,
  interval,
  allowedIntervals,
  onIntervalChange,
}: {
  period: PricePeriod;
  onPeriodChange: (p: PricePeriod) => void;
  interval: string;
  allowedIntervals: string[];
  onIntervalChange: (i: string) => void;
}) {
  const colors = useThemeColors();
  const intervals = intervalCycleFor(allowedIntervals);

  const step = <T,>(list: T[], current: T, dir: 1 | -1): T => {
    const i = list.indexOf(current);
    return list[(Math.max(0, i) + dir + list.length) % list.length];
  };

  const cyclePeriod = (dir: 1 | -1) => {
    Haptics.selectionAsync().catch(() => {});
    onPeriodChange(step(PERIOD_STOPS, period, dir));
  };
  const cycleInterval = (dir: 1 | -1) => {
    if (intervals.length < 2) return;
    Haptics.selectionAsync().catch(() => {});
    onIntervalChange(step(intervals, interval, dir));
  };

  const Chip = ({ label, onPress, onLongPress, disabled, a11y }: {
    label: string; onPress: () => void; onLongPress: () => void; disabled?: boolean; a11y: string;
  }) => (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={350}
      disabled={disabled}
      hitSlop={2}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      style={({ pressed }) => [s.chip, { opacity: pressed ? 0.5 : 1 }]}
    >
      <Text style={[s.chipText, { color: disabled ? colors.textTertiary : colors.text }]}>{label}</Text>
    </Pressable>
  );

  return (
    <View style={s.wrap}>
      <Chip
        label={period}
        onPress={() => cyclePeriod(1)}
        onLongPress={() => cyclePeriod(-1)}
        a11y={`Date range ${period}. Tap for next, hold for previous.`}
      />
      <Chip
        label={INTERVAL_LABEL[interval] ?? interval}
        onPress={() => cycleInterval(1)}
        onLongPress={() => cycleInterval(-1)}
        disabled={intervals.length < 2}
        a11y={`Bar size ${interval}. Tap for next, hold for previous.`}
      />
    </View>
  );
}

const s = StyleSheet.create({
  // Plain text like TradingView's toolbar ("5m") — no chip boxes; the
  // Pressable still gives each a comfortable tap target.
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  chip: {
    minWidth: 50,
    height: 44,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Same size as the selected ticker in the wheel, like TradingView.
  chipText: {
    fontSize: 21,
    fontWeight: '500',
  },
});

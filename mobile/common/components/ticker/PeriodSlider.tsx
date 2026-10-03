import React, { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { useThemeColors } from '@/lib/useColorScheme';
import type { PricePeriod } from '@/common/types/blogPosts/ticker';

export const PERIOD_STOPS: PricePeriod[] = ['1D', '1W', '1M', '3M', 'YTD', '1Y', '5Y'];

const TRACK_W = 104;
const THUMB = 26;

/**
 * PeriodSlider — TradingView-style date-range slider for the chart toolbar.
 * Drag the thumb (or tap the track) to snap to a period stop.
 */
export function PeriodSlider({
  period,
  onChange,
}: {
  period: PricePeriod;
  onChange: (p: PricePeriod) => void;
}) {
  const colors = useThemeColors();
  const [dragX, setDragX] = useState<number | null>(null);

  const idx = Math.max(0, PERIOD_STOPS.indexOf(period));
  const shownIdx = dragX != null
    ? Math.min(PERIOD_STOPS.length - 1, Math.max(0, Math.round((dragX / TRACK_W) * (PERIOD_STOPS.length - 1))))
    : idx;
  const thumbLeft = (shownIdx / (PERIOD_STOPS.length - 1)) * TRACK_W;

  const commit = (x: number) => {
    const i = Math.min(PERIOD_STOPS.length - 1, Math.max(0, Math.round((x / TRACK_W) * (PERIOD_STOPS.length - 1))));
    setDragX(null);
    const p = PERIOD_STOPS[i];
    if (p !== period) {
      Haptics.selectionAsync().catch(() => {});
      onChange(p);
    }
  };

  const gesture = Gesture.Pan()
    .activeOffsetX([-8, 8])
    .failOffsetY([-14, 14])
    .onUpdate((e) => {
      'worklet';
      runOnJS(setDragX)(Math.min(TRACK_W, Math.max(0, e.x)));
    })
    .onEnd((e) => {
      'worklet';
      runOnJS(commit)(Math.min(TRACK_W, Math.max(0, e.x)));
    });

  return (
    <View style={s.wrap}>
      <Text style={[s.label, { color: colors.accent }]}>{PERIOD_STOPS[shownIdx]}</Text>
      <GestureDetector gesture={gesture}>
        <View style={[s.track, { backgroundColor: colors.surfaceSecondary }]} hitSlop={{ top: 12, bottom: 12 }}>
          {/* stop ticks */}
          {PERIOD_STOPS.map((_, i) => (
            <View
              key={i}
              style={[
                s.tick,
                {
                  left: (i / (PERIOD_STOPS.length - 1)) * TRACK_W - 1,
                  backgroundColor: i <= shownIdx ? colors.accent : colors.separator,
                },
              ]}
            />
          ))}
          <View style={[s.thumb, { left: thumbLeft - THUMB / 2, backgroundColor: colors.accent }]} />
        </View>
      </GestureDetector>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: {
    width: TRACK_W + 8,
    alignItems: 'stretch',
    justifyContent: 'center',
    gap: 5,
    paddingHorizontal: 4,
  },
  label: {
    fontSize: 12,
    fontWeight: '800',
    textAlign: 'center',
  },
  track: {
    width: TRACK_W,
    height: 22,
    borderRadius: 11,
    justifyContent: 'center',
  },
  tick: {
    position: 'absolute',
    width: 2,
    height: 6,
    borderRadius: 1,
    top: 8,
  },
  thumb: {
    position: 'absolute',
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB / 2,
    top: -2,
    opacity: 0.9,
  },
});

import React, { useEffect, useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue, useAnimatedStyle, withRepeat, withTiming, Easing, cancelAnimation,
} from 'react-native-reanimated';
import { useThemeColors } from '@/lib/useColorScheme';

/**
 * Chart-shaped placeholder shown while a chart's history loads (polling
 * audit B5): grid, price-axis and time-axis stubs, and faint ghost candles
 * that pulse — so a cold open reads as "loading a chart", not a black
 * screen with a spinner. Pure layout; sizes itself to its parent.
 */
const ROWS = 5;
const COLS = 6;
const AXIS_W = 46;
const AXIS_H = 22;
const CANDLES = 28;

// Deterministic gentle random walk — the same ghost shape every time.
function ghostCandles(): { top: number; height: number; wickTop: number; wickHeight: number }[] {
  const out = [];
  let level = 0.5;
  for (let i = 0; i < CANDLES; i++) {
    const step = Math.sin(i * 1.7) * 0.06 + Math.cos(i * 0.6) * 0.04;
    const next = Math.min(0.85, Math.max(0.15, level + step));
    const top = Math.min(level, next);
    const body = Math.max(0.02, Math.abs(next - level));
    const wick = 0.03 + (Math.abs(Math.sin(i * 2.3)) * 0.05);
    out.push({ top, height: body, wickTop: top - wick, wickHeight: body + wick * 2 });
    level = next;
  }
  return out;
}

export function ChartSkeleton({ rounded = false }: { rounded?: boolean }) {
  const colors = useThemeColors();
  const candles = useMemo(ghostCandles, []);
  const pulse = useSharedValue(0.35);

  useEffect(() => {
    pulse.value = withRepeat(withTiming(0.75, { duration: 900, easing: Easing.inOut(Easing.quad) }), -1, true);
    return () => cancelAnimation(pulse);
  }, [pulse]);

  const pulseStyle = useAnimatedStyle(() => ({ opacity: pulse.value }));
  const line = colors.textTertiary + '22';
  const block = colors.textTertiary + '33';

  return (
    <View
      style={[StyleSheet.absoluteFill, { backgroundColor: colors.background, borderRadius: rounded ? 16 : 0, overflow: 'hidden' }]}
      accessibilityLabel="Loading chart"
    >
      {/* plot area */}
      <View style={{ position: 'absolute', left: 0, top: 0, right: AXIS_W, bottom: AXIS_H }}>
        {Array.from({ length: ROWS }, (_, i) => (
          <View key={`r${i}`} style={{ position: 'absolute', left: 0, right: 0, top: `${((i + 0.5) / ROWS) * 100}%`, height: StyleSheet.hairlineWidth, backgroundColor: line }} />
        ))}
        {Array.from({ length: COLS }, (_, i) => (
          <View key={`c${i}`} style={{ position: 'absolute', top: 0, bottom: 0, left: `${((i + 0.5) / COLS) * 100}%`, width: StyleSheet.hairlineWidth, backgroundColor: line }} />
        ))}
        <Animated.View style={[StyleSheet.absoluteFill, { flexDirection: 'row', paddingHorizontal: 6 }, pulseStyle]}>
          {candles.map((c, i) => (
            <View key={i} style={{ flex: 1, alignItems: 'center' }}>
              <View style={{ position: 'absolute', top: `${c.wickTop * 100}%`, height: `${c.wickHeight * 100}%`, width: 1, backgroundColor: block }} />
              <View style={{ position: 'absolute', top: `${c.top * 100}%`, height: `${c.height * 100}%`, width: '55%', borderRadius: 1, backgroundColor: block }} />
            </View>
          ))}
        </Animated.View>
      </View>
      {/* price axis */}
      <View style={{ position: 'absolute', right: 0, top: 0, bottom: AXIS_H, width: AXIS_W }}>
        {Array.from({ length: ROWS }, (_, i) => (
          <View key={i} style={{ position: 'absolute', right: 8, top: `${((i + 0.5) / ROWS) * 100}%`, marginTop: -4, width: 30, height: 8, borderRadius: 3, backgroundColor: block }} />
        ))}
      </View>
      {/* time axis */}
      <View style={{ position: 'absolute', left: 0, right: AXIS_W, bottom: 0, height: AXIS_H }}>
        {Array.from({ length: COLS }, (_, i) => (
          <View key={i} style={{ position: 'absolute', top: 7, left: `${((i + 0.5) / COLS) * 100}%`, marginLeft: -14, width: 28, height: 8, borderRadius: 3, backgroundColor: block }} />
        ))}
      </View>
    </View>
  );
}

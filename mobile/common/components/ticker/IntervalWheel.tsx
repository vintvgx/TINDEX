import React, { useCallback, useEffect, useRef } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing, cancelAnimation, runOnJS, useAnimatedStyle, useSharedValue, withTiming, type SharedValue,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { useThemeColors } from '@/lib/useColorScheme';
import { INTERVAL_LABEL } from '@/lib/chartIntervals';
import { PILL_WHEEL_H, WHEEL_LONG_PRESS_MS, WHEEL_ROW_H } from './TickerWheel';

const ROW_H = WHEEL_ROW_H;
/** How far (in rows) the wheel can be pulled past either end before it
 *  stops following the finger. */
const MAX_OVERSCROLL = 0.35;
/** Finger travel past an end is damped to this fraction (rubber band). */
const RUBBER = 0.3;

const clampIdx = (i: number, max: number) => {
  'worklet';
  return Math.max(0, Math.min(max, i));
};

/**
 * IntervalWheel — vertical bar-size wheel beside TickerWheel in the chart's
 * ticker pill. Same feel as TickerWheel (row pitch, dimmed half-cut
 * neighbours, a haptic tick per row, all on the UI thread) but over a short,
 * fixed list — the period's allowed intervals — so it's CLAMPED at both
 * ends with a small rubber band instead of looping.
 *
 * The interval commits on release (onIntervalChange). Tap or a still
 * press-and-hold (450ms) calls onPress / onLongPress (the chart opens the
 * Tickers & timeframe sheet for both).
 *
 * (The mechanics are duplicated from TickerWheel rather than shared: the
 * ticker wheel's recycled-slot loop and dwell-commit don't apply here, and
 * extracting them would mean reworking a wheel that's already tuned.)
 */
export function IntervalWheel({
  intervals,
  interval,
  onIntervalChange,
  onPress,
  onLongPress,
}: {
  /** The period's allowed intervals (ALLOWED_INTERVALS[period]), in order. */
  intervals: string[];
  interval: string;
  onIntervalChange: (i: string) => void;
  onPress?: () => void;
  onLongPress?: () => void;
}) {
  const colors = useThemeColors();
  const n = intervals.length;
  const maxIdx = Math.max(0, n - 1);
  const activeIdx = Math.max(0, intervals.indexOf(interval));

  const offset = useSharedValue(activeIdx);
  const dragStart = useSharedValue(0);
  const lastPreview = useSharedValue(activeIdx);
  const dragging = useRef(false);
  const committed = useRef(interval);
  const latestIdx = useRef(activeIdx);
  latestIdx.current = activeIdx;
  useEffect(() => { committed.current = interval; }, [interval]);

  // Snap to the current interval (outside change — period switch, the
  // sheet's chips — or a commit the parent didn't take).
  const syncToActive = useCallback(() => {
    cancelAnimation(offset);
    offset.value = latestIdx.current;
    lastPreview.value = latestIdx.current;
  }, [offset, lastPreview]);

  useEffect(() => {
    if (!dragging.current) syncToActive();
  }, [activeIdx, n, syncToActive]);

  const onDragStart = useCallback(() => { dragging.current = true; }, []);
  const onPreview = useCallback(() => {
    Haptics.selectionAsync().catch(() => {});
  }, []);
  const onRelease = useCallback((idx: number) => {
    const next = intervals[idx];
    if (next && next !== committed.current) {
      committed.current = next;
      onIntervalChange(next);
    }
  }, [intervals, onIntervalChange]);
  const onSettled = useCallback(() => {
    dragging.current = false;
    syncToActive();
  }, [syncToActive]);

  const pan = Gesture.Pan()
    .enabled(n > 1)
    .activeOffsetY([-6, 6])
    .failOffsetX([-18, 18])
    .onStart(() => {
      'worklet';
      cancelAnimation(offset);
      dragStart.value = offset.value;
      runOnJS(onDragStart)();
    })
    .onUpdate((e) => {
      'worklet';
      const raw = dragStart.value - e.translationY / ROW_H;
      let o = raw;
      if (raw < 0) o = Math.max(-MAX_OVERSCROLL, raw * RUBBER);
      else if (raw > maxIdx) o = Math.min(maxIdx + MAX_OVERSCROLL, maxIdx + (raw - maxIdx) * RUBBER);
      offset.value = o;
      const p = clampIdx(Math.round(o), maxIdx);
      if (p !== lastPreview.value) {
        lastPreview.value = p;
        runOnJS(onPreview)();
      }
    })
    .onEnd(() => {
      'worklet';
      const target = clampIdx(Math.round(offset.value), maxIdx);
      lastPreview.value = target;
      runOnJS(onRelease)(target);
      offset.value = withTiming(target, { duration: 160, easing: Easing.out(Easing.quad) }, (done) => {
        if (done) runOnJS(onSettled)();
      });
    });

  const firePress = useCallback(() => { onPress?.(); }, [onPress]);
  const fireLongPress = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    onLongPress?.();
  }, [onLongPress]);

  const tap = Gesture.Tap()
    .enabled(!!onPress)
    .onEnd(() => {
      'worklet';
      runOnJS(firePress)();
    });
  const longPress = Gesture.LongPress()
    .enabled(!!onLongPress)
    .minDuration(WHEEL_LONG_PRESS_MS)
    .onStart(() => {
      'worklet';
      runOnJS(fireLongPress)();
    });

  const label = INTERVAL_LABEL[interval] ?? interval;
  const step = (dir: 1 | -1) => {
    const next = intervals[clampIdx(activeIdx + dir, maxIdx)];
    if (next && next !== interval) {
      Haptics.selectionAsync().catch(() => {});
      onIntervalChange(next);
    }
  };

  return (
    <GestureDetector gesture={Gesture.Race(pan, longPress, tap)}>
      <View
        style={s.wheel}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={`Bar size ${label}. Swipe up or down to change, double tap for tickers and timeframe.`}
        accessibilityValue={{ text: label }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }, { name: 'activate' }]}
        onAccessibilityAction={(e) => {
          if (e.nativeEvent.actionName === 'increment') step(1);
          else if (e.nativeEvent.actionName === 'decrement') step(-1);
          else if (e.nativeEvent.actionName === 'activate') (onPress ?? onLongPress)?.();
        }}
      >
        {intervals.map((iv, i) => (
          <IntervalRow
            key={iv}
            index={i}
            offset={offset}
            label={INTERVAL_LABEL[iv] ?? iv}
            colors={colors}
          />
        ))}
      </View>
    </GestureDetector>
  );
}

function IntervalRow({ index, offset, label, colors }: {
  index: number; offset: SharedValue<number>; label: string; colors: any;
}) {
  const style = useAnimatedStyle(() => {
    const d = index - offset.value;
    const dist = Math.min(1, Math.abs(d));
    return {
      transform: [{ translateY: d * ROW_H }, { scale: 1.1 - dist * 0.25 }],
      opacity: Math.abs(d) > 1.6 ? 0 : 1 - dist * 0.72,
    };
  });
  return (
    <Animated.View style={[s.row, style]} pointerEvents="none">
      <Text numberOfLines={1} style={[s.rowText, { color: colors.text }]}>{label}</Text>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  wheel: {
    flex: 1,
    minWidth: 0,
    height: PILL_WHEEL_H,
    overflow: 'hidden',
  },
  row: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: (PILL_WHEEL_H - ROW_H) / 2,
    height: ROW_H,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: {
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
});

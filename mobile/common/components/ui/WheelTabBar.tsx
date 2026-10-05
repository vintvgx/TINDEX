import React, { useCallback, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
  runOnJS,
  cancelAnimation,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { useThemeColors, useAppColorScheme } from '@/lib/useColorScheme';
import { useChartOverlay } from './ChartOverlayContext';

/**
 * 0.7 redesign tab bar: three buttons — Home (screen wheel), Chart
 * (full-screen overlay), Profile. The Home button copies the TickerWheel
 * interaction: vertical scrub cycles through screens, single tap spins
 * back to Home.
 */

export const WHEEL_SCREENS = [
  { key: 'feed', label: 'Home' },
  { key: 'monitor', label: 'Monitor' },
  { key: 'daily_review', label: 'Daily' },
  { key: 'tradelog', label: 'Log' },
  { key: 'accounts', label: 'Account' },
  { key: 'menu', label: 'Menu' },
] as const;

const ROW_H = 18;

function hapticTick() {
  Haptics.selectionAsync().catch(() => {});
}

function ScreenWheel({
  index,
  onSelect,
  onHomeTap,
  colors,
}: {
  index: number;
  onSelect: (i: number) => void;
  onHomeTap: () => void;
  colors: ReturnType<typeof useThemeColors>;
}) {
  const n = WHEEL_SCREENS.length;
  const offset = useSharedValue(index);
  const dragStart = useSharedValue(0);
  const lastPreview = useSharedValue(index);
  const dragging = useRef(false);

  // External sync (Menu jumps, deep links): spin the wheel there.
  useEffect(() => {
    if (!dragging.current && Math.round(offset.value) !== index) {
      offset.value = withTiming(index, { duration: 260, easing: Easing.out(Easing.cubic) });
      lastPreview.value = index;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  const commit = useCallback(
    (pos: number) => {
      const clamped = Math.max(0, Math.min(n - 1, Math.round(pos)));
      onSelect(clamped);
    },
    [n, onSelect],
  );
  const commitRef = useRef(commit);
  commitRef.current = commit;

  const pan = Gesture.Pan()
    .activeOffsetY([-8, 8])
    .failOffsetX([-16, 16])
    .onStart(() => {
      'worklet';
      cancelAnimation(offset);
      dragStart.value = offset.value;
      dragging.current = true;
    })
    .onUpdate((e) => {
      'worklet';
      const o = dragStart.value - e.translationY / ROW_H;
      offset.value = Math.max(-0.35, Math.min(n - 1 + 0.35, o));
      const p = Math.round(offset.value);
      if (p !== lastPreview.value && p >= 0 && p < n) {
        lastPreview.value = p;
        runOnJS(hapticTick)();
      }
    })
    .onEnd(() => {
      'worklet';
      const target = Math.max(0, Math.min(n - 1, Math.round(offset.value)));
      dragging.current = false;
      offset.value = withTiming(target, { duration: 170, easing: Easing.out(Easing.quad) });
      runOnJS(commitRef.current)(target);
    });

  const tap = Gesture.Tap().onEnd(() => {
    'worklet';
    // Spin back to Home from wherever the wheel sits.
    offset.value = withTiming(0, { duration: 420, easing: Easing.out(Easing.cubic) });
    lastPreview.value = 0;
    runOnJS(onHomeTap)();
  });

  const stackStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: ROW_H * (1 - offset.value) }],
  }));

  return (
    <GestureDetector gesture={Gesture.Race(pan, tap)}>
      <View style={styles.wheelWindow}>
        <Animated.View style={stackStyle}>
          {WHEEL_SCREENS.map((w, i) => (
            <WheelLabel key={w.key} label={w.label} i={i} offset={offset} colors={colors} />
          ))}
        </Animated.View>
        {/* center-row indicator */}
        <View
          pointerEvents="none"
          style={[
            styles.wheelHighlight,
            { top: ROW_H, height: ROW_H, backgroundColor: colors.text + '14' },
          ]}
        />
      </View>
    </GestureDetector>
  );
}

function WheelLabel({
  label,
  i,
  offset,
  colors,
}: {
  label: string;
  i: number;
  offset: Animated.SharedValue<number>;
  colors: ReturnType<typeof useThemeColors>;
}) {
  const style = useAnimatedStyle(() => {
    const d = Math.abs(i - offset.value);
    return {
      opacity: d > 1.4 ? 0 : 1 - Math.min(1, d) * 0.75,
    };
  });
  const textStyle = useAnimatedStyle(() => ({
    color: Math.abs(i - offset.value) < 0.5 ? colors.text : colors.textTertiary,
  }));
  return (
    <Animated.View style={[{ height: ROW_H, justifyContent: 'center', alignItems: 'center' }, style]}>
      <Animated.Text
        style={[
          { fontSize: 11, fontWeight: '700', letterSpacing: 0.4 },
          textStyle,
        ]}
      >
        {label}
      </Animated.Text>
    </Animated.View>
  );
}

export const WheelTabBar: React.FC<BottomTabBarProps> = ({ state, navigation }) => {
  const colors = useThemeColors();
  const { isDarkColorScheme: isDark } = useAppColorScheme();
  const insets = useSafeAreaInsets();
  const { openChart } = useChartOverlay();

  const routeName = state.routes[state.index]?.name;
  const wheelIndex = Math.max(
    0,
    WHEEL_SCREENS.findIndex((w) => w.key === routeName),
  );
  const isProfile = routeName === 'profile';

  const goTo = useCallback(
    (key: string) => {
      const route = state.routes.find((r) => r.name === key);
      if (!route) return;
      const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
      if (!event.defaultPrevented) {
        navigation.navigate(key as never);
      }
    },
    [navigation, state.routes],
  );

  const blurTint: 'light' | 'dark' = isDark ? 'dark' : 'light';

  return (
    <View
      style={[
        styles.outer,
        {
          marginBottom: Math.max(insets.bottom, 10) + 6,
          shadowColor: '#000',
        },
      ]}
    >
      <View style={[StyleSheet.absoluteFillObject, { borderRadius: 26, overflow: 'hidden' }]}>
        <BlurView
          tint={blurTint}
          intensity={70}
          style={StyleSheet.absoluteFill}
        />
        <View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFillObject,
            {
              borderRadius: 26,
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: isDark ? 'rgba(255,255,255,0.16)' : 'rgba(0,0,0,0.1)',
              backgroundColor: isDark ? 'rgba(22,23,29,0.35)' : 'rgba(250,249,245,0.4)',
            },
          ]}
        />
      </View>

      {/* Home / screen wheel */}
      <View style={styles.section}>
        <Ionicons name="home-outline" size={19} color={colors.textSecondary} style={{ marginBottom: 2 }} />
        <ScreenWheel
          index={wheelIndex}
          colors={colors}
          onSelect={(i) => goTo(WHEEL_SCREENS[i].key)}
          onHomeTap={() => goTo('feed')}
        />
      </View>

      {/* Chart overlay */}
      <TouchableOpacity
        onPress={() => openChart()}
        activeOpacity={0.7}
        style={styles.section}
        accessibilityLabel="Open chart"
      >
        <Ionicons name="stats-chart-outline" size={21} color={colors.text} />
        <Text style={[styles.label, { color: colors.textSecondary }]}>Chart</Text>
      </TouchableOpacity>

      {/* Profile */}
      <TouchableOpacity
        onPress={() => goTo('profile')}
        activeOpacity={0.7}
        style={styles.section}
        accessibilityLabel="Profile"
      >
        <Ionicons
          name={isProfile ? 'person' : 'person-outline'}
          size={21}
          color={isProfile ? colors.text : colors.textSecondary}
        />
        <Text style={[styles.label, { color: isProfile ? colors.text : colors.textSecondary }]}>
          Profile
        </Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  outer: {
    flexDirection: 'row',
    marginHorizontal: 18,
    borderRadius: 26,
    paddingVertical: 8,
    // iOS shadow
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
    elevation: 8,
  },
  section: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontSize: 10,
    fontWeight: '600',
    marginTop: 3,
    letterSpacing: 0.3,
  },
  wheelWindow: {
    height: ROW_H * 3,
    width: 92,
    overflow: 'hidden',
  },
  wheelHighlight: {
    position: 'absolute',
    left: 6,
    right: 6,
    borderRadius: 8,
  },
});

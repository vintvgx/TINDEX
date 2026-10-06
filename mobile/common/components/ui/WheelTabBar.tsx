import React, { useCallback, useEffect, useRef } from 'react';
import { View, TouchableOpacity, StyleSheet } from 'react-native';
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
 * 0.7 redesign tab bar — matches the reference: a floating pill of
 * icon-only buttons on the left (screen wheel + Chart) and a detached round
 * Profile button on the right.
 *
 * The first pill button is the screen wheel: it shows the current screen's
 * icon in a highlight circle; scrub it vertically to cycle screens (haptic
 * tick per screen), tap it to spin back to Home.
 */

export const WHEEL_SCREENS = [
  { key: 'feed', label: 'Home', icon: 'home-outline' },
  { key: 'position', label: 'Positions', icon: 'briefcase-outline' },
  { key: 'monitor', label: 'Monitor', icon: 'pulse-outline' },
  { key: 'daily_review', label: 'Daily', icon: 'calendar-outline' },
  { key: 'tradelog', label: 'Log', icon: 'receipt-outline' },
  { key: 'accounts', label: 'Account', icon: 'wallet-outline' },
  { key: 'menu', label: 'Menu', icon: 'grid-outline' },
] as const;

/** Screens whose content runs UNDER the bar (they reserve their own bottom
 *  clearance) — the bar floats over them so the list fills to the bottom
 *  edge with no band behind the bar. Elsewhere it sits in normal flow. */
const FLOATING_ON = new Set(['feed', 'position']);

const BTN = 46;        // pill button / wheel window size
const PILL_PAD = 6;
const BAR_TOP_PAD = 6;
/** Lift above the home indicator — sitting right on the safe-area edge
 *  felt cramped (and put the wheel scrub in iOS Reachability's zone). */
const BOTTOM_LIFT = 14;

/** Total height the bar occupies from the screen bottom — screens the bar
 *  floats over (FLOATING_ON) pad their content by this. */
export function useWheelTabBarHeight(): number {
  const insets = useSafeAreaInsets();
  return BAR_TOP_PAD + BTN + PILL_PAD * 2 + Math.max(insets.bottom, 10) + BOTTOM_LIFT;
}
const ROW_H = BTN;     // one icon per wheel row
const SCRUB_PX = 22;   // finger travel per screen while scrubbing

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
      const o = dragStart.value - e.translationY / SCRUB_PX;
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
    transform: [{ translateY: -ROW_H * offset.value }],
  }));

  return (
    <GestureDetector gesture={Gesture.Race(pan, tap)}>
      <View
        style={[styles.btn, { backgroundColor: colors.text + '14', overflow: 'hidden' }]}
        accessibilityRole="button"
        accessibilityLabel={`${WHEEL_SCREENS[index]?.label ?? 'Home'} — swipe up or down to switch screens, tap for Home`}
      >
        <Animated.View style={[{ position: 'absolute', top: 0, left: 0, right: 0 }, stackStyle]}>
          {WHEEL_SCREENS.map((w, i) => (
            <WheelIcon key={w.key} icon={w.icon} i={i} offset={offset} colors={colors} />
          ))}
        </Animated.View>
      </View>
    </GestureDetector>
  );
}

function WheelIcon({
  icon,
  i,
  offset,
  colors,
}: {
  icon: (typeof WHEEL_SCREENS)[number]['icon'];
  i: number;
  offset: Animated.SharedValue<number>;
  colors: ReturnType<typeof useThemeColors>;
}) {
  const style = useAnimatedStyle(() => {
    const d = Math.abs(i - offset.value);
    return { opacity: d > 1 ? 0 : 1 - d, transform: [{ scale: 1 - Math.min(1, d) * 0.25 }] };
  });
  return (
    <Animated.View style={[{ height: ROW_H, alignItems: 'center', justifyContent: 'center' }, style]}>
      <Ionicons name={icon} size={21} color={colors.text} />
    </Animated.View>
  );
}

/** Blurred, hairline-rimmed glass backing shared by the pill and the
 *  round Profile button. */
function Glass({ radius, isDark }: { radius: number; isDark: boolean }) {
  return (
    <View style={[StyleSheet.absoluteFillObject, { borderRadius: radius, overflow: 'hidden' }]}>
      <BlurView tint={isDark ? 'dark' : 'light'} intensity={70} style={StyleSheet.absoluteFill} />
      <View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFillObject,
          {
            borderRadius: radius,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: isDark ? 'rgba(255,255,255,0.16)' : 'rgba(0,0,0,0.1)',
            backgroundColor: isDark ? 'rgba(22,23,29,0.35)' : 'rgba(250,249,245,0.4)',
          },
        ]}
      />
    </View>
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

  const pillRadius = (BTN + PILL_PAD * 2) / 2;
  const roundSize = BTN + PILL_PAD * 2;

  const floating = FLOATING_ON.has(routeName ?? '');

  return (
    <View
      style={[
        styles.outer,
        { paddingBottom: Math.max(insets.bottom, 10) + BOTTOM_LIFT },
        floating
          ? { position: 'absolute', left: 0, right: 0, bottom: 0 }
          : { backgroundColor: colors.background },
      ]}
      pointerEvents="box-none"
    >
      {/* Left pill: screen wheel + Chart */}
      <View style={[styles.pill, styles.shadow, { padding: PILL_PAD, borderRadius: pillRadius }]}>
        <Glass radius={pillRadius} isDark={isDark} />
        <ScreenWheel
          index={wheelIndex}
          colors={colors}
          onSelect={(i) => goTo(WHEEL_SCREENS[i].key)}
          onHomeTap={() => goTo('feed')}
        />
        <TouchableOpacity
          onPress={() => openChart()}
          activeOpacity={0.6}
          style={styles.btn}
          accessibilityLabel="Open chart"
        >
          <Ionicons name="stats-chart-outline" size={21} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>

      <View style={{ flex: 1 }} />

      {/* Right: detached round Profile button */}
      <TouchableOpacity
        onPress={() => goTo('profile')}
        activeOpacity={0.7}
        style={[styles.shadow, { width: roundSize, height: roundSize, borderRadius: roundSize / 2, alignItems: 'center', justifyContent: 'center' }]}
        accessibilityLabel="Profile"
      >
        <Glass radius={roundSize / 2} isDark={isDark} />
        <Ionicons
          name={isProfile ? 'person' : 'person-outline'}
          size={21}
          color={isProfile ? colors.text : colors.textSecondary}
        />
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  outer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingTop: BAR_TOP_PAD,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  shadow: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.16,
    shadowRadius: 12,
    elevation: 8,
  },
  btn: {
    width: BTN,
    height: BTN,
    borderRadius: BTN / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

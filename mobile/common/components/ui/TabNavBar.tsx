import React, { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { useSharedValue, useAnimatedStyle, withTiming, Easing } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { useThemeColors, useAppColorScheme } from '@/lib/useColorScheme';
import { Glass } from './WheelTabBar';
import { TickerCard } from '@/common/components/home/TickerCard';

/**
 * 0.8 tab bar (spec §3.1) — replaces WheelTabBar. A column of the floating
 * TickerCard, a 12px gap, then one full-width glass pill of five labeled
 * tabs with a soft highlight that slides to the active tab. Daily, Account
 * and Positions are reached from Menu; every route stays registered.
 */

export const TAB_NAV_TABS = [
  { key: 'feed', label: 'Home', icon: 'home', iconOff: 'home-outline' },
  { key: 'monitor', label: 'Monitor', icon: 'pulse', iconOff: 'pulse-outline' },
  { key: 'tradelog', label: 'Log', icon: 'receipt', iconOff: 'receipt-outline' },
  { key: 'menu', label: 'Menu', icon: 'grid', iconOff: 'grid-outline' },
  { key: 'profile', label: 'Profile', icon: 'person', iconOff: 'person-outline' },
] as const;

/** Screens whose content runs UNDER the bar (they reserve their own bottom
 *  clearance via useTabNavHeight) — same rule as WheelTabBar. */
const FLOATING_ON = new Set(['feed', 'position']);

const BAR_TOP_PAD = 6;
/** Lift above the home indicator (same as WheelTabBar). */
const BOTTOM_LIFT = 14;
const SIDE_PAD = 12;
const CARD_GAP = 12;
const PILL_PAD = 6;
const PILL_RADIUS = 30;
const TAB_H = 48;
const PILL_H = TAB_H + PILL_PAD * 2;
/** Card height before its first layout (34 logo + 2×10 padding). */
const CARD_H_ESTIMATE = 54;

// Tiny store for the measured card height, so useTabNavHeight() is exact
// without duplicating layout numbers in the screens.
let cardHeight = CARD_H_ESTIMATE;
const listeners = new Set<() => void>();
function setCardHeight(h: number) {
  const r = Math.round(h);
  if (r <= 0 || r === cardHeight) return;
  cardHeight = r;
  listeners.forEach((l) => l());
}
function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
const getCardHeight = () => cardHeight;

/** Total height the bar occupies from the screen bottom (card + gap + pill
 *  + bottom padding) — screens the bar floats over (FLOATING_ON) pad their
 *  content by this. */
export function useTabNavHeight(): number {
  const insets = useSafeAreaInsets();
  const card = useSyncExternalStore(subscribe, getCardHeight, getCardHeight);
  return BAR_TOP_PAD + card + CARD_GAP + PILL_H + Math.max(insets.bottom, 10) + BOTTOM_LIFT;
}

export const TabNavBar: React.FC<BottomTabBarProps> = ({ state, navigation }) => {
  const colors = useThemeColors();
  const { isDarkColorScheme: isDark } = useAppColorScheme();
  const insets = useSafeAreaInsets();

  const routeName = state.routes[state.index]?.name;
  const activeIndex = TAB_NAV_TABS.findIndex((t) => t.key === routeName);
  const floating = FLOATING_ON.has(routeName ?? '');

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

  const [tabW, setTabW] = useState(0);
  const x = useSharedValue(0);
  const placed = useSharedValue(false);
  useEffect(() => {
    if (tabW <= 0 || activeIndex < 0) return;
    const target = activeIndex * tabW;
    // First placement snaps; later tab changes slide.
    x.value = placed.value
      ? withTiming(target, { duration: 200, easing: Easing.out(Easing.cubic) })
      : target;
    placed.value = true;
  }, [activeIndex, tabW, x, placed]);
  const hlStyle = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));

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
      <TickerCard onLayout={setCardHeight} layoutKey={floating} />
      <View
        style={[styles.pill, styles.shadow]}
        onLayout={(e) => setTabW((e.nativeEvent.layout.width - PILL_PAD * 2) / TAB_NAV_TABS.length)}
        accessibilityRole="tablist"
      >
        <Glass radius={PILL_RADIUS} isDark={isDark} />
        {tabW > 0 && activeIndex >= 0 && (
          <Animated.View
            pointerEvents="none"
            style={[
              styles.highlight,
              { width: tabW, backgroundColor: colors.text + '17' },
              hlStyle,
            ]}
          />
        )}
        {TAB_NAV_TABS.map((t, i) => {
          const active = i === activeIndex;
          const color = active ? colors.text : colors.textSecondary;
          return (
            <Pressable
              key={t.key}
              style={styles.tab}
              onPress={() => {
                if (!active) Haptics.selectionAsync().catch(() => {});
                goTo(t.key);
              }}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={t.label}
            >
              <Ionicons name={active ? t.icon : t.iconOff} size={22} color={color} />
              <Text style={[styles.label, { color }]} numberOfLines={1}>{t.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  outer: {
    paddingHorizontal: SIDE_PAD,
    paddingTop: BAR_TOP_PAD,
    gap: CARD_GAP,
  },
  pill: {
    flexDirection: 'row',
    borderRadius: PILL_RADIUS,
    padding: PILL_PAD,
    height: PILL_H,
  },
  shadow: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.16,
    shadowRadius: 12,
    elevation: 8,
  },
  highlight: {
    position: 'absolute',
    top: PILL_PAD,
    left: PILL_PAD,
    height: TAB_H,
    borderRadius: TAB_H / 2,
  },
  tab: {
    flex: 1,
    height: TAB_H,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  label: {
    fontSize: 10.5,
    fontWeight: '600',
  },
});

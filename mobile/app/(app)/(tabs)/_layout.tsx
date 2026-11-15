import { useCallback, useEffect, useRef, useState } from 'react';
import { Tabs } from 'expo-router';
import { View, TouchableOpacity, StyleSheet, BackHandler } from 'react-native';
import Animated, {
  Easing,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaInsetsContext, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { TabNavBar } from '@/common/components/ui/TabNavBar';
import {
  ChartOverlayProvider,
  useChartOverlay,
} from '@/common/components/ui/ChartOverlayContext';
import { ChartsContent } from './charts';
import { TickerTape } from '@/common/components/ui/TickerTape';
import { AppHeader } from '@/common/components/ui/AppHeader';
import { ChartTapeProvider } from '@/common/components/ui/ChartTapeContext';
import { OptionsTickerProvider } from '@/lib/optionsTickerContext';
import { useThemeColors } from '@/lib/useColorScheme';
import { TradeEntryNavigator } from '@/common/components/trade/TradeEntryNavigator';
import { AppSocketBridge } from '@/common/services/appSocket';

/**
 * 0.8 app shell: ticker tape → app header → tab navigator → TabNavBar
 * (floating TickerCard over a labeled 5-tab pill: Home · Monitor · Log ·
 * Menu · Profile).
 *
 * Tapping the ticker card expands the chart out of the card's rect into a
 * full-screen overlay covering the header and tab bar (not the tape) while
 * Home recedes; the chevron-down collapses it back into the card (spec §4).
 * Daily, Account and Positions are reached from Menu. All routes stay
 * registered so deep links and notifications keep working.
 */
function Shell() {
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();

  return (
    <ChartOverlayProvider>
      <ChartTapeProvider>
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <ShellContent insets={insets} />
        <StatusBar style="light" />
      </View>
      </ChartTapeProvider>
    </ChartOverlayProvider>
  );
}

function ShellContent({ insets }: { insets: ReturnType<typeof useSafeAreaInsets> }) {
  const colors = useThemeColors();
  const { open: chartOpen, ticker: chartTicker, originRect, closeChart } = useChartOverlay();
  // The chart overlay starts BELOW the ticker tape: charts.tsx has no tape of
  // its own — it publishes its ticker/price/signal to this global tape via
  // ChartTapeContext — so covering the tape hid that headline (and its
  // tap-ticker-to-search / tap-signal-for-contracts shortcuts).
  const [tapeH, setTapeH] = useState(0);

  // ── Expand / collapse (spec §4) ────────────────────────────────────────
  // `chartOpen` is intent; `rendered` keeps the overlay mounted through the
  // collapse; `covered` hides the tab bar once the expand has finished.
  const [rendered, setRendered] = useState(false);
  const [covered, setCovered] = useState(false);
  const reduceMotion = useReducedMotion();
  /** 0 = at the card, 1 = full screen. */
  const progress = useSharedValue(0);
  /** Overlay host size + the origin rect in HOST coords (host = below the tape). */
  const hostSize = useSharedValue({ width: 0, height: 0 });
  const origin = useSharedValue({ x: 0, y: 0, width: 0, height: 0 });
  const hostRef = useRef<View>(null);
  const hostWin = useRef({ x: 0, y: 0 });
  /** Set on a fresh mount: the first expand waits one frame for layout. */
  const justMounted = useRef(false);

  const measureHost = useCallback(() => {
    hostRef.current?.measureInWindow((x, y, width, height) => {
      hostWin.current = { x, y };
      hostSize.value = { width, height };
    });
  }, [hostSize]);

  // Window → host coords. Recomputed on each open (and on a host re-layout).
  useEffect(() => {
    origin.value = {
      x: originRect.x - hostWin.current.x,
      y: originRect.y - hostWin.current.y,
      width: originRect.width,
      height: originRect.height,
    };
  }, [originRect, tapeH, origin]);

  useEffect(() => {
    if (chartOpen && !rendered) {
      // Mount at progress 0 (the card's rect); the next pass animates.
      progress.value = 0;
      justMounted.current = true;
      setRendered(true);
      return;
    }
    if (chartOpen) {
      const expand = () => {
        progress.value = withTiming(
          1,
          { duration: reduceMotion ? 0 : 300, easing: Easing.bezier(0.2, 0.8, 0.2, 1) },
          (fin) => {
            if (fin) runOnJS(setCovered)(true);
          },
        );
      };
      // Mid-collapse re-open: still mounted, animate on from the current
      // progress right away (no remount).
      if (!justMounted.current) {
        expand();
        return;
      }
      // Fresh mount: one frame so the chart lays out before it moves (no
      // first-frame jank).
      const raf = requestAnimationFrame(() => {
        justMounted.current = false;
        expand();
      });
      return () => cancelAnimationFrame(raf);
    }
    justMounted.current = false;
    if (rendered) {
      // Tab bar back first (under the overlay), then shrink into the card.
      setCovered(false);
      progress.value = withTiming(
        0,
        { duration: reduceMotion ? 0 : 250, easing: Easing.bezier(0.4, 0, 0.2, 1) },
        (fin) => {
          if (fin) runOnJS(setRendered)(false);
        },
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs on intent/mount changes only
  }, [chartOpen, rendered]);

  // Android back collapses the chart.
  useEffect(() => {
    if (!chartOpen) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      closeChart();
      return true;
    });
    return () => sub.remove();
  }, [chartOpen, closeChart]);

  const homeStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 1], [1, 0.45]),
    borderRadius: interpolate(progress.value, [0, 1], [0, 28]),
    transform: [{ scale: interpolate(progress.value, [0, 1], [1, 0.94]) }],
  }));
  const frameStyle = useAnimatedStyle(() => {
    const p = progress.value;
    const o = origin.value;
    const h = hostSize.value;
    return {
      left: interpolate(p, [0, 1], [o.x, 0]),
      top: interpolate(p, [0, 1], [o.y, 0]),
      width: interpolate(p, [0, 1], [o.width, h.width]),
      height: interpolate(p, [0, 1], [o.height, h.height]),
      borderRadius: interpolate(p, [0, 1], [20, 0]),
    };
  });
  // At p=0 the frame is see-through, so the card underneath *becomes* the
  // chart on open and the chart dissolves back into it on close.
  const frameBgStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 0.3], [0, 1], 'clamp'),
  }));
  // Full host size, offset against the frame so the chart is revealed by the
  // growing clip rather than squashed into it.
  const contentStyle = useAnimatedStyle(() => {
    const p = progress.value;
    const o = origin.value;
    const h = hostSize.value;
    return {
      left: -interpolate(p, [0, 1], [o.x, 0]),
      top: -interpolate(p, [0, 1], [o.y, 0]),
      width: h.width,
      height: h.height,
      opacity: interpolate(p, [0, 0.75], [0, 1], 'clamp'),
      transform: [{ scale: interpolate(p, [0, 0.75], [0.92, 1], 'clamp') }],
    };
  });

  return (
    <View style={{ flex: 1 }}>
      <View onLayout={(e) => setTapeH(e.nativeEvent.layout.height)}>
        <TickerTape />
      </View>
      {/* Lands a just-entered trade on Home (see TradeEntryNavigator). */}
      <TradeEntryNavigator />
      {/* The app's push socket — "positions/pending changed" notices (C2). */}
      <AppSocketBridge />

      {/* Home (header + tabs + tab bar/card) — recedes while the chart is up. */}
      <Animated.View style={[{ flex: 1 }, rendered && { overflow: 'hidden' }, homeStyle]}>
      <AppHeader />
      <View style={{ flex: 1 }}>
        <SafeAreaInsetsContext.Provider
          value={{ top: 0, bottom: 0, left: insets.left, right: insets.right }}
        >
          <Tabs
            initialRouteName="feed"
            // Theme background behind every screen — the default scene
            // color showed through as black around/below shorter content.
            screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: colors.background } }}
            tabBar={covered ? () => null : (props) => <TabNavBar {...props} />}
          >
            {/* Wheel screens */}
            <Tabs.Screen name="feed" options={{ title: 'Home' }} />
            <Tabs.Screen name="monitor" options={{ title: 'Monitor' }} />
            <Tabs.Screen name="daily_review" options={{ title: 'Daily' }} />
            <Tabs.Screen name="tradelog" options={{ title: 'Log' }} />
            <Tabs.Screen name="accounts" options={{ title: 'Account' }} />
            <Tabs.Screen name="menu" options={{ title: 'Menu' }} />
            <Tabs.Screen name="profile" options={{ title: 'Profile' }} />

            {/* Reachable via Menu / deep links — not in the wheel */}
            <Tabs.Screen name="orb" options={{ href: null }} />
            <Tabs.Screen name="charts" options={{ href: null }} />
            <Tabs.Screen name="dashboard" options={{ href: null }} />
            <Tabs.Screen name="brief" options={{ href: null }} />
            <Tabs.Screen name="strategy" options={{ href: null }} />
            <Tabs.Screen name="position" options={{ href: null }} />
            <Tabs.Screen name="options" options={{ href: null }} />
            <Tabs.Screen name="accounts_overview" options={{ href: null }} />
            <Tabs.Screen name="track" options={{ href: null }} />
            <Tabs.Screen name="track-legacy" options={{ href: null }} />
            <Tabs.Screen name="notifications" options={{ href: null }} />
            <Tabs.Screen name="search" options={{ href: null }} />
            <Tabs.Screen name="watchlists" options={{ href: null }} />
            <Tabs.Screen name="simulation" options={{ href: null }} />
            <Tabs.Screen name="simulator" options={{ href: null }} />
          </Tabs>
        </SafeAreaInsetsContext.Provider>
      </View>
      </Animated.View>

      {/* Chart overlay host — the area below the tape. Always mounted (so it
          stays measured); the clip frame mounts only while `rendered`. */}
      <View
        ref={hostRef}
        onLayout={measureHost}
        pointerEvents="box-none"
        style={[StyleSheet.absoluteFillObject, { top: tapeH, zIndex: 50 }]}
      >
        {rendered && (
          <Animated.View
            pointerEvents={chartOpen ? 'auto' : 'none'}
            style={[styles.frame, frameStyle]}
          >
            <Animated.View
              style={[StyleSheet.absoluteFillObject, { backgroundColor: colors.background }, frameBgStyle]}
            />
            <Animated.View style={[styles.content, contentStyle]}>
              <ChartsContent initialTicker={chartTicker} topInset={0} />
              <ChartCollapseButton onPress={closeChart} />
            </Animated.View>
          </Animated.View>
        )}
      </View>
    </View>
  );
}

/** Collapses the chart back into the ticker card (top right of the chart). */
function ChartCollapseButton({ onPress }: { onPress: () => void }) {
  const colors = useThemeColors();
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel="Collapse chart"
      style={[
        styles.closeBtn,
        { top: 8, backgroundColor: colors.surfaceSecondary, borderColor: colors.border },
      ]}
    >
      <Ionicons name="chevron-down" size={20} color={colors.text} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  frame: { position: 'absolute', overflow: 'hidden' },
  content: { position: 'absolute' },
  closeBtn: {
    position: 'absolute',
    right: 14,
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default function Layout() {
  return (
    <OptionsTickerProvider>
      <Shell />
    </OptionsTickerProvider>
  );
}

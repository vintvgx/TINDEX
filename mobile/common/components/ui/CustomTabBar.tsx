import React, { useState, useCallback, useRef, useEffect } from 'react';
import { View, Text, TouchableOpacity, Pressable, StyleSheet, Animated, Keyboard, Platform } from 'react-native';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useThemeColors, useAppColorScheme } from '@/lib/useColorScheme';
import { SearchBottomSheet } from '@/common/components/search/SearchBottomSheet';
import { AgentModal } from '@/common/components/agent/AgentModal';
import { useToast } from '@/common/components/ui/Toast';
import { useSearchBarVisibility } from '@/hooks/useSearchBarVisibility';

const VISIBLE_ROUTE_ORDER = ['feed', 'orb', 'charts', 'accounts', 'profile'] as const;

const ROUTE_TITLES: Record<string, string> = {
  feed: 'Home',
  orb: 'ORB',
  charts: 'Charts',
  accounts: 'Accounts',
  profile: 'Profile',
};

const SEARCH_RADIUS = 22;
const AGENT_RADIUS = 23;

// Rendered content height of the docked tab bar (icon+label buttons, not
// counting the safe-area inset padding below them) — used both by the bar
// itself and to anchor the floating search row just above it.
const TAB_BAR_CONTENT_HEIGHT = 56;
const SEARCH_ROW_GAP = 10;
const SEARCH_BAR_MARGIN = 8;
// Rendered height of the floating search row itself (padding + line height).
const SEARCH_BAR_HEIGHT = 46;

/**
 * The tab bar itself is now docked (a normal, non-absolute flex child —
 * see the component below), so it reserves real layout space on its own;
 * screens no longer need to pad around it. The search+AI row is the only
 * thing left floating over content (anchored just above the docked bar),
 * so this is what screens with their own fixed-position bottom content
 * (action panels, sticky buttons) should still add to their bottom
 * offset/padding to clear.
 */
export function useFloatingTabBarHeight(): number {
  return SEARCH_ROW_GAP + SEARCH_BAR_HEIGHT + SEARCH_BAR_MARGIN;
}

/** Actual rendered height of the docked tab bar, safe-area inset included —
 *  exported so the Charts screen (and anything else laying out flush
 *  against it) can size itself precisely instead of guessing. */
export function useDockedTabBarHeight(): number {
  const insets = useSafeAreaInsets();
  const bottomPadding = Math.max(insets.bottom, 12) + 8;
  return bottomPadding + TAB_BAR_CONTENT_HEIGHT;
}

/**
 * Reusable glass backing (blur + theme fallback tint + hairline edge) for the
 * floating search field and AI button. Module-scoped so the BlurView isn't
 * remounted on every parent re-render (e.g. while typing). Rendered first inside
 * its parent so content sits on top.
 */
function GlassBacking({
  radius, intensity, showFocus, blurTint, glassBorder, glassFallback, focusOverlay,
}: {
  radius: number;
  intensity: number;
  showFocus?: boolean;
  blurTint: 'light' | 'dark';
  glassBorder: string;
  glassFallback: string;
  focusOverlay: string;
}) {
  return (
    <>
      <View style={[StyleSheet.absoluteFillObject, { borderRadius: radius, overflow: 'hidden', backgroundColor: glassFallback }]}>
        <BlurView
          tint={blurTint}
          intensity={intensity}
          style={StyleSheet.absoluteFill}
          experimentalBlurMethod={Platform.OS === 'android' ? 'dimezisBlurView' : undefined}
        />
        {showFocus && <View style={[StyleSheet.absoluteFill, { backgroundColor: focusOverlay }]} />}
      </View>
      <View pointerEvents="none" style={[StyleSheet.absoluteFillObject, { borderRadius: radius, borderWidth: StyleSheet.hairlineWidth, borderColor: glassBorder }]} />
    </>
  );
}

export const CustomTabBar: React.FC<BottomTabBarProps> = ({ state, navigation }) => {
  const colors = useThemeColors();
  const { isDarkColorScheme: isDark } = useAppColorScheme();
  const insets = useSafeAreaInsets();
  const [searchOpen, setSearchOpen] = useState(false);
  const [agentOpen, setAgentOpen] = useState(false);
  const { hidden: searchBarHidden } = useSearchBarVisibility();
  const toast = useToast();
  const keyboardOffset = useRef(new Animated.Value(0)).current;
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const bottomPaddingRef = useRef(0);

  const visibleRoutes = VISIBLE_ROUTE_ORDER
    .map(name => state.routes.find(r => r.name === name))
    .filter((route): route is (typeof state.routes)[number] => Boolean(route));
  // Extra breathing room below the tab labels so they clear the home-indicator /
  // gesture (Siri) bar at the very bottom of the screen.
  const bottomPadding = Math.max(insets.bottom, 12) + 8;

  // Glass styling derived from the active theme.
  const blurTint: 'light' | 'dark' = isDark ? 'dark' : 'light';
  const glassBorder   = isDark ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.12)';
  const glassFallback = isDark ? 'rgba(22,23,29,0.35)' : 'rgba(250,249,245,0.45)';
  // When the search field is focused, lay a near-opaque themed sheet behind the
  // text so it stays legible against busy content showing through the glass.
  const focusOverlay  = isDark ? 'rgba(22,23,29,0.88)' : 'rgba(250,249,245,0.92)';

  useEffect(() => {
    bottomPaddingRef.current = bottomPadding;
  }, [bottomPadding]);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const onShow = Keyboard.addListener(showEvent, e => {
      setKeyboardVisible(true);
      const searchBarBaseOffset = bottomPaddingRef.current + TAB_BAR_CONTENT_HEIGHT + SEARCH_ROW_GAP;
      const toValue = -(e.endCoordinates.height - searchBarBaseOffset + SEARCH_BAR_MARGIN);
      Animated.spring(keyboardOffset, {
        toValue,
        useNativeDriver: true,
        damping: 20,
        stiffness: 200,
        mass: 0.8,
      }).start();
    });

    const onHide = Keyboard.addListener(hideEvent, () => {
      setKeyboardVisible(false);
      Animated.spring(keyboardOffset, {
        toValue: 0,
        useNativeDriver: true,
        damping: 20,
        stiffness: 200,
        mass: 0.8,
      }).start();
    });

    return () => { onShow.remove(); onHide.remove(); };
  }, [keyboardOffset]);

  const handleTabPress = useCallback(
    (route: (typeof state.routes)[0], isFocused: boolean) => {
      const event = navigation.emit({
        type: 'tabPress',
        target: route.key,
        canPreventDefault: true,
      });
      if (!isFocused && !event.defaultPrevented) {
        navigation.navigate(route.name as never);
      }
    },
    [navigation],
  );

  const getIcon = (routeName: string, color: string) => {
    switch (routeName) {
      case 'feed':
        return <Ionicons name="home-outline" size={20} color={color} />;
      case 'orb':
        return <Ionicons name="pulse-outline" size={20} color={color} />;
      case 'charts':
        return <Ionicons name="stats-chart-outline" size={20} color={color} />;
      case 'accounts':
        return <Ionicons name="wallet-outline" size={20} color={color} />;
      case 'profile':
        return <Ionicons name="person-outline" size={20} color={color} />;
      default:
        return null;
    }
  };

  const glassProps = { blurTint, glassBorder, glassFallback, focusOverlay };

  return (
    <>
      {keyboardVisible && (
        <Pressable style={StyleSheet.absoluteFillObject} onPress={Keyboard.dismiss} />
      )}

      {/* Floating glass search + AI row — still overlays content (it needs
          to hover above whatever's on screen, not push it down), anchored
          just above the docked tab bar below rather than sitting inside it.
          The Profile "Hide Search Bar" setting hides this whole row (search
          field + AI button together); the AI assistant stays reachable from
          Profile's own "Open AI Assistant" button in that case. */}
      {!searchBarHidden && (
        <View pointerEvents="box-none" style={[styles.searchRowOuter, { bottom: bottomPadding + TAB_BAR_CONTENT_HEIGHT }]}>
          <Animated.View style={[styles.searchRow, { transform: [{ translateY: keyboardOffset }] }]}>
            <TouchableOpacity
              onPress={() => setSearchOpen(true)}
              activeOpacity={0.82}
              style={[styles.searchBar, { flex: 1 }]}
            >
              <GlassBacking radius={SEARCH_RADIUS} intensity={30} {...glassProps} />
              <Ionicons name="search" size={15} color={colors.tabBarInactive} style={{ marginRight: 9 }} />
              <Text style={[styles.searchPlaceholder, { color: colors.tabBarInactive }]}>
                Search stocks...
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => setAgentOpen(v => !v)}
              activeOpacity={0.82}
              style={styles.agentBtn}
            >
              <GlassBacking radius={AGENT_RADIUS} intensity={30} {...glassProps} />
              <Ionicons name="sparkles" size={16} color={colors.accent} />
            </TouchableOpacity>
          </Animated.View>
        </View>
      )}

      {/* Docked bottom tab bar — a normal (non-absolute) flex child now, so
          it reserves real layout space instead of floating over content.
          Flush, full-width, opaque, hairline top border — no more rounded
          floating pill. */}
      <View
        style={[
          styles.tabBar,
          { backgroundColor: colors.background, borderTopColor: colors.tabBarBorder, paddingBottom: bottomPadding },
        ]}
      >
        {visibleRoutes.map((route) => {
          const isFocused = route.name === state.routes[state.index]?.name;
          const color = isFocused ? colors.accent : colors.tabBarInactive;
          const label = ROUTE_TITLES[route.name] ?? route.name;

          return (
            <TouchableOpacity
              key={route.key}
              onPress={() => handleTabPress(route, isFocused)}
              style={styles.tabButton}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityState={isFocused ? { selected: true } : {}}
              accessibilityLabel={label}
            >
              {getIcon(route.name, color)}
              <Text style={[styles.label, { color }]}>{label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <SearchBottomSheet visible={searchOpen} onClose={() => setSearchOpen(false)} />

      <AgentModal
        visible={agentOpen}
        onClose={() => setAgentOpen(false)}
        onError={(msg) => toast.error(msg)}
      />
    </>
  );
};

const styles = StyleSheet.create({
  searchRowOuter: {
    position: 'absolute',
    left: 0,
    right: 0,
  },
  searchRow: {
    alignSelf: 'center',
    width: '88%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: SEARCH_ROW_GAP,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 13,
    borderRadius: SEARCH_RADIUS,
    overflow: 'hidden',
  },
  agentBtn: {
    width: 46,
    height: 46,
    borderRadius: AGENT_RADIUS,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  searchPlaceholder: { fontSize: 14, flex: 1 },
  tabBar: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 8,
  },
  tabButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  label: {
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.2,
    marginTop: 2,
  },
});

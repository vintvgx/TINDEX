import React, { useState, useCallback, useRef, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, Pressable, StyleSheet, Animated, Keyboard, Platform } from 'react-native';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useThemeColors, useAppColorScheme } from '@/lib/useColorScheme';
import { SearchBottomSheet } from '@/common/components/search/SearchBottomSheet';
import { useOptionsTicker } from '@/lib/optionsTickerContext';
import { AgentModal } from '@/common/components/agent/AgentModal';
import { useToast } from '@/common/components/ui/Toast';

const VISIBLE_ROUTE_ORDER = ['feed', 'strategy', 'orb', 'options', 'profile'] as const;

const ROUTE_TITLES: Record<string, string> = {
  feed: 'Home',
  strategy: 'Strategies',
  orb: 'ORB',
  options: 'Contracts',
  profile: 'Profile',
};

const SEARCH_RADIUS = 22;
const AGENT_RADIUS = 23;

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
  const { setOptionsTicker, optionsTicker } = useOptionsTicker();
  const toast = useToast();
  const [optionsInput, setOptionsInput] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const optionsInputRef = useRef<TextInput>(null);
  const currentRoute = state.routes[state.index]?.name;
  const isOnOptionsTab = currentRoute === 'options';
  const keyboardOffset = useRef(new Animated.Value(0)).current;
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const bottomPaddingRef = useRef(0);

  // Approximate height of the anchored tab bar (content) + the gap above it, used
  // to lift the floating search row clear of the keyboard.
  const TAB_BAR_CONTENT_HEIGHT = 56;
  const SEARCH_ROW_GAP = 10;
  const SEARCH_BAR_MARGIN = 8;

  const visibleRoutes = VISIBLE_ROUTE_ORDER
    .map(name => state.routes.find(r => r.name === name))
    .filter((route): route is (typeof state.routes)[number] => Boolean(route));
  // Extra breathing room below the tab labels so they clear the home-indicator /
  // gesture (Siri) bar at the very bottom of the screen.
  const bottomPadding = Math.max(insets.bottom, 12) + 8;

  // Glass styling derived from the active theme.
  const blurTint: 'light' | 'dark' = isDark ? 'dark' : 'light';
  const glassBorder   = isDark ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.12)';
  const glassFallback = isDark ? 'rgba(28,28,30,0.35)' : 'rgba(255,255,255,0.45)';
  // When the search field is focused, lay a near-opaque themed sheet behind the
  // text so it stays legible against busy content showing through the glass.
  const focusOverlay  = isDark ? 'rgba(28,28,30,0.88)' : 'rgba(255,255,255,0.92)';

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
      case 'strategy':
        return <Ionicons name="bar-chart-outline" size={20} color={color} />;
      case 'orb':
        return <Ionicons name="pulse-outline" size={20} color={color} />;
      case 'options':
        return <Ionicons name="layers-outline" size={20} color={color} />;
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
      <View pointerEvents="box-none" style={styles.container}>
        {/* Floating glass search + AI row (hovers over content) */}
        <Animated.View style={[styles.searchRow, { transform: [{ translateY: keyboardOffset }] }]}>
          {isOnOptionsTab ? (
            <View style={[styles.searchBar, { flex: 1 }]}>
              <GlassBacking radius={SEARCH_RADIUS} intensity={searchFocused ? 80 : 30} showFocus={searchFocused} {...glassProps} />
              <Ionicons name="layers-outline" size={15} color={colors.tabBarInactive} style={{ marginRight: 9 }} />
              <TextInput
                ref={optionsInputRef}
                style={[styles.searchPlaceholder, { color: colors.text, flex: 1 }]}
                placeholder="Options ticker (e.g. AAPL)..."
                placeholderTextColor={colors.tabBarInactive}
                value={optionsInput}
                onChangeText={t => setOptionsInput(t.toUpperCase())}
                onFocus={() => setSearchFocused(true)}
                onBlur={() => setSearchFocused(false)}
                autoCapitalize="characters"
                autoCorrect={false}
                maxLength={5}
                returnKeyType="search"
                onSubmitEditing={() => {
                  const t = optionsInput.trim();
                  if (t.length >= 1) setOptionsTicker(t);
                  optionsInputRef.current?.blur();
                }}
              />
              {optionsInput.length > 0 && (
                <TouchableOpacity
                  onPress={() => { setOptionsInput(''); setOptionsTicker(''); }}
                  hitSlop={8}
                >
                  <Ionicons name="close-circle" size={15} color={colors.tabBarInactive} />
                </TouchableOpacity>
              )}
            </View>
          ) : (
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
          )}

          <TouchableOpacity
            onPress={() => setAgentOpen(true)}
            activeOpacity={0.82}
            style={styles.agentBtn}
          >
            <GlassBacking radius={AGENT_RADIUS} intensity={30} {...glassProps} />
            <Ionicons name="sparkles" size={16} color={colors.accent} />
          </TouchableOpacity>
        </Animated.View>

        {/* Traditional anchored bottom tab bar (full width, flush to the edge) */}
        <View
          style={[
            styles.tabBar,
            {
              backgroundColor: colors.tabBar,
              borderTopColor: colors.tabBarBorder,
              paddingBottom: bottomPadding,
            },
          ]}
        >
          {visibleRoutes.map(route => {
            const isFocused = state.routes[state.index]?.name === route.name;
            const color = isFocused ? colors.tabBarActive : colors.tabBarInactive;
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
      </View>

      <SearchBottomSheet visible={searchOpen} onClose={() => setSearchOpen(false)} />

      <AgentModal
        visible={agentOpen}
        onClose={() => setAgentOpen(false)}
        ticker={isOnOptionsTab && optionsTicker ? optionsTicker : undefined}
        onError={(msg) => toast.error(msg)}
      />
    </>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
  },
  searchRow: {
    alignSelf: 'center',
    width: '88%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
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
    width: '100%',
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 10,
  },
  tabButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    paddingVertical: 2,
  },
  label: {
    fontSize: 10,
    fontWeight: '500',
    letterSpacing: 0.2,
    marginTop: 2,
  },
});

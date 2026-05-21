import React, { useState, useCallback, useRef, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, Pressable, StyleSheet, Animated, Keyboard, Platform } from 'react-native';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNotificationHistory } from '@/hooks/queries/notifications/useNotificationHistory';
import { useServicesStatus } from '@/hooks/queries/services/useServicesStatus';
import { useThemeColors } from '@/lib/useColorScheme';
import { SearchBottomSheet } from '@/common/components/search/SearchBottomSheet';
import { useOptionsTicker } from '@/lib/optionsTickerContext';
import { AgentModal } from '@/common/components/agent/AgentModal';
import { useToast } from '@/common/components/ui/Toast';

const VISIBLE_ROUTES = new Set(['feed', 'portfolio', 'options', 'orb', 'notifications', 'profile']);

const ROUTE_TITLES: Record<string, string> = {
  feed: 'Feed',
  portfolio: 'Portfolio',
  options: 'Options',
  orb: 'ORB',
  notifications: 'Alerts',
  profile: 'Profile',
};

export const CustomTabBar: React.FC<BottomTabBarProps> = ({ state, navigation }) => {
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const { unreadCount } = useNotificationHistory();
  const { data: servicesStatus } = useServicesStatus();
  const isORBRunning       = servicesStatus?.orb?.running ?? false;
  const isContractsRunning = servicesStatus?.contracts?.running ?? false;
  const servicesDotColor = (isORBRunning && isContractsRunning)
    ? colors.success
    : (isORBRunning || isContractsRunning)
      ? colors.warning
      : colors.error;
  const [searchOpen, setSearchOpen] = useState(false);
  const [agentOpen, setAgentOpen] = useState(false);
  const { setOptionsTicker, optionsTicker } = useOptionsTicker();
  const toast = useToast();
  const [optionsInput, setOptionsInput] = useState('');
  const optionsInputRef = useRef<TextInput>(null);
  const currentRoute = state.routes[state.index]?.name;
  const isOnOptionsTab = currentRoute === 'options';
  const keyboardOffset = useRef(new Animated.Value(0)).current;
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  // Keep a ref so the keyboard listener always sees the latest value without re-subscribing
  const bottomPaddingRef = useRef(0);

  const TAB_PILL_HEIGHT = 68; // matches styles.tabBar height
  const CONTAINER_GAP = 8;   // matches styles.container gap
  const SEARCH_BAR_MARGIN = 8; // gap between search bar bottom and keyboard top

  const visibleRoutes = state.routes.filter(r => VISIBLE_ROUTES.has(r.name));
  const bottomPadding = Math.max(insets.bottom, 16);

  useEffect(() => {
    bottomPaddingRef.current = bottomPadding;
  }, [bottomPadding]);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const onShow = Keyboard.addListener(showEvent, e => {
      setKeyboardVisible(true);
      // The search bar's bottom edge sits this far above the screen bottom naturally
      const searchBarBaseOffset = bottomPaddingRef.current + TAB_PILL_HEIGHT + CONTAINER_GAP;
      // Only translate enough to clear the keyboard by SEARCH_BAR_MARGIN
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
        return <Ionicons name="newspaper-outline" size={20} color={color} />;
      case 'portfolio':
        return <Ionicons name="wallet-outline" size={20} color={color} />;
      case 'options':
        return <Ionicons name="layers-outline" size={20} color={color} />;
      case 'orb':
        return <Ionicons name="pulse-outline" size={20} color={color} />;
      case 'notifications':
        return (
          <View>
            <Ionicons name="notifications-outline" size={20} color={color} />
            {unreadCount > 0 && (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{unreadCount > 99 ? '99+' : unreadCount}</Text>
              </View>
            )}
          </View>
        );
      case 'profile':
        return (
          <View style={styles.profileContainer}>
            <Ionicons name="person-outline" size={20} color={color} />
            <View
              style={[
                styles.statusDot,
                { backgroundColor: servicesDotColor, borderColor: colors.tabBar },
              ]}
            />
          </View>
        );
      default:
        return null;
    }
  };

  return (
    <>
      {/* Transparent overlay — catches taps outside the search bar when keyboard is open */}
      {keyboardVisible && (
        <Pressable style={StyleSheet.absoluteFillObject} onPress={Keyboard.dismiss} />
      )}
      <View
        pointerEvents="box-none"
        style={[styles.container, { paddingBottom: bottomPadding }]}
      >
        {/* Search bar + AI agent button — animate up together with keyboard */}
        <Animated.View style={{
          transform: [{ translateY: keyboardOffset }],
          width: '88%',
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
        }}>
          {isOnOptionsTab ? (
            <View style={[styles.searchBar, { flex: 1, backgroundColor: colors.tabBar, borderColor: colors.tabBarBorder }]}>
              <Ionicons name="layers-outline" size={15} color={colors.tabBarInactive} style={{ marginRight: 9 }} />
              <TextInput
                ref={optionsInputRef}
                style={[styles.searchPlaceholder, { color: colors.text, flex: 1 }]}
                placeholder="Options ticker (e.g. AAPL)..."
                placeholderTextColor={colors.tabBarInactive}
                value={optionsInput}
                onChangeText={t => setOptionsInput(t.toUpperCase())}
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
              style={[styles.searchBar, { flex: 1, backgroundColor: colors.tabBar, borderColor: colors.tabBarBorder }]}
            >
              <Ionicons name="search" size={15} color={colors.tabBarInactive} style={{ marginRight: 9 }} />
              <Text style={[styles.searchPlaceholder, { color: colors.tabBarInactive }]}>
                Search stocks...
              </Text>
            </TouchableOpacity>
          )}

          {/* AI agent button */}
          <TouchableOpacity
            onPress={() => setAgentOpen(true)}
            activeOpacity={0.82}
            style={[styles.agentBtn, { backgroundColor: colors.tabBar, borderColor: colors.tabBarBorder }]}
          >
            <Ionicons name="sparkles" size={16} color={colors.accent} />
          </TouchableOpacity>
        </Animated.View>

        {/* Tab pill */}
        <View
          style={[
            styles.tabBar,
            { backgroundColor: colors.tabBar, borderColor: colors.tabBarBorder },
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
    alignItems: 'center',
    gap: 8,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 13,
    borderRadius: 22,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.22,
    shadowRadius: 12,
    elevation: 8,
  },
  agentBtn: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.22,
    shadowRadius: 12,
    elevation: 8,
  },
  searchPlaceholder: { fontSize: 14, flex: 1 },
  tabBar: {
    flexDirection: 'row',
    width: '88%',
    height: 68,
    borderRadius: 34,
    borderWidth: 1,
    paddingBottom: 18,
    paddingTop: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
    elevation: 12,
  },
  tabButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  label: {
    fontSize: 9,
    fontWeight: '500',
    letterSpacing: 0.1,
    marginTop: 2,
  },
  profileContainer: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusDot: {
    position: 'absolute',
    top: -1,
    right: -6,
    width: 7,
    height: 7,
    borderRadius: 4,
    borderWidth: 1.5,
  },
  badge: {
    position: 'absolute',
    top: -4,
    right: -8,
    backgroundColor: '#FF453A',
    borderRadius: 8,
    minWidth: 16,
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  badgeText: {
    color: '#fff',
    fontSize: 9,
    fontWeight: '700',
  },
});

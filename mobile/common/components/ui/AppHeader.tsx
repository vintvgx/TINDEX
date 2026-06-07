/**
 * AppHeader — global top bar shown on every tab screen, beneath the TickerTape.
 *
 * Layout mirrors CollectPure: ☰ hamburger (opens the left DrawerMenu) · centered
 * wordmark logo · a right action (notifications bell with unread badge).
 */
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useThemeColors } from '@/lib/useColorScheme';
import { useDrawer } from '@/lib/DrawerContext';
import { useNotificationHistory } from '@/hooks/queries/notifications/useNotificationHistory';

export function AppHeader() {
  const colors = useThemeColors();
  const { openDrawer } = useDrawer();
  const { unreadCount } = useNotificationHistory();

  return (
    <View
      style={[
        styles.header,
        { backgroundColor: colors.headerBg, borderBottomColor: colors.headerBorder },
      ]}
    >
      {/* Hamburger */}
      <Pressable
        onPress={openDrawer}
        hitSlop={10}
        style={styles.iconBtn}
        accessibilityRole="button"
        accessibilityLabel="Open menu"
      >
        <Ionicons name="menu" size={26} color={colors.text} />
      </Pressable>

      {/* Centered wordmark */}
      <View style={styles.logo} pointerEvents="none">
        <Ionicons name="sparkles" size={16} color={colors.brand} style={{ marginRight: 6 }} />
        <Text style={[styles.logoText, { color: colors.text }]}>tindex</Text>
      </View>

      {/* Notifications */}
      <Pressable
        onPress={() => router.push('/(app)/(tabs)/notifications')}
        hitSlop={10}
        style={styles.iconBtn}
        accessibilityRole="button"
        accessibilityLabel="Notifications"
      >
        <Ionicons name="notifications-outline" size={23} color={colors.text} />
        {unreadCount > 0 && (
          <View style={[styles.badge, { backgroundColor: colors.badge }]}>
            <Text style={styles.badgeText}>{unreadCount > 99 ? '99+' : unreadCount}</Text>
          </View>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  iconBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logo: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  logoText: {
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: -0.5,
  },
  badge: {
    position: 'absolute',
    top: 4,
    right: 4,
    borderRadius: 9,
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

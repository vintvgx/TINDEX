import React, { useState } from 'react';
import {
  View, Text, Pressable, ScrollView, StyleSheet, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useThemeColors } from '@/lib/useColorScheme';
import { useAuth } from '@/common/utils/context/auth/AuthContext';
import { signOut } from '@/common/utils/auth/function';
import { useAppColorScheme } from '@/lib/useColorScheme';
import { SearchBottomSheet } from '@/common/components/search/SearchBottomSheet';
import { useFloatingTabBarHeight } from '@/common/components/ui/CustomTabBar';

interface NavItem {
  label: string;
  route: string;
}

interface NavSection {
  title?: string;
  beta?: boolean;
  items: NavItem[];
}

// Home, ORB Monitor, Contracts, Accounts, Strategy Control, Live Position,
// Signals, Trade Log, and Daily Review moved into the Home/ORB/Accounts
// bottom tabs + their swipeable segments — this list is only what's NOT
// reachable that way.
const SECTIONS: NavSection[] = [
  {
    title: 'Menu',
    items: [
      { label: 'Watchlists', route: '/(app)/(tabs)/watchlists' },
      { label: 'Track Portfolio', route: '/(app)/(tabs)/track' },
      { label: 'Alerts', route: '/(app)/(tabs)/notifications' },
    ],
  },
  {
    title: 'Swing Trading',
    beta: true,
    items: [
      { label: 'Swing Trade Scan', route: '/(app)/(tabs)/swing' },
    ],
  },
  {
    title: 'Settings',
    items: [
      { label: 'Profile & Settings', route: '/(app)/(tabs)/profile' },
    ],
  },
];

export default function MenuScreen() {
  const colors = useThemeColors();
  const { authState: { isAuthenticated, profile, user } } = useAuth();
  const { isDarkColorScheme, toggleColorScheme } = useAppColorScheme();
  const [searchOpen, setSearchOpen] = useState(false);
  const tabBarHeight = useFloatingTabBarHeight();

  const go = (route: string) => router.push(route as any);

  const handleSignOut = () => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: async () => {
          try { await signOut(); }
          catch { Alert.alert('Sign Out Failed', 'Please try again.'); }
        },
      },
    ]);
  };

  const displayName = profile?.full_name || profile?.username || user?.email || 'Account';
  const initials = displayName.slice(0, 2).toUpperCase();

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['left', 'right']}>
      {/* Search — the wordmark/title itself already lives in AppHeader + the
          "Menu" tab label, so this row is just the one useful action left. */}
      <View style={styles.topRow}>
        <Pressable
          onPress={() => setSearchOpen(true)}
          hitSlop={10}
          style={[styles.searchBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}
        >
          <Ionicons name="search" size={18} color={colors.text} />
          <Text style={[styles.searchBtnText, { color: colors.tabBarInactive }]}>Search stocks...</Text>
        </Pressable>
      </View>

      {/* ── Profile strip ──────────────────────────────────── */}
      {isAuthenticated && (
        <Pressable
          onPress={() => go('/(app)/(tabs)/profile')}
          style={[styles.profileStrip, { backgroundColor: colors.surface, borderColor: colors.border }]}
        >
          <View style={[styles.avatar, { backgroundColor: '#4A9EFF22' }]}>
            <Text style={[styles.avatarText, { color: '#4A9EFF' }]}>{initials}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.profileName, { color: colors.text }]} numberOfLines={1}>
              {displayName}
            </Text>
            {user?.email && (
              <Text style={[styles.profileEmail, { color: colors.textTertiary }]} numberOfLines={1}>
                {user.email}
              </Text>
            )}
          </View>
        </Pressable>
      )}

      {/* ── Nav sections ───────────────────────────────────── */}
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
        {SECTIONS.map((section, si) => (
          <View key={si} style={styles.section}>
            {section.title && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14, marginLeft: 4 }}>
                <Text style={[styles.sectionTitle, { color: colors.textTertiary, marginBottom: 0, marginLeft: 0 }]}>
                  {section.title}
                </Text>
                {section.beta && (
                  <View style={{ backgroundColor: '#8B5CF622', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 }}>
                    <Text style={{ color: '#8B5CF6', fontSize: 9, fontWeight: '700', letterSpacing: 0.5 }}>BETA</Text>
                  </View>
                )}
              </View>
            )}
            <View style={styles.group}>
              {section.items.map((item, idx) => (
                <Pressable
                  key={item.route}
                  onPress={() => go(item.route)}
                  style={({ pressed }) => [
                    styles.row,
                    idx === section.items.length - 1 && styles.rowLast,
                    { backgroundColor: pressed ? colors.surface : 'transparent' },
                  ]}
                >
                  <Text style={[styles.rowLabel, { color: colors.text }]}>{item.label}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        ))}
      </ScrollView>

      {/* ── Footer: sign out + theme toggle ────────────────── */}
      {/* Extra bottom padding clears the floating pill tab bar, which is
          absolutely positioned over content rather than reserving space. */}
      <View style={[styles.footer, { borderTopColor: colors.border, paddingBottom: tabBarHeight }]}>
        <View style={styles.footerRow}>
          {isAuthenticated ? (
            <Pressable
              onPress={handleSignOut}
              style={({ pressed }) => [
                styles.footerBtn,
                { backgroundColor: colors.surface, borderColor: colors.border },
                pressed && { opacity: 0.7 },
              ]}
            >
              <Text style={[styles.footerLabel, { color: '#FF453A' }]}>Sign Out</Text>
            </Pressable>
          ) : (
            <Pressable
              onPress={() => go('/(public)/auth')}
              style={({ pressed }) => [
                styles.footerBtn,
                { backgroundColor: colors.surface, borderColor: colors.border },
                pressed && { opacity: 0.7 },
              ]}
            >
              <Text style={[styles.footerLabel, { color: colors.text }]}>Login</Text>
            </Pressable>
          )}

          <Pressable
            onPress={toggleColorScheme}
            hitSlop={8}
            style={({ pressed }) => [
              styles.themeBtn,
              { backgroundColor: colors.surface, borderColor: colors.border },
              pressed && { opacity: 0.7 },
            ]}
          >
            <Ionicons
              name={isDarkColorScheme ? 'sunny-outline' : 'moon-outline'}
              size={20}
              color={colors.text}
            />
          </Pressable>
        </View>
      </View>

      <SearchBottomSheet visible={searchOpen} onClose={() => setSearchOpen(false)} />
    </SafeAreaView>
  );
}

const H_PADDING = 24;

const styles = StyleSheet.create({
  topRow: {
    paddingHorizontal: H_PADDING,
    paddingTop: 16,
    marginBottom: 20,
  },
  searchBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
  },
  searchBtnText: { fontSize: 14 },

  profileStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    marginHorizontal: H_PADDING,
    marginBottom: 28,
  },
  avatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontSize: 16, fontWeight: '700' },
  profileName: { fontSize: 16, fontWeight: '600', marginBottom: 3 },
  profileEmail: { fontSize: 13, lineHeight: 18 },

  scrollContent: {
    paddingHorizontal: H_PADDING,
    paddingTop: 4,
    paddingBottom: 12,
  },
  section: { marginBottom: 32 },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 14,
    marginLeft: 4,
  },
  group: {
    paddingLeft: 10,
    gap: 5,
  },
  row: {
    paddingVertical: 20,
    paddingHorizontal: 10,
    borderBottomWidth: 4,
    borderBottomColor: 'rgba(128,128,128,0.25)',
  },
  rowLast: {
    borderBottomWidth: 0,
  },
  rowLabel: { fontSize: 17, fontWeight: '500', letterSpacing: -0.2 },

  footer: {
    paddingHorizontal: H_PADDING,
    paddingTop: 16,
    marginTop: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  footerBtn: {
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: 16,
    paddingHorizontal: 18,
    alignItems: 'center',
  },
  footerLabel: { fontSize: 16, fontWeight: '600', letterSpacing: -0.2 },
  themeBtn: {
    width: 52,
    height: 52,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

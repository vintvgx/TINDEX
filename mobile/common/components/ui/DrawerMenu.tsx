import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, Pressable, Modal, Animated, ScrollView,
  StyleSheet, Dimensions, Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { router } from 'expo-router';
import { useThemeColors } from '@/lib/useColorScheme';
import { useDrawer } from '@/lib/DrawerContext';
import { useAuth } from '@/common/utils/context/auth/AuthContext';
import { signOut } from '@/common/utils/auth/function';
import { useAppColorScheme } from '@/lib/useColorScheme';
import { SearchBottomSheet } from '@/common/components/search/SearchBottomSheet';

const SCREEN_WIDTH = Dimensions.get('window').width;
const PANEL_WIDTH = Math.min(SCREEN_WIDTH * 0.86, 380);
const H_PADDING = 24;

interface NavItem {
  label: string;
  route: string;
  onClick?: () => void;
}

interface NavSection {
  title?: string;
  beta?: boolean;
  items: NavItem[];
}

const SECTIONS: NavSection[] = [
  {
    title: 'Menu',
    items: [
      { label: 'Home', route: '/(app)/(tabs)/feed' },
      { label: 'ORB Monitor', route: '/(app)/(tabs)/orb' },
      { label: 'Contracts', route: '/(app)/(tabs)/options' },
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
    title: 'ORB Trading',
    items: [
      { label: '0DTE Watchlist', route: '/(app)/(tabs)/zero_dte_watchlist' },
      { label: 'Accounts', route: '/(app)/(tabs)/accounts' },
      { label: 'Strategy Control', route: '/(app)/(tabs)/strategy' },
      { label: 'Live Position', route: '/(app)/(tabs)/position' },
      { label: 'Trade Log', route: '/(app)/(tabs)/tradelog' },
      { label: 'Daily Review', route: '/(app)/(tabs)/daily_review' },
    ],
  },
  {
    title: 'Settings',
    items: [
      { label: 'Profile & Settings', route: '/(app)/(tabs)/profile' },
    ],
  },
];

export function DrawerMenu() {
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const { open, closeDrawer } = useDrawer();
  const { authState: { isAuthenticated, profile, user } } = useAuth();
  const { isDarkColorScheme, toggleColorScheme } = useAppColorScheme();

  const [mounted, setMounted] = useState(open);
  const [searchOpen, setSearchOpen] = useState(false);
  const slide = useRef(new Animated.Value(-PANEL_WIDTH)).current;
  const fade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (open) {
      setMounted(true);
      Animated.parallel([
        Animated.spring(slide, { toValue: 0, useNativeDriver: true, damping: 24, stiffness: 240 }),
        Animated.timing(fade, { toValue: 1, duration: 200, useNativeDriver: true }),
      ]).start();
    } else if (mounted) {
      Animated.parallel([
        Animated.timing(slide, { toValue: -PANEL_WIDTH, duration: 220, useNativeDriver: true }),
        Animated.timing(fade, { toValue: 0, duration: 200, useNativeDriver: true }),
      ]).start(({ finished }) => { if (finished) setMounted(false); });
    }
  }, [open, mounted, slide, fade]);

  const go = (route: string) => {
    closeDrawer();
    setTimeout(() => router.push(route as any), 180);
  };

  const handleSignOut = () => {
    closeDrawer();
    setTimeout(() => {
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
    }, 180);
  };

  const displayName = profile?.full_name || profile?.username || user?.email || 'Account';
  const initials = displayName.slice(0, 2).toUpperCase();

  return (
    <>
      <Modal visible={mounted} transparent animationType="none" onRequestClose={closeDrawer}>
        <StatusBar style={isDarkColorScheme ? 'light' : 'dark'} />

        <Animated.View style={[styles.backdrop, { opacity: fade }]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={closeDrawer} />
        </Animated.View>

        <Animated.View
          style={[
            styles.panel,
            {
              width: PANEL_WIDTH,
              backgroundColor: colors.background,
              paddingTop: insets.top + 24,
              paddingBottom: insets.bottom + 16,
              transform: [{ translateX: slide }],
            },
          ]}
        >
          {/* ── Header ─────────────────────────────────────────── */}
          <View style={styles.panelHeader}>
            <Text style={[styles.logoText, { color: colors.text }]}>tindex</Text>
            <Pressable
              onPress={() => { closeDrawer(); setTimeout(() => setSearchOpen(true), 180); }}
              hitSlop={10}
              style={[styles.searchBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}
            >
              <Ionicons name="search" size={18} color={colors.text} />
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
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.scrollContent}
          >
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
                {/* In each section's group, add the border color from theme: */}
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
          <View style={[styles.footer, { borderTopColor: colors.border }]}>
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
        </Animated.View>
      </Modal>

      <SearchBottomSheet visible={searchOpen} onClose={() => setSearchOpen(false)} />
    </>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  panel: {
    position: 'absolute',
    top: 0,
    left: 0,
    bottom: 0,
    shadowColor: '#000',
    shadowOffset: { width: 6, height: 0 },
    shadowOpacity: 0.2,
    shadowRadius: 20,
    elevation: 20,
  },

  // ── Header ──
  panelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: H_PADDING,
    marginBottom: 28,
  },
  logoText: { fontSize: 28, fontWeight: '800', letterSpacing: -0.8 },
  searchBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },

  // ── Profile strip ──
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

  // ── Sections ──
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
    // padding: 5,
    paddingLeft: 10,
    gap: 5
  },
  row: {
    paddingVertical:   20,
    paddingHorizontal: 10,
    borderBottomWidth: 4,
    borderBottomColor: 'rgba(128,128,128,0.25)',
  },
  rowLast: {
    borderBottomWidth: 0,
  },
  rowLabel: { fontSize: 17, fontWeight: '500', letterSpacing: -0.2 },

  // ── Footer ──
  footer: {
    paddingHorizontal: H_PADDING,
    paddingTop: 16,
    marginTop: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  footerRow: {
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'space-between',
  },
  footerBtn: {
    borderRadius:      14,
    borderWidth:       1,
    paddingVertical:   16,
    paddingHorizontal: 18,
    alignItems:        'center',
  },
  footerLabel: { fontSize: 16, fontWeight: '600', letterSpacing: -0.2 },
  themeBtn: {
    width:          52,
    height:         52,
    borderRadius:   14,
    borderWidth:    1,
    alignItems:     'center',
    justifyContent: 'center',
  },
});
/**
 * DrawerMenu — left slide-in navigation drawer (CollectPure-style).
 *
 * Header: wordmark + search. Body: every app view grouped into rounded
 * containers. Footer: Login (signed-out) or profile + Sign Out (signed-in).
 * Open/close state comes from DrawerContext; the AppHeader hamburger drives it.
 */
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
const PANEL_WIDTH = Math.min(SCREEN_WIDTH * 0.84, 360);

interface NavItem {
  label: string;
  route: string;
}
interface NavSection {
  title?: string;
  items: NavItem[];
}

const SECTIONS: NavSection[] = [
  {
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
    title: 'ORB Trading',
    items: [
      { label: 'Strategy Control', route: '/(app)/(tabs)/strategy' },
      { label: 'Live Position', route: '/(app)/(tabs)/position' },
      { label: 'Trade Log & Stats', route: '/(app)/(tabs)/tradelog' },
      { label: 'Accounts', route: '/(app)/(tabs)/accounts' },
    ],
  },
  {
    title: 'Account',
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

  const displayName =
    profile?.full_name || profile?.username || user?.email || 'Account';

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
              paddingTop: insets.top + 12,
              paddingBottom: insets.bottom + 16,
              transform: [{ translateX: slide }],
            },
          ]}
        >
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

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 8 }}>
            {SECTIONS.map((section, si) => (
              <View key={si} style={{ marginBottom: 18 }}>
                {section.title && (
                  <Text style={[styles.sectionTitle, { color: colors.textTertiary }]}>
                    {section.title}
                  </Text>
                )}
                <View style={[styles.group, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                  {section.items.map((item, ii) => (
                    <Pressable
                      key={item.route}
                      onPress={() => go(item.route)}
                      style={({ pressed }) => [
                        styles.row,
                        ii < section.items.length - 1 && {
                          borderBottomWidth: StyleSheet.hairlineWidth,
                          borderBottomColor: colors.separator,
                        },
                        pressed && { backgroundColor: colors.surfaceSecondary },
                      ]}
                    >
                      <Text style={[styles.rowLabel, { color: colors.text }]}>{item.label}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            ))}

            <Pressable
              onPress={toggleColorScheme}
              style={({ pressed }) => [
                styles.group,
                styles.row,
                { backgroundColor: colors.surface, borderColor: colors.border, marginBottom: 18 },
                pressed && { opacity: 0.7 },
              ]}
            >
              <Text style={[styles.rowLabel, { color: colors.text }]}>
                {isDarkColorScheme ? 'Light Mode' : 'Dark Mode'}
              </Text>
            </Pressable>
          </ScrollView>

          <View style={[styles.group, { backgroundColor: colors.surface, borderColor: colors.border, marginBottom: 0 }]}>
            {isAuthenticated ? (
              <Pressable onPress={handleSignOut} style={styles.row}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.rowLabel, { color: colors.error }]}>Sign Out</Text>
                  <Text style={[styles.rowSub, { color: colors.textTertiary }]} numberOfLines={1}>
                    {displayName}
                  </Text>
                </View>
              </Pressable>
            ) : (
              <Pressable onPress={() => go('/(public)/auth')} style={styles.row}>
                <Text style={[styles.rowLabel, { color: colors.text }]}>Login</Text>
              </Pressable>
            )}
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
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  panel: {
    position: 'absolute',
    top: 0,
    left: 0,
    bottom: 0,
    paddingHorizontal: 20,
    shadowColor: '#000',
    shadowOffset: { width: 4, height: 0 },
    shadowOpacity: 0.18,
    shadowRadius: 16,
    elevation: 16,
  },
  panelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 22,
  },
  logoText: { fontSize: 24, fontWeight: '700', letterSpacing: -0.6 },
  searchBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: 10,
    marginLeft: 4,
  },
  group: {
    borderRadius: 14,
    borderWidth: 1,
    overflow: 'hidden',
  },
  row: {
    paddingHorizontal: 18,
    paddingVertical: 16,
  },
  rowLabel: { fontSize: 17, fontWeight: '500', letterSpacing: -0.2 },
  rowSub: { fontSize: 13, marginTop: 4 },
});

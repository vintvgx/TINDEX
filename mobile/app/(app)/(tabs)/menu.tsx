import React from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useThemeColors } from '@/lib/useColorScheme';

/**
 * 0.7 redesign Menu — every screen in one place. Tapping a row navigates
 * there (the Home wheel relabels via the tab state).
 */

const SECTIONS: { title: string; items: { key: string; label: string; icon: string }[] }[] = [
  {
    title: 'Screens',
    items: [
      { key: 'feed', label: 'Home', icon: 'home-outline' },
      { key: 'monitor', label: 'Monitor', icon: 'radar-outline' },
      { key: 'daily_review', label: 'Daily', icon: 'calendar-outline' },
      { key: 'tradelog', label: 'Log', icon: 'list-outline' },
      { key: 'accounts', label: 'Account', icon: 'wallet-outline' },
      { key: 'profile', label: 'Profile', icon: 'person-outline' },
    ],
  },
  {
    title: 'More',
    items: [
      { key: 'orb', label: 'ORB', icon: 'pulse-outline' },
      { key: 'brief', label: 'Brief', icon: 'newspaper-outline' },
      { key: 'watchlists', label: 'Watchlists', icon: 'bookmark-outline' },
      { key: 'signals', label: 'Signals', icon: 'notifications-outline' },
      { key: 'dashboard', label: 'Dashboard', icon: 'grid-outline' },
      { key: 'position', label: 'Positions', icon: 'briefcase-outline' },
      { key: 'options', label: 'Contracts', icon: 'layers-outline' },
      { key: 'strategy', label: 'Strategy', icon: 'git-branch-outline' },
      { key: 'simulation', label: 'Simulation', icon: 'flask-outline' },
    ],
  },
];

export default function MenuScreen() {
  const colors = useThemeColors();
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
    >
      {SECTIONS.map((s) => (
        <View key={s.title} style={{ marginBottom: 20 }}>
          <Text
            style={{
              fontSize: 11,
              fontWeight: '700',
              letterSpacing: 1.5,
              color: colors.textTertiary,
              marginBottom: 8,
              marginLeft: 4,
            }}
          >
            {s.title.toUpperCase()}
          </Text>
          <View
            style={{
              borderRadius: 14,
              backgroundColor: colors.card,
              borderWidth: 1,
              borderColor: colors.cardBorder,
              overflow: 'hidden',
            }}
          >
            {s.items.map((item, i) => (
              <TouchableOpacity
                key={item.key}
                onPress={() => router.push(`/(app)/(tabs)/${item.key}` as never)}
                activeOpacity={0.7}
                style={[
                  styles.row,
                  i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
                ]}
              >
                <Ionicons name={item.icon as never} size={18} color={colors.textSecondary} />
                <Text style={[styles.label, { color: colors.text }]}>{item.label}</Text>
                <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
              </TouchableOpacity>
            ))}
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  label: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
  },
});

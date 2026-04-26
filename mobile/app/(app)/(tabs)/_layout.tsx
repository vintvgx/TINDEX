import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import { useNotificationHistory } from '@/hooks/queries/notifications/useNotificationHistory';
import { useORBStatus } from '@/hooks/queries/orb/useORBStatus';
import { useThemeColors } from '@/lib/useColorScheme';

export default function Layout() {
  const { unreadCount } = useNotificationHistory();
  const { data: orbStatus } = useORBStatus();
  const isORBRunning = orbStatus?.running ?? false;
  const colors = useThemeColors();

  // Memoize the style objects so they are not recreated on every tab press
  const screenOptions = useMemo(() => ({
    headerShown: false,
    tabBarStyle: {
      backgroundColor: colors.tabBar,
      borderTopWidth: 0,
      height: 68,
      width: '88%' as const,
      paddingBottom: 18,
      paddingTop: 10,
      borderRadius: 34,
      alignSelf: 'center' as const,
      bottom: 22,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.25,
      shadowRadius: 16,
      elevation: 12,
      borderWidth: 1,
      borderColor: colors.tabBarBorder,
    },
    tabBarActiveTintColor: colors.tabBarActive,
    tabBarInactiveTintColor: colors.tabBarInactive,
    tabBarLabelStyle: styles.label,
    tabBarIconStyle: styles.icon,
  }), [colors]);

  const orbStatusDotStyle = useMemo(() => ({
    ...styles.statusDot,
    backgroundColor: isORBRunning ? '#30D158' : '#FF453A',
    borderColor: colors.tabBar,
  }), [isORBRunning, colors.tabBar]);

  return (
    <Tabs initialRouteName="orb" screenOptions={screenOptions}>
      <Tabs.Screen
        name="feed"
        options={{
          title: 'Feed',
          tabBarIcon: ({ color }) => <Ionicons name="newspaper-outline" size={20} color={color} />,
        }}
      />
      <Tabs.Screen
        name="track"
        options={{
          title: 'Track',
          tabBarIcon: ({ color }) => <Ionicons name="analytics-outline" size={20} color={color} />,
        }}
      />
      <Tabs.Screen name="track-legacy" options={{ href: null }} />
      <Tabs.Screen
        name="orb"
        options={{
          title: 'ORB',
          tabBarIcon: ({ color }) => (
            <View style={styles.orbIconContainer}>
              <Ionicons name="pulse-outline" size={20} color={color} />
              <View style={orbStatusDotStyle} />
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="notifications"
        options={{
          title: 'Alerts',
          tabBarBadge: unreadCount > 0 ? unreadCount : undefined,
          tabBarIcon: ({ color }) => <Ionicons name="notifications-outline" size={20} color={color} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color }) => <Ionicons name="person-outline" size={20} color={color} />,
        }}
      />
      <Tabs.Screen name="search" options={{ href: null }} />
      <Tabs.Screen name="watchlists" options={{ href: null }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 10, fontWeight: '500', letterSpacing: 0.2 },
  icon: { marginBottom: 2 },
  orbIconContainer: { position: 'relative', alignItems: 'center', justifyContent: 'center' },
  statusDot: {
    position: 'absolute',
    top: -1,
    right: -6,
    width: 7,
    height: 7,
    borderRadius: 4,
    borderWidth: 1.5,
  },
});

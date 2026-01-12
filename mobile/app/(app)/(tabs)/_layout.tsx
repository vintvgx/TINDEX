/**
 * Layout for (app) directory with bottom tab navigation
 */
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { View } from 'react-native';
import { useNotificationHistory } from '@/hooks/queries/notifications/useNotificationHistory';
import { useORBStatus } from '@/hooks/queries/orb/useORBStatus';
import { cn } from '@/lib/utils';

export default function Layout() {
  const { unreadCount } = useNotificationHistory();
  const { data: orbStatus } = useORBStatus();
  const isORBRunning = orbStatus?.running ?? false;

  return (
    <Tabs
      initialRouteName="orb"
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: '#1A1A1A',
          borderTopWidth: 0,
          height: 70,
          width: "90%",
          paddingBottom: 20,
          paddingTop: 10,
          justifyContent: 'center',
          borderRadius: 30,
          alignSelf: 'center',
          bottom: 20,
          shadowColor: '#000',
          shadowOffset: {
            width: 0,
            height: 4,
          },
          shadowOpacity: 0.3,
          shadowRadius: 8,
          elevation: 10,
        },
        tabBarActiveTintColor: 'white',
        tabBarInactiveTintColor: '#666',
        tabBarLabelStyle: {
          fontSize: 10,
          fontWeight: '500',
        },
        tabBarIconStyle: {
          marginBottom: 4,
        },
        // Add navigation animations
        // animation: 'slide_from_right',
        // animationDuration: 300,
      }}
    >
      <Tabs.Screen 
        name="feed" 
        options={{
          title: 'Feed',
          tabBarIcon: ({ color }) => (
            <Ionicons name="menu" size={20} color={color} />
          ),
        }}
      />
      <Tabs.Screen 
        name="track" 
        options={{
          title: 'Track',
          tabBarIcon: ({ color }) => (
            <Ionicons name="analytics" size={20} color={color} />
          ),
        }}
      />
      <Tabs.Screen 
        name="orb" 
        options={{
          title: 'ORB',
          tabBarIcon: ({ color }) => (
            <View className="relative items-center justify-center">
              <Ionicons name="pulse" size={20} color={color} />
              <View 
                className={cn(
                  "absolute -top-0.5 -right-1.5 w-2 h-2 rounded-full border-[1.5px] border-[#1A1A1A]",
                  isORBRunning ? "bg-[#10B981]" : "bg-[#EF4444]"
                )} 
              />
            </View>
          ),
        }}
      />
      <Tabs.Screen 
        name="notifications" 
        options={{
          title: 'Notifications',
          tabBarBadge: unreadCount > 0 ? unreadCount : undefined,
          tabBarIcon: ({ color }) => (
            <Ionicons name="notifications-outline" size={20} color={color} />
          ),
        }}
      />
      <Tabs.Screen 
        name="profile" 
        options={{
          title: 'Profile',
          tabBarIcon: ({ color }) => (
            <Ionicons name="person" size={20} color={color} />
          ),
        }}
      />
      {/* Hide search and watchlists from tab bar - only accessible via modal */}
      <Tabs.Screen 
        name="search" 
        options={{
          href: null, // Hide from tab bar - only accessible via modal
        }}
      />
      <Tabs.Screen 
        name="watchlists" 
        options={{
          href: null, // Hide from tab bar - only accessible via modal
        }}
      />
    </Tabs>
  );
}
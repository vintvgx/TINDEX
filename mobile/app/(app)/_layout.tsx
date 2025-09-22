/**
 * Layout for (app) directory with bottom tab navigation
 */
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

export default function AppLayout() {
  return (
    <Tabs
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
          // position: 'absolute',
          bottom: 20,
          // left: '15%',
          // right: '5%',
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
        name="search" 
        options={{
          title: 'Search',
          tabBarIcon: ({ color }) => (
            <Ionicons name="search" size={20} color={color} />
          ),
        }}
      />
       <Tabs.Screen 
        name="watchlists" 
        options={{
          title: 'Watchlists',
          tabBarIcon: ({ color }) => (
            <Ionicons name="layers" size={20} color={color} />
          ),
        }}
      />
      <Tabs.Screen 
        name="notifications" 
        options={{
          title: 'Notifications',
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
    </Tabs>
  );
}
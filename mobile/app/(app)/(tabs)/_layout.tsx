import { Tabs } from 'expo-router';
import { CustomTabBar } from '@/common/components/ui/CustomTabBar';
import { OptionsTickerProvider } from '@/lib/optionsTickerContext';

export default function Layout() {
  return (
    <OptionsTickerProvider>
    <Tabs
      initialRouteName="feed"
      screenOptions={{ headerShown: false }}
      tabBar={(props) => <CustomTabBar {...props} />}
    >
      <Tabs.Screen name="feed" options={{ title: 'Feed' }} />
      <Tabs.Screen name="track" options={{ href: null }} />
      <Tabs.Screen name="track-legacy" options={{ href: null }} />
      <Tabs.Screen name="options" options={{ title: 'Options' }} />
      <Tabs.Screen name="orb" options={{ title: 'ORB' }} />
      <Tabs.Screen name="notifications" options={{ title: 'Alerts' }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile' }} />
      <Tabs.Screen name="search" options={{ href: null }} />
      <Tabs.Screen name="watchlists" options={{ href: null }} />
      {/* Strategy screens — hidden from tab bar, accessible via More menu */}
      <Tabs.Screen name="strategy" options={{ href: null }} />
      <Tabs.Screen name="position" options={{ href: null }} />
      <Tabs.Screen name="tradelog" options={{ href: null }} />
      <Tabs.Screen name="accounts" options={{ href: null }} />
    </Tabs>
    </OptionsTickerProvider>
  );
}

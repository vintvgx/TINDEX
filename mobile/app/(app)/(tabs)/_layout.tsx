import { Tabs } from 'expo-router';
import { View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaInsetsContext, useSafeAreaInsets } from 'react-native-safe-area-context';
import { CustomTabBar } from '@/common/components/ui/CustomTabBar';
import { TickerTape } from '@/common/components/ui/TickerTape';
import { AppHeader } from '@/common/components/ui/AppHeader';
import { DrawerMenu } from '@/common/components/ui/DrawerMenu';
import { OptionsTickerProvider } from '@/lib/optionsTickerContext';
import { DrawerProvider } from '@/lib/DrawerContext';
import { useThemeColors } from '@/lib/useColorScheme';

/**
 * Global app shell: dark ticker tape → app header (☰ | logo | bell) → the tab
 * navigator → the left drawer overlay. The tape/header own the top safe-area
 * inset, so we override the inset context to `top: 0` / `bottom: 0` for the
 * navigator subtree — per-screen SafeAreaViews sit flush under the header and
 * above the floating tab bar (which owns the home-indicator inset).
 */
function Shell() {
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <TickerTape />
      <AppHeader />

      <View style={{ flex: 1 }}>
        <SafeAreaInsetsContext.Provider
          value={{ top: 0, bottom: 0, left: insets.left, right: insets.right }}
        >
          <Tabs
            initialRouteName="feed"
            screenOptions={{
              headerShown: false,
              tabBarStyle: {
                position: 'absolute',
                backgroundColor: 'transparent',
                borderTopWidth: 0,
                elevation: 0,
                borderBottomWidth: 10,
                paddingBottom: 20
              },
            }}
            tabBar={(props) => <CustomTabBar {...props} />}
          >
            <Tabs.Screen name="feed" options={{ title: 'Home' }} />
            <Tabs.Screen name="track" options={{ href: null }} />
            <Tabs.Screen name="track-legacy" options={{ href: null }} />
            <Tabs.Screen name="strategy" options={{ title: 'Strategies' }} />
            <Tabs.Screen name="orb" options={{ title: 'ORB' }} />
            <Tabs.Screen name="swing" options={{ href: null }} />
            <Tabs.Screen name="options" options={{ title: 'Contracts' }} />
            <Tabs.Screen name="profile" options={{ title: 'Profile' }} />
            <Tabs.Screen name="notifications" options={{ href: null }} />
            <Tabs.Screen name="search" options={{ href: null }} />
            <Tabs.Screen name="watchlists" options={{ href: null }} />
            {/* Strategy sub-screens — hidden from tab bar, opened from the Strategies tab */}
            <Tabs.Screen name="position" options={{ href: null }} />
            <Tabs.Screen name="tradelog" options={{ href: null }} />
            <Tabs.Screen name="accounts" options={{ href: null }} />
            <Tabs.Screen name="zero_dte_watchlist" options={{ href: null }} />
          </Tabs>
        </SafeAreaInsetsContext.Provider>
      </View>

      <DrawerMenu />
      <StatusBar style="light" />
    </View>
  );
}

export default function Layout() {
  return (
    <OptionsTickerProvider>
      <DrawerProvider>
        <Shell />
      </DrawerProvider>
    </OptionsTickerProvider>
  );
}

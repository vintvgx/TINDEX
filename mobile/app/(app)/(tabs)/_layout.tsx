import { Tabs } from 'expo-router';
import { View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaInsetsContext, useSafeAreaInsets } from 'react-native-safe-area-context';
import { CustomTabBar } from '@/common/components/ui/CustomTabBar';
import { TickerTape } from '@/common/components/ui/TickerTape';
import { AppHeader } from '@/common/components/ui/AppHeader';
import { OptionsTickerProvider } from '@/lib/optionsTickerContext';
import { useThemeColors } from '@/lib/useColorScheme';

/**
 * Global app shell: dark ticker tape → app header (logo | bell) → the tab
 * navigator. The tape/header own the top safe-area inset, so we override the
 * inset context to `top: 0` / `bottom: 0` for the navigator subtree —
 * per-screen SafeAreaViews sit flush under the header and above the docked
 * tab bar (CustomTabBar applies the home-indicator inset itself, in its own
 * bottom padding — it's a normal flex sibling now, not a floating overlay,
 * so screens no longer need to guess its height to avoid being hidden
 * under it).
 *
 * Bottom tabs: Home / ORB / Charts / Accounts / Profile. Home, ORB, and
 * Accounts each page between several sub-screens via SegmentedPager (see
 * feed.tsx, orb.tsx, accounts.tsx) — those sub-screens (position, options,
 * strategy, tradelog, daily_review, etc.) stay registered here with
 * href:null so they're still real routes `router.push` can target directly,
 * but aren't their own tabs. Charts is its own standalone tab (charts.tsx),
 * not a pager. Profile replaces the old Menu list screen (menu.tsx,
 * removed) — its navigable rows (Watchlists/Track Portfolio/Notifications/
 * Run Simulation) and Sign Out moved into profile.tsx, above its Developer
 * section.
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
              // No tabBarStyle here — a custom `tabBar` render prop (below)
              // takes full control of rendering, so React Navigation never
              // applies this to it. CustomTabBar owns its own styling now.
            }}
            tabBar={(props) => <CustomTabBar {...props} />}
          >
            <Tabs.Screen name="feed" options={{ title: 'Home' }} />
            <Tabs.Screen name="orb" options={{ title: 'ORB' }} />
            <Tabs.Screen name="charts" options={{ title: 'Charts' }} />
            <Tabs.Screen name="accounts" options={{ title: 'Accounts' }} />
            <Tabs.Screen name="profile" options={{ title: 'Profile' }} />

            {/* Sub-pages of the pagers above — not tabs themselves, still
                real routes (router.push target for deep-linking a section). */}
            <Tabs.Screen name="dashboard" options={{ href: null }} />
            <Tabs.Screen name="monitor" options={{ href: null }} />
            <Tabs.Screen name="strategy" options={{ href: null }} />
            <Tabs.Screen name="tradelog" options={{ href: null }} />
            <Tabs.Screen name="daily_review" options={{ href: null }} />
            <Tabs.Screen name="position" options={{ href: null }} />
            <Tabs.Screen name="options" options={{ href: null }} />
            <Tabs.Screen name="accounts_overview" options={{ href: null }} />

            {/* Profile-only destinations */}
            <Tabs.Screen name="track" options={{ href: null }} />
            <Tabs.Screen name="track-legacy" options={{ href: null }} />
            <Tabs.Screen name="notifications" options={{ href: null }} />
            <Tabs.Screen name="search" options={{ href: null }} />
            <Tabs.Screen name="watchlists" options={{ href: null }} />
            <Tabs.Screen name="signals" options={{ href: null }} />
            <Tabs.Screen name="simulation" options={{ href: null }} />
            <Tabs.Screen name="simulator" options={{ href: null }} />
          </Tabs>
        </SafeAreaInsetsContext.Provider>
      </View>

      <StatusBar style="light" />
    </View>
  );
}

export default function Layout() {
  return (
    <OptionsTickerProvider>
      <Shell />
    </OptionsTickerProvider>
  );
}

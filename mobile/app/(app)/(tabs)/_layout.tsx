import { useState } from 'react';
import { Tabs } from 'expo-router';
import { View, TouchableOpacity, StyleSheet } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaInsetsContext, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { WheelTabBar } from '@/common/components/ui/WheelTabBar';
import {
  ChartOverlayProvider,
  useChartOverlay,
} from '@/common/components/ui/ChartOverlayContext';
import { ChartsContent } from './charts';
import { TickerTape } from '@/common/components/ui/TickerTape';
import { AppHeader } from '@/common/components/ui/AppHeader';
import { ChartTapeProvider } from '@/common/components/ui/ChartTapeContext';
import { OptionsTickerProvider } from '@/lib/optionsTickerContext';
import { useThemeColors } from '@/lib/useColorScheme';

/**
 * 0.7 redesign app shell: ticker tape → app header → tab navigator →
 * 3-button wheel tab bar (Home wheel / Chart / Profile).
 *
 * The Home button scrubs through Home → Monitor → Daily → Log → Account →
 * Menu (single tap spins back to Home). The Chart button opens the chart as
 * a full-screen overlay covering tape, header, and tab bar — only an X
 * (where the Profile button was) remains to close it. All routes stay
 * registered so deep links and notifications keep working.
 */
function Shell() {
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();

  return (
    <ChartOverlayProvider>
      <ChartTapeProvider>
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <ShellContent insets={insets} />
        <StatusBar style="light" />
      </View>
      </ChartTapeProvider>
    </ChartOverlayProvider>
  );
}

function ShellContent({ insets }: { insets: ReturnType<typeof useSafeAreaInsets> }) {
  const colors = useThemeColors();
  const { open: chartOpen, ticker: chartTicker, closeChart } = useChartOverlay();
  // The chart overlay starts BELOW the ticker tape: charts.tsx has no tape of
  // its own — it publishes its ticker/price/signal to this global tape via
  // ChartTapeContext — so covering the tape hid that headline (and its
  // tap-ticker-to-search / tap-signal-for-contracts shortcuts).
  const [tapeH, setTapeH] = useState(0);

  return (
    <View style={{ flex: 1 }}>
      <View onLayout={(e) => setTapeH(e.nativeEvent.layout.height)}>
        <TickerTape />
      </View>
      <AppHeader />

      <View style={{ flex: 1 }}>
        <SafeAreaInsetsContext.Provider
          value={{ top: 0, bottom: 0, left: insets.left, right: insets.right }}
        >
          <Tabs
            initialRouteName="feed"
            // Theme background behind every screen — the default scene
            // color showed through as black around/below shorter content.
            screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: colors.background } }}
            tabBar={chartOpen ? () => null : (props) => <WheelTabBar {...props} />}
          >
            {/* Wheel screens */}
            <Tabs.Screen name="feed" options={{ title: 'Home' }} />
            <Tabs.Screen name="monitor" options={{ title: 'Monitor' }} />
            <Tabs.Screen name="daily_review" options={{ title: 'Daily' }} />
            <Tabs.Screen name="tradelog" options={{ title: 'Log' }} />
            <Tabs.Screen name="accounts" options={{ title: 'Account' }} />
            <Tabs.Screen name="menu" options={{ title: 'Menu' }} />
            <Tabs.Screen name="profile" options={{ title: 'Profile' }} />

            {/* Reachable via Menu / deep links — not in the wheel */}
            <Tabs.Screen name="orb" options={{ href: null }} />
            <Tabs.Screen name="charts" options={{ href: null }} />
            <Tabs.Screen name="dashboard" options={{ href: null }} />
            <Tabs.Screen name="brief" options={{ href: null }} />
            <Tabs.Screen name="strategy" options={{ href: null }} />
            <Tabs.Screen name="position" options={{ href: null }} />
            <Tabs.Screen name="options" options={{ href: null }} />
            <Tabs.Screen name="accounts_overview" options={{ href: null }} />
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

      {/* Chart overlay — covers the header and tab bar, but not the ticker
          tape (which carries the chart's headline). Only the X remains. */}
      {chartOpen && (
        <View style={[StyleSheet.absoluteFillObject, { top: tapeH, backgroundColor: colors.background, zIndex: 50 }]}>
          <ChartsContent initialTicker={chartTicker} topInset={0} />
          <TouchableOpacity
            onPress={closeChart}
            activeOpacity={0.7}
            accessibilityLabel="Close chart"
            style={[
              styles.closeBtn,
              {
                top: 8,
                backgroundColor: colors.surfaceSecondary,
                borderColor: colors.border,
              },
            ]}
          >
            <Ionicons name="close" size={20} color={colors.text} />
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  closeBtn: {
    position: 'absolute',
    right: 14,
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default function Layout() {
  return (
    <OptionsTickerProvider>
      <Shell />
    </OptionsTickerProvider>
  );
}

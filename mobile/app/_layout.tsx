// import { useShowToast } from "@/components/ui/toast/useToast";

import { AuthProvider, useAuth } from "@/common/utils/context/auth/AuthContext";
// import "./global.css"

// import { ToastService } from "@/services/ToastService";
// import { ToastProvider } from "@gluestack-ui/toast";
import {
  DarkTheme,
  DefaultTheme,
  ThemeProvider,
} from "@react-navigation/native";
import { ThemeProvider as AppThemeProvider } from "@/lib/ThemeContext";
import { useAppColorScheme } from "@/lib/useColorScheme";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { useFonts } from "expo-font";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { View, Text } from "react-native";
import * as Notifications from "expo-notifications";
import { router } from 'expo-router';

import "react-native-reanimated";
import "@/global.css";

// Initialize log service early to capture all console logs
import "@/common/services/LogService";

import LoadingScreen from "@/common/components/LoadingScreen";
import { ToastProvider } from "@/common/components/ui/Toast";
import { FONT_ASSETS } from "@/lib/typography";

import { applyGlobalFont } from "@/lib/applyGlobalFont";

// Install Space Grotesk as the app-wide default for every <Text>/<TextInput>.                                                                                                                                  
applyGlobalFont();

// import { GluestackUIProvider } from "../components/ui/gluestack-ui-provider";
// import LoadingScreen from "./components/LoadingScreen";
import { Slot } from "expo-router";
import { useNotifications } from "@/hooks/notifications/useNotifications";
import { useRef } from "react";
import { isValidWatchlistType } from "@/common/types/watchlist";
import { ORBBreakoutNotificationData } from "@/common/components/FEED/modals/ORBNotificationModal";

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();


Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: false,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 300000, // 5 minutes
    },
  },
});

export default function RootLayout() {
  //TODO IMPLEMENT showToast + grab functionality from VENT proj
  // const showToast = useShowToast();
  // useEffect(() => {
  //   // Register the toast callback when component mounts
  //   ToastService.register(showToast);

  //   // Clean up when component unmounts
  //   return () => {
  //     ToastService.unregister();
  //   };
  // }, [showToast]);

  const [fontsLoaded] = useFonts({
    SpaceMono: require("../assets/fonts/SpaceMono-Regular.ttf"),
    ...FONT_ASSETS,
  });

  useEffect(() => {
    if (fontsLoaded) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded]);

  if (!fontsLoaded) {
    return null; // Keep the splash screen visible while fonts load
  }

  // Render the AuthProvider, once font is loaded
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <AppThemeProvider>
          <AuthProvider>
            <AppContent />
          </AuthProvider>
        </AppThemeProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

// Separate component for content after authentication is initialized
function AppContent() {
  const { authState } = useAuth();
  const { colorScheme } = useAppColorScheme();
  const { expoPushToken, isRegistering } = useNotifications();

  // Add ref for notification subscription
  const notificationResponseListener = useRef<Notifications.EventSubscription | null>(null);

  // Initialize notification response handler
  useEffect(() => {
    // Set up the listener
    notificationResponseListener.current =
      Notifications.addNotificationResponseReceivedListener(response => {
        const data = response.notification.request.content.data;
        const title = response.notification.request.content.title;
        const body = response.notification.request.content.body;

        // Handle ORB breakout notifications
        if (data.type === 'orb_breakout' || data.type === 'orb_breakout_confirmed' || data.type === 'orb_breakout_invalidated') {
          // Navigate to feed screen with notification data
          router.push({
            pathname: '/(app)/(tabs)/feed',
            params: {
              notificationData: JSON.stringify({
                type: data.type,
                ticker: data.ticker,
                breakout_type: data.breakout_type,
                price: data.price,
                screen: data.screen || 'ticker',
                timestamp: data.timestamp || new Date().toISOString(),
                breakout_analysis: data.breakout_analysis,
                orb_high: data.orb_high,
                orb_low: data.orb_low,
                confidence: data.confidence,
                score: data.score,
                reasons: data.reasons,
                entry_price: data.entry_price,
                stop_loss: data.stop_loss,
                risk_per_share: data.risk_per_share,
                rvol: data.rvol,
                vwap_aligned: data.vwap_aligned,
                gap_percent: data.gap_percent,
                gap_points: data.gap_points,
                gap_direction: data.gap_direction,
                prior_day_trend: data.prior_day_trend,
                trend_continuation: data.trend_continuation,
                breakout_aligns_gap: data.breakout_aligns_gap,
              } as ORBBreakoutNotificationData),
              notificationTitle: title,
              notificationBody: body,
            },
          });
          return;
        }

        // Handle contract price alert notifications
        if (data.type === 'contract_price_alert') {
          router.push('/(app)/(tabs)/options');
          return;
        }

        // Handle different screen types
        if (data.screen === 'watchlists' && isValidWatchlistType(data.watchlistType)) {
          router.push({
            pathname: '/(app)/(tabs)/watchlists',
            params: {
              selectedWatchlist: data.watchlistType,
            },
          });
        }
      });

    // Cleanup function
    return () => {
      if (notificationResponseListener.current) {
        notificationResponseListener.current.remove()
      }
    };
  }, []); // Empty deps - only run once

  // Log token for debugging
  useEffect(() => {
    console.log("Expo Push Token Registering: ", isRegistering)
    if (expoPushToken) {
      console.log('App has expo push token:', expoPushToken);
    }
  }, [expoPushToken, isRegistering]);

  if (authState.isLoading) {
    return <LoadingScreen message="Initializing Alethia..." />;
  }

  return (
    <ToastProvider>
      <ThemeProvider value={colorScheme === "dark" ? DarkTheme : DefaultTheme}>
        <Slot />
        <StatusBar style={colorScheme === "dark" ? "light" : "dark"} />
      </ThemeProvider>
    </ToastProvider>
  );
}

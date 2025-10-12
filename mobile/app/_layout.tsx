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
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useFonts } from "expo-font";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { useColorScheme, View, Text } from "react-native";
import * as Notifications from "expo-notifications";
import { router } from 'expo-router';

import "react-native-reanimated";
import "@/global.css";

import LoadingScreen from "@/common/components/LoadingScreen";

// import { GluestackUIProvider } from "../components/ui/gluestack-ui-provider";
// import LoadingScreen from "./components/LoadingScreen";
import { Slot } from "expo-router";
import { useNotifications } from "@/hooks/notifications/useNotifications";
import { useRef } from "react";
import { isValidWatchlistType } from "@/common/types/watchlist";

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
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </QueryClientProvider>
  );
}

// Separate component for content after authentication is initialized
function AppContent() {
  const { authState } = useAuth();
  const colorScheme = useColorScheme();
  const { expoPushToken, isRegistering } = useNotifications();

  // Add ref for notification subscription
  const notificationResponseListener = useRef<Notifications.EventSubscription | null>(null);

  // Initialize notification response handler
  useEffect(() => {
    // Set up the listener
    notificationResponseListener.current = 
      Notifications.addNotificationResponseReceivedListener(response => {
        const data = response.notification.request.content.data;
        
        // Handle different screen types
        if (data.screen === 'watchlists' && isValidWatchlistType(data.watchlistType)) {
          router.push({
            pathname: '/(app)/(tabs)/watchlists',
            params: {
              selectedWatchlist: data.watchlistType, // ✅ Now type-safe
            },
          });
        }
        // Add more handlers as needed
        // else if (data.screen === 'ticker') { ... }
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
    return (
      <View>
        <Text>Loading...</Text>
      </View>
    );
    // return <LoadingScreen message="Initializing Alethia..." />;
  }

  return (
    // <GluestackUIProvider mode={colorScheme === "dark" ? 'light' : 'light'}>
    <ThemeProvider value={colorScheme === "dark" ? DarkTheme : DefaultTheme}>
      {/* <ToastProvider> */}
      <Slot />
      <StatusBar style={colorScheme === "dark" ? "light" : "dark"} />
      {/* </ToastProvider> */}
    </ThemeProvider>
    // </GluestackUIProvider>
  );
}

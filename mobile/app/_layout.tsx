// import { useShowToast } from "@/components/ui/toast/useToast";
import { AuthProvider, useAuth } from "@/context/auth/AuthContext";
// import "./global.css"

// import { ToastService } from "@/services/ToastService";
// import { ToastProvider } from "@gluestack-ui/toast";
import {
  DarkTheme,
  DefaultTheme,
  ThemeProvider,
} from "@react-navigation/native";
import {
  QueryClient,
  QueryClientProvider
} from '@tanstack/react-query';
import { useFonts } from "expo-font";
import { Slot } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { useColorScheme } from "react-native";
import "react-native-reanimated";
import "@/global.css";

// import { GluestackUIProvider } from "../components/ui/gluestack-ui-provider";
// import LoadingScreen from "./components/LoadingScreen";


// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 300000, // 5 minutes
      },
    },
  });


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

  if (authState.isLoading) {
    // TODO implement LoadingScreen
    // return <LoadingScreen />;
  }

  return (
    // <GluestackUIProvider mode={colorScheme === "dark" ? 'light' : 'light'}>
      <ThemeProvider
        value={colorScheme === "dark" ? DarkTheme : DefaultTheme}>
        {/* <ToastProvider> */}
          <Stack />
          <StatusBar style={colorScheme === "dark" ? "light" : "dark"} />
        {/* </ToastProvider> */}
      </ThemeProvider>
    // </GluestackUIProvider>
  );
}

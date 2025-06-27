// import { ThemedText } from "@/components/ThemedText";
// import { ThemedView } from "@/components/ThemedView";
// import { Button, ButtonText } from "@/components/ui/button";
// import { useShowToast } from "@/components/ui/toast/useToast";
import { signInWithApple, signInWithGoogle } from "@/utils/auth/function";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@react-navigation/native";
import { Stack } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  Animated,
  Dimensions,
  Platform,
  View,
  useColorScheme,
  Text,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

const { height } = Dimensions.get("window");

export default function AuthScreen() {
  // const showToast = useShowToast();
  const theme = useTheme();
  const colorScheme = useColorScheme();

  useEffect(() => {
    console.log("Color scheme:", colorScheme);
  });

  //TODO Check if authGuard is needed
  // This will redirect away if user is already authenticated
  // useAuthGuard(false, false);

  const [isAuthVisible, setIsAuthVisible] = useState(false);
  const slideAnim = useRef(new Animated.Value(height)).current;
  const contentAnim = useRef(new Animated.Value(0)).current;

  const showAuthPanel = () => {
    setIsAuthVisible(true);
    // Animate auth panel up
    Animated.timing(slideAnim, {
      toValue: 0,
      duration: 300,
      useNativeDriver: true,
    }).start();

    // Animate content up to make room for auth panel
    Animated.timing(contentAnim, {
      toValue: -height * 0.25, // Move up by approximately half the auth panel height
      duration: 300,
      useNativeDriver: true,
    }).start();
  };

  const hideAuthPanel = () => {
    // Animate auth panel down
    Animated.timing(slideAnim, {
      toValue: height,
      duration: 300,
      useNativeDriver: true,
    }).start(() => {
      setIsAuthVisible(false);
    });

    // Animate content back to original position
    Animated.timing(contentAnim, {
      toValue: 0,
      duration: 300,
      useNativeDriver: true,
    }).start();
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "white" }}>
      <View>
        <Text>This is a text</Text>
      </View>
    </SafeAreaView>
  );
};

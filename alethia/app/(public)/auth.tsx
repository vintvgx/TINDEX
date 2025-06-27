// import { ThemedText } from "@/components/ThemedText";
// import { ThemedView } from "@/components/ThemedView";
// import { Button, ButtonText } from "@/components/ui/button";
// import { useShowToast } from "@/components/ui/toast/useToast";
// import { signInWithApple, signInWithGoogle } from "@/utils/auth/function";
// import { Ionicons } from "@expo/vector-icons";
// import { useTheme } from "@react-navigation/native";
// import { Stack } from "expo-router";
// import React, { useEffect, useRef, useState } from "react";
// import {
//   Animated,
//   Dimensions,
//   Platform,
//   View,
//   useColorScheme,
//   Text,
// } from "react-native";
// import { SafeAreaView } from "react-native-safe-area-context";

// const { height } = Dimensions.get("window");

// export default function AuthScreen() {
//   // const showToast = useShowToast();
//   const theme = useTheme();
//   const colorScheme = useColorScheme();

//   useEffect(() => {
//     console.log("Color scheme:", colorScheme);
//   });

//   //TODO Check if authGuard is needed
//   // This will redirect away if user is already authenticated
//   // useAuthGuard(false, false);

//   const [isAuthVisible, setIsAuthVisible] = useState(false);
//   const slideAnim = useRef(new Animated.Value(height)).current;
//   const contentAnim = useRef(new Animated.Value(0)).current;

//   const showAuthPanel = () => {
//     setIsAuthVisible(true);
//     // Animate auth panel up
//     Animated.timing(slideAnim, {
//       toValue: 0,
//       duration: 300,
//       useNativeDriver: true,
//     }).start();

//     // Animate content up to make room for auth panel
//     Animated.timing(contentAnim, {
//       toValue: -height * 0.25, // Move up by approximately half the auth panel height
//       duration: 300,
//       useNativeDriver: true,
//     }).start();
//   };

//   const hideAuthPanel = () => {
//     // Animate auth panel down
//     Animated.timing(slideAnim, {
//       toValue: height,
//       duration: 300,
//       useNativeDriver: true,
//     }).start(() => {
//       setIsAuthVisible(false);
//     });

//     // Animate content back to original position
//     Animated.timing(contentAnim, {
//       toValue: 0,
//       duration: 300,
//       useNativeDriver: true,
//     }).start();
//   };

//   return (
//     <SafeAreaView style={{ flex: 1, backgroundColor: "white" }}>
//       <View>
//         <Text>This is a text</Text>
//       </View>
//     </SafeAreaView>
//   );
// };

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
  TouchableOpacity,
  StatusBar,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from 'expo-linear-gradient';

const { height, width } = Dimensions.get("window");

export default function AuthScreen() {
  const theme = useTheme();
  const colorScheme = useColorScheme();

  useEffect(() => {
    console.log("Color scheme:", colorScheme);
  });

  const [isAuthVisible, setIsAuthVisible] = useState(false);
  const [isLoading, setIsLoading] = useState({ apple: false, google: false });
  const slideAnim = useRef(new Animated.Value(height)).current;
  const contentAnim = useRef(new Animated.Value(0)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Fade in animation on mount
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 1000,
      useNativeDriver: true,
    }).start();
  }, []);

  const showAuthPanel = () => {
    setIsAuthVisible(true);
    Animated.parallel([
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }),
      Animated.timing(contentAnim, {
        toValue: -height * 0.15,
        duration: 300,
        useNativeDriver: true,
      }),
    ]).start();
  };

  const hideAuthPanel = () => {
    Animated.parallel([
      Animated.timing(slideAnim, {
        toValue: height,
        duration: 300,
        useNativeDriver: true,
      }),
      Animated.timing(contentAnim, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }),
    ]).start(() => {
      setIsAuthVisible(false);
    });
  };

  const handleAppleSignIn = async () => {
    setIsLoading(prev => ({ ...prev, apple: true }));
    try {
      await signInWithApple();
    } catch (error) {
      console.error('Apple sign in error:', error);
    } finally {
      setIsLoading(prev => ({ ...prev, apple: false }));
    }
  };

  const handleGoogleSignIn = async () => {
    setIsLoading(prev => ({ ...prev, google: true }));
    try {
      await signInWithGoogle();
    } catch (error) {
      console.error('Google sign in error:', error);
    } finally {
      setIsLoading(prev => ({ ...prev, google: false }));
    }
  };

  return (
    <>
      <StatusBar barStyle="light-content" />
      <LinearGradient
        colors={['#0f172a', '#1e3a8a', '#334155']}
        className="flex-1"
      >
        <SafeAreaView className="flex-1">
          <Animated.View 
            className="flex-1 justify-center items-center px-8"
            style={{
              transform: [{ translateY: contentAnim }],
              opacity: fadeAnim,
            }}
          >
            {/* App Name */}
            <View className="mb-20">
              <Text 
                className="text-6xl text-white text-center tracking-tight"
                style={{
                  fontWeight: '200',
                  ...(Platform.OS === 'ios' ? {
                    fontFamily: 'System',
                  } : {
                    fontFamily: 'sans-serif-thin',
                  }),
                }}
              >
                Alethia
              </Text>
            </View>

            {/* Get Started Button */}
            <TouchableOpacity
              className="bg-white/10 px-12 py-4 rounded-full border border-white/20"
              onPress={showAuthPanel}
              activeOpacity={0.8}
            >
              <Text className="text-white text-lg font-medium text-center">
                Get Started
              </Text>
            </TouchableOpacity>
          </Animated.View>

          {/* Auth Panel */}
          {isAuthVisible && (
            <Animated.View
              className="absolute bottom-0 left-0 right-0 bg-white rounded-t-3xl pt-5 pb-10 px-6 shadow-2xl"
              style={{
                transform: [{ translateY: slideAnim }],
                minHeight: height * 0.4,
                shadowColor: '#000',
                shadowOffset: {
                  width: 0,
                  height: -4,
                },
                shadowOpacity: 0.1,
                shadowRadius: 12,
                elevation: 8,
              }}
            >
              <View className="flex-row items-center mb-8 relative">
                <TouchableOpacity
                  onPress={hideAuthPanel}
                  className="absolute right-0 p-1"
                >
                  <Ionicons name="close" size={24} color="#666" />
                </TouchableOpacity>
                <Text className="text-xl font-semibold text-gray-800 flex-1 text-center">
                  Sign in to continue
                </Text>
              </View>

              <View className="gap-4 mb-6">
                {/* Apple Sign In */}
                {Platform.OS === 'ios' && (
                  <TouchableOpacity
                    className="flex-row items-center justify-center py-4 px-6 bg-black rounded-xl gap-3"
                    onPress={handleAppleSignIn}
                    disabled={isLoading.apple}
                    activeOpacity={0.8}
                  >
                    {isLoading.apple ? (
                      <View className="flex-row items-center justify-center">
                        <Text className="text-white text-base font-medium">
                          Signing in...
                        </Text>
                      </View>
                    ) : (
                      <>
                        <Ionicons name="logo-apple" size={20} color="white" />
                        <Text className="text-white text-base font-medium">
                          Continue with Apple
                        </Text>
                      </>
                    )}
                  </TouchableOpacity>
                )}

                {/* Google Sign In */}
                <TouchableOpacity
                  className="flex-row items-center justify-center py-4 px-6 bg-white border border-gray-200 rounded-xl gap-3"
                  onPress={handleGoogleSignIn}
                  disabled={isLoading.google}
                  activeOpacity={0.8}
                >
                  {isLoading.google ? (
                    <View className="flex-row items-center justify-center">
                      <Text className="text-gray-700 text-base font-medium">
                        Signing in...
                      </Text>
                    </View>
                  ) : (
                    <>
                      <Ionicons name="logo-google" size={20} color="#4285F4" />
                      <Text className="text-gray-700 text-base font-medium">
                        Continue with Google
                      </Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>

              <Text className="text-xs text-gray-400 text-center leading-4 px-4">
                By continuing, you agree to our Terms of Service and Privacy Policy
              </Text>
            </Animated.View>
          )}
        </SafeAreaView>
      </LinearGradient>
    </>
  );
}
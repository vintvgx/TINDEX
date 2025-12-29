import { signInWithApple, signInWithGoogle } from "@/common/utils/auth/function"
import { Ionicons } from "@expo/vector-icons"
import { useTheme } from "@react-navigation/native"
import { LinearGradient } from "expo-linear-gradient"
import { useEffect } from "react"
import { Dimensions, StatusBar, StyleSheet, Text, TouchableOpacity, View, useColorScheme } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"

const { height, width } = Dimensions.get("window")

export default function AuthScreen() {
  const theme = useTheme()
  const colorScheme = useColorScheme()

  useEffect(() => {
    console.log("Color scheme:", colorScheme)
  }, [])

  const handleAppleSignIn = async () => {
    try {
      await signInWithApple()
    } catch (error) {
      console.error("Apple sign in error:", error)
    }
  }

  const handleGoogleSignIn = async () => {
    try {
      await signInWithGoogle()
    } catch (error) {
      console.error("Google sign in error:", error)
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" />
      <LinearGradient
        colors={["#1e3a8a", "#1e40af", "#3b82f6"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.gradient}
      >
        <View style={styles.content}>
          {/* App Title */}
          <View style={styles.titleContainer}>
            <Text style={styles.title}>TINDEX</Text>
          </View>

          {/* Authentication Buttons */}
          <View style={styles.buttonsContainer}>
            {/* Apple Sign In Button */}
            <TouchableOpacity
              onPress={handleAppleSignIn}
              style={styles.appleButton}
              activeOpacity={0.8}
            >
              <Ionicons name="logo-apple" size={20} color="white" />
              <Text style={styles.appleButtonText}>Continue with Apple</Text>
            </TouchableOpacity>

            {/* Google Sign In Button */}
            <TouchableOpacity
              onPress={handleGoogleSignIn}
              style={styles.googleButton}
              activeOpacity={0.8}
            >
              <Ionicons name="logo-google" size={20} color="#4285F4" />
              <Text style={styles.googleButtonText}>Continue with Google</Text>
            </TouchableOpacity>
          </View>

          {/* Terms and Privacy */}
          <View style={styles.termsContainer}>
            <Text style={styles.termsText}>
              By continuing, you agree to our <Text style={styles.termsLink}>Terms of Service</Text> and{" "}
              <Text style={styles.termsLink}>Privacy Policy</Text>
            </Text>
          </View>
        </View>
      </LinearGradient>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  gradient: {
    flex: 1,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  titleContainer: {
    marginBottom: 80,
  },
  title: {
    color: 'white',
    fontSize: 60,
    fontWeight: '300',
    letterSpacing: 2,
    textAlign: 'center',
  },
  buttonsContainer: {
    width: '100%',
    gap: 16,
  },
  appleButton: {
    width: '100%',
    backgroundColor: 'black',
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  appleButtonText: {
    color: 'white',
    fontSize: 18,
    fontWeight: '500',
    marginLeft: 12,
  },
  googleButton: {
    width: '100%',
    backgroundColor: 'white',
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  googleButtonText: {
    color: '#374151',
    fontSize: 18,
    fontWeight: '500',
    marginLeft: 12,
  },
  termsContainer: {
    position: 'absolute',
    bottom: 48,
    paddingHorizontal: 32,
  },
  termsText: {
    color: '#d1d5db',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  termsLink: {
    color: '#e5e7eb',
  },
});

//TODO update to use Tailwind
// "use client"

// import { signInWithApple, signInWithGoogle } from "@/utils/auth/function"
// import { Ionicons } from "@expo/vector-icons"
// import { useTheme } from "@react-navigation/native"
// import { useEffect } from "react"
// import { Dimensions, View, useColorScheme, Text, TouchableOpacity, StatusBar } from "react-native"
// import { SafeAreaView } from "react-native-safe-area-context"
// import { LinearGradient } from "expo-linear-gradient"

// const { height, width } = Dimensions.get("window")

// export default function AuthScreen() {
//   const theme = useTheme()
//   const colorScheme = useColorScheme()

//   useEffect(() => {
//     console.log("Color scheme:", colorScheme)
//   }, [])

//   const handleAppleSignIn = async () => {
//     try {
//       await signInWithApple()
//     } catch (error) {
//       console.error("Apple sign in error:", error)
//     }
//   }

//   const handleGoogleSignIn = async () => {
//     try {
//       await signInWithGoogle()
//     } catch (error) {
//       console.error("Google sign in error:", error)
//     }
//   }

//   return (
//     <SafeAreaView className="flex-1">
//       <StatusBar barStyle="light-content" />
//       <LinearGradient
//         colors={["#1e3a8a", "#1e40af", "#3b82f6"]}
//         start={{ x: 0, y: 0 }}
//         end={{ x: 1, y: 1 }}
//         className="flex-1"
//       >
//         <View className="flex-1 justify-center items-center px-8">
//           {/* App Title */}
//           <View className="mb-20">
//             <Text className="text-white text-6xl font-light tracking-wide text-center">Alethia</Text>
//           </View>

//           {/* Authentication Buttons */}
//           <View className="w-full space-y-4">
//             {/* Apple Sign In Button */}
//             <TouchableOpacity
//               onPress={handleAppleSignIn}
//               className="w-full bg-black rounded-xl py-4 px-6 flex-row items-center justify-center"
//               activeOpacity={0.8}
//             >
//               <Ionicons name="logo-apple" size={20} color="white" />
//               <Text className="text-white text-lg font-medium ml-3">Continue with Apple</Text>
//             </TouchableOpacity>

//             {/* Google Sign In Button */}
//             <TouchableOpacity
//               onPress={handleGoogleSignIn}
//               className="w-full bg-white rounded-xl py-4 px-6 flex-row items-center justify-center"
//               activeOpacity={0.8}
//             >
//               <Ionicons name="logo-google" size={20} color="#4285F4" />
//               <Text className="text-gray-800 text-lg font-medium ml-3">Continue with Google</Text>
//             </TouchableOpacity>
//           </View>

//           {/* Terms and Privacy */}
//           <View className="absolute bottom-12 px-8">
//             <Text className="text-gray-300 text-sm text-center leading-5">
//               By continuing, you agree to our <Text className="text-gray-200">Terms of Service</Text> and{" "}
//               <Text className="text-gray-200">Privacy Policy</Text>
//             </Text>
//           </View>
//         </View>
//       </LinearGradient>
//     </SafeAreaView>
//   )
// }
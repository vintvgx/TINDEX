import { signOut } from "@/common/utils/auth/function"
import type React from "react"
import { View, Text, Pressable, Alert } from "react-native"

interface HeaderProps {
  onAddPress: () => void
  onPreviewPress?: () => void
}

export const Header: React.FC<HeaderProps> = ({ onAddPress, onPreviewPress }) => {
  const handleSignOut = async () => {
    try {
      Alert.alert(
        "Sign Out",
        "Are you sure you want to sign out?",
        [
          {
            text: "Cancel",
            style: "cancel",
          },
          {
            text: "Sign Out",
            style: "destructive",
            onPress: async () => {
              try {
                await signOut()
              } catch (error) {
                console.error("Sign out failed:", error)
                Alert.alert(
                  "Sign Out Failed",
                  "There was an error signing out. Please try again.",
                  [{ text: "OK" }]
                )
              }
            },
          },
        ],
        { cancelable: true }
      )
    } catch (error) {
      console.error("Error showing sign out confirmation:", error)
    }
  }

  return (
    <View className="flex-row justify-between items-center px-6 py-6 bg-black/95 backdrop-blur-xl">
      {/* App Title */}
      <View>
      <Pressable
          onPress={handleSignOut}
          accessibilityRole="button"
          accessible={true}
          accessibilityLabel="Sign out of the application"
          accessibilityHint="Double tap to sign out of your account">
        <Text className="text-3xl font-black text-white tracking-tight">TINDEX</Text>
        <Text className="text-xs text-gray-400 font-medium tracking-wider uppercase mt-1">Market Intelligence</Text>
        </Pressable>
      </View>

      {/* Action Buttons */}
      <View className="flex-row items-center space-x-3">
        {onPreviewPress && (
          <Pressable
            onPress={onPreviewPress}
            className="w-12 h-12 bg-gradient-to-br from-green-500 to-green-600 rounded-2xl flex items-center justify-center shadow-lg shadow-green-500/30 border border-green-400/20"
            android_ripple={{ color: "rgba(255,255,255,0.2)", borderless: true }}
          >
            <Text className="text-lg font-bold text-white">🔔</Text>
          </Pressable>
        )}

        <Pressable
          onPress={onAddPress}
          className="w-12 h-12 bg-gradient-to-br from-blue-500 to-blue-600 rounded-2xl flex items-center justify-center shadow-lg shadow-blue-500/30 border border-blue-400/20"
          android_ripple={{ color: "rgba(255,255,255,0.2)", borderless: true }}
        >
          <Text className="text-xl font-bold text-white">+</Text>
        </Pressable>
      </View>
    </View>
  )
}

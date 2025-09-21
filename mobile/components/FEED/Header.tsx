import { signOut } from "@/utils/auth/function"
import type React from "react"
import { View, Text, Pressable } from "react-native"

interface HeaderProps {
  onAddPress: () => void
}

export const Header: React.FC<HeaderProps> = ({ onAddPress }) => {
  return (
    <View className="flex-row justify-between items-center px-6 py-4 bg-black">
      {/* App Title */}
      <Text className="text-3xl font-bold text-white">TINDEX</Text>

      {/* Action Buttons */}
      <View className="flex-row items-center space-x-4">
        <Pressable
          onPress={async () => {
            signOut()
          }}
          className="px-4 py-2 bg-gray-800 rounded-xl border border-gray-700 mr-4"
        >
          <Text className="text-white font-medium text-sm">Sign Out</Text>
        </Pressable>

        <Pressable
          onPress={onAddPress}
          className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-600/25"
          android_ripple={{ color: "rgba(255,255,255,0.1)", borderless: true }}
        >
          <Text className="text-xl font-semibold text-white">+</Text>
        </Pressable>
      </View>
    </View>
  )
}

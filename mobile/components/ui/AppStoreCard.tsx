import type React from "react"
import { View, type ViewStyle } from "react-native"

interface AppStoreCardProps {
  children: React.ReactNode
  style?: ViewStyle
  variant?: "default" | "featured" | "compact"
}

export const AppStoreCard: React.FC<AppStoreCardProps> = ({ children, style, variant = "default" }) => {
  const getCardStyles = () => {
    const baseStyles = "bg-gray-900 rounded-2xl overflow-hidden"

    switch (variant) {
      case "featured":
        return `${baseStyles} shadow-2xl shadow-black/50`
      case "compact":
        return `${baseStyles} shadow-lg shadow-black/30`
      default:
        return `${baseStyles} shadow-xl shadow-black/40`
    }
  }

  return (
    <View className={getCardStyles()} style={style}>
      {children}
    </View>
  )
}

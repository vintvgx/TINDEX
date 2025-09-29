import type React from "react"
import { View, type ViewStyle } from "react-native"

interface AppStoreCardProps {
  children: React.ReactNode
  style?: ViewStyle
  variant?: "default" | "featured" | "compact"
}

export const AppStoreCard: React.FC<AppStoreCardProps> = ({ children, style, variant = "default" }) => {
  const getCardStyles = () => {
    const baseStyles = "bg-gray-900/95 rounded-3xl overflow-hidden border border-gray-800/50"

    switch (variant) {
      case "featured":
        return `${baseStyles} shadow-2xl shadow-black/60`
      case "compact":
        return `${baseStyles} shadow-lg shadow-black/40`
      default:
        return `${baseStyles} shadow-xl shadow-black/50`
    }
  }

  return (
    <View className={getCardStyles()} style={style}>
      {children}
    </View>
  )
}

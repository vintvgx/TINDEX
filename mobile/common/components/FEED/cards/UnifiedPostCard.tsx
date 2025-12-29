/**
 * Unified Feed Post Card Component
 * Displays both ticker updates and blog posts in a consistent Twitter/X-like UI
 */

import type React from "react"
import { useState } from "react"
import { View, Text, Pressable, Image } from "react-native"
import { Ionicons } from "@expo/vector-icons"
import type { UnifiedFeedItem } from "@/common/types"
import { useBaseNavigation } from "@/hooks/navigation/useBaseNavigation"

interface UnifiedPostCardProps {
  item: UnifiedFeedItem
  onPress?: () => void
  onUpvote?: (id: string) => void
  isLast?: boolean
}

// Helper to format relative time (9d, 2w, 4m, etc.)
const formatRelativeTime = (dateString: string): string => {
  const date = new Date(dateString)
  const now = new Date()
  const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000)

  if (diffInSeconds < 60) return "now"
  if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}m`
  if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}h`
  if (diffInSeconds < 604800) return `${Math.floor(diffInSeconds / 86400)}d`
  if (diffInSeconds < 2592000) return `${Math.floor(diffInSeconds / 604800)}w`
  if (diffInSeconds < 31536000) return `${Math.floor(diffInSeconds / 2592000)}mo`
  return `${Math.floor(diffInSeconds / 31536000)}y`
}

// Helper to truncate content
const truncateContent = (content: string | null | undefined, maxLength = 500): string => {
  if (!content || typeof content !== 'string') return ""
  if (content.length <= maxLength) return content
  return content.substring(0, maxLength).trim() + "..."
}

// Helper to get ticker display info
const getTickerInfo = (item: UnifiedFeedItem) => {
  const ticker = item.ticker
  // Note: research_data is not available in UnifiedFeedItem
  // It can be fetched on demand if needed for logo/company_name
  return {
    symbol: ticker || "TICKER",
    name: ticker || (item.item_type === "update" ? "Ticker Update" : "Blog Post"),
    logo: undefined, // Can be fetched on demand if needed
  }
}

export const UnifiedPostCard: React.FC<UnifiedPostCardProps> = ({ 
  item, 
  onPress, 
  onUpvote, 
  isLast = false 
}) => {
  const [isUpvoted, setIsUpvoted] = useState(false)
  const [upvoteCount, setUpvoteCount] = useState(0)
  const { toTicker } = useBaseNavigation()

  const tickerInfo = getTickerInfo(item)
  const createdAt = item.published_at || item.created_at
  const relativeTime = formatRelativeTime(createdAt)

  // Visual indicator colors and icons based on item_type
  const isUpdate = item.item_type === "update"
  const accentColor = isUpdate ? "#3B82F6" : "#8B5CF6" // Blue for updates, Purple for blogs
  const indicatorIcon = isUpdate ? "flash" : "document-text"

  // Get content and title based on type
  // For updates: content field contains the actual content
  // For blogs: content field contains the title, full_content contains the content
  const title = isUpdate ? undefined : (item.content || "")
  const content = isUpdate ? (item.content || "") : (item.full_content || "")
  const tags = item.tags || []

  // Ensure content is always a string
  const safeContent = content || ""

  // For updates, show full content (max 500 chars)
  // For blog posts, truncate to 500 chars and show "read more" indicator
  const displayContent = isUpdate ? safeContent : truncateContent(safeContent, 500)
  const hasMoreContent = !isUpdate && safeContent.length > 500

  const handleUpvote = () => {
    const newUpvoted = !isUpvoted
    setIsUpvoted(newUpvoted)
    setUpvoteCount((prev) => (newUpvoted ? prev + 1 : Math.max(0, prev - 1)))
    if (onUpvote) {
      onUpvote(item.id)
    }
  }

  const handlePress = () => {
    if (onPress) {
      onPress()
    }
  }

  const handleTickerPress = () => {
    if (item.ticker) {
      toTicker(item.ticker)
    }
  }

  return (
    <Pressable onPress={handlePress} className="bg-black">
      <View className="px-4 py-4">
        {/* Row 1: Ticker Logo, Name, and Date */}
        <View className="flex-row items-center mb-3">
          {/* Ticker Logo - Pressable to navigate to ticker */}
          <Pressable onPress={handleTickerPress}>
            <View className="w-10 h-10 rounded-full bg-gray-800 items-center justify-center mr-3 overflow-hidden">
              {tickerInfo.logo ? (
                <Image 
                  source={{ uri: tickerInfo.logo }} 
                  className="w-10 h-10" 
                  resizeMode="cover" 
                />
              ) : (
                <Text className="text-white font-bold text-sm">
                  {tickerInfo.symbol.substring(0, 2).toUpperCase()}
                </Text>
              )}
            </View>
          </Pressable>

          {/* Ticker Name and Date */}
          <View className="flex-1 flex-row items-center">
            <Pressable onPress={handleTickerPress}>
              <Text className="text-white font-semibold text-base">{tickerInfo.name}</Text>
            </Pressable>
            <Text className="text-gray-500 text-sm ml-2">{relativeTime}</Text>
          </View>

          {/* More Options */}
          <Pressable className="p-1">
            <Ionicons name="ellipsis-horizontal" size={18} color="#6B7280" />
          </Pressable>
        </View>

        {/* Row 2: Title (for blog posts) */}
        {title && (
          <Text className="text-white font-bold text-lg mb-2 leading-tight">
            {title}
          </Text>
        )}

        {/* Row 3: Tags (max 3) */}
        {tags.length > 0 && (
          <View className="flex-row flex-wrap mb-2">
            {tags.slice(0, 3).map((tag, index) => (
              <View 
                key={index} 
                className="bg-gray-800/80 px-3 py-1.5 rounded-full mr-2 mb-1 border border-gray-700/50"
              >
                <Text className="text-gray-300 text-xs font-medium">{tag}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Row 4: Content */}
        <View className="mb-3">
          {displayContent ? (
            <Text className="text-gray-200 text-base leading-relaxed">
              {displayContent}
            </Text>
          ) : null}
          {hasMoreContent && (
            <Text className="text-blue-400 text-sm mt-1">Read more</Text>
          )}
        </View>

          {/* Row 5: Actions (Upvote) and Reading Time */}
        <View className="flex-row items-center justify-between">
          {/* Upvote Button */}
          <Pressable onPress={handleUpvote} className="flex-row items-center">
            <Ionicons
              name={isUpvoted ? "chevron-up" : "chevron-up-outline"}
              size={22}
              color={isUpvoted ? "#84cc16" : "#6B7280"}
            />
            <Text 
              className={`ml-1 text-sm font-medium ${
                isUpvoted ? "text-lime-500" : "text-gray-500"
              }`}
            >
              {upvoteCount}
            </Text>
          </Pressable>

          {/* Right side: Type Indicator and Reading Time */}
          <View className="flex-row items-center">
            {/* Visual type indicator badge */}
            <View 
              style={{ backgroundColor: `${accentColor}20` }}
              className="px-2 py-1 rounded-full flex-row items-center mr-3"
            >
              <Ionicons 
                name={indicatorIcon as any} 
                size={14} 
                color={accentColor} 
              />
            </View>

            {/* Reading Time (for blog posts) - can be calculated on demand if needed */}
            {!isUpdate && item.full_content && (
              <View className="flex-row items-center">
                <Ionicons name="time-outline" size={14} color="#6B7280" />
                <Text className="text-gray-500 text-xs ml-1">
                  {Math.ceil((item.full_content.length || 0) / 200)} min read
                </Text>
              </View>
            )}
          </View>
        </View>
      </View>

      {/* Separator Line */}
      {!isLast && <View className="h-px bg-gray-800/60 mx-4" />}
    </Pressable>
  )
}


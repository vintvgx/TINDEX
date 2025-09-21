"use client"

import type React from "react"
import { useState } from "react"
import { View, Text, Image, Pressable } from "react-native"
import type { BlogPostType } from "@/types"
import { AppStoreCard } from "@/components/ui/AppStoreCard"

interface BlogPostCardProps {
  post: BlogPostType
  onPress?: (post: BlogPostType) => void
}

export const BlogPostCard: React.FC<BlogPostCardProps> = ({ post, onPress }) => {
  const [imageError, setImageError] = useState(false)

  // Extract image URL from multimedia_data or use a placeholder
  const getImageUrl = () => {
    if (imageError) {
      return "https://images.unsplash.com/photo-1499750310107-5fef28a66643?w=400&h=250&fit=crop"
    }
    if (post.multimedia_data?.images?.[0]?.url) {
      return post.multimedia_data.images[0].url
    }
    if (post.multimedia_data?.featured_image) {
      return post.multimedia_data.featured_image
    }
    // Fallback to a placeholder image
    return "https://images.unsplash.com/photo-1499750310107-5fef28a66643?w=400&h=250&fit=crop"
  }

  // Format date
  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    return date.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    })
  }

  // Truncate content for preview
  const truncateContent = (content: string, maxLength = 200) => {
    if (!content) return ""

    if (content.length <= maxLength) return content
    return content.substring(0, maxLength).trim() + "..."
  }

  const handlePress = () => {
    onPress?.(post)
  }

  return (
    <View className="mx-4 mb-6">
      <Pressable onPress={handlePress} android_ripple={{ color: "rgba(255,255,255,0.1)", borderless: false }}>
        <AppStoreCard variant="featured">
          {/* Hero Image */}
          <View className="relative">
            <Image
              source={{ uri: getImageUrl() }}
              className="w-full h-64"
              style={{ resizeMode: "cover" }}
              onError={() => setImageError(true)}
            />
            {/* Gradient overlay for better text readability */}
            <View className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
          </View>

          {/* Content */}
          <View className="p-6">
            {/* Title */}
            <Text className="text-white text-xl font-bold mb-3 leading-7">{post.title}</Text>

            {/* Content Preview */}
            {post.content && (
              <Text className="text-gray-300 text-sm leading-6 mb-4" numberOfLines={3}>
                {truncateContent(post.content)}
              </Text>
            )}

            {/* Footer with date and reading time */}
            <View className="flex-row justify-between items-center pt-4 border-t border-gray-700">
              <Text className="text-gray-400 text-xs font-medium">{formatDate(post.created_at)}</Text>
              {post.reading_time && (
                <View className="flex-row items-center">
                  <View className="w-1 h-1 bg-gray-600 rounded-full mr-2" />
                  <Text className="text-gray-400 text-xs font-medium">{post.reading_time} min read</Text>
                </View>
              )}
            </View>
          </View>
        </AppStoreCard>
      </Pressable>
    </View>
  )
}

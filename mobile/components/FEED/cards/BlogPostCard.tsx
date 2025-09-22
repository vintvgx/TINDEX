"use client"

import type React from "react"
import { useState } from "react"
import { View, Text, Image, Pressable } from "react-native"
import type { BlogPostType } from "@/types"
import { AppStoreCard } from "@/components/ui/AppStoreCard"
import { Icon } from "@/components/ui/icon"
import { Clock, Calendar } from "lucide-react-native"

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
    <View className="mx-5 mb-8">
      <Pressable 
        onPress={handlePress} 
        android_ripple={{ color: "rgba(255,255,255,0.1)", borderless: false }}
        className="active:scale-[0.98] transition-transform duration-150"
      >
        <AppStoreCard variant="featured">
          {/* Hero Image */}
          <View className="relative">
            <Image
              source={{ uri: getImageUrl() }}
              className="w-full h-72"
              style={{ resizeMode: "cover" }}
              onError={() => setImageError(true)}
            />
            {/* Enhanced gradient overlay */}
            <View className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
            {/* Subtle top border for depth */}
            <View className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
          </View>

          {/* Content */}
          <View className="p-7">
            {/* Title */}
            <Text className="text-white text-2xl font-black mb-4 leading-8 tracking-tight">{post.title}</Text>

            {/* Content Preview */}
            {post.content && (
              <Text className="text-gray-300 text-base leading-7 mb-6 font-medium" numberOfLines={3}>
                {truncateContent(post.content)}
              </Text>
            )}

            {/* Enhanced Footer */}
            <View className="flex-row justify-between items-center pt-5 border-t border-gray-700/50">
              <View className="flex-row items-center">
             
                <Text className="text-gray-400 text-sm font-semibold tracking-wide">{formatDate(post.created_at)}</Text>
              </View>
              
              {post.reading_time && (
                <View className="flex-row items-center">
                  <Text className="text-gray-400 text-sm font-semibold tracking-wide">{post.reading_time} min read</Text>
                </View>
              )}
            </View>
          </View>
        </AppStoreCard>
      </Pressable>
    </View>
  )
}

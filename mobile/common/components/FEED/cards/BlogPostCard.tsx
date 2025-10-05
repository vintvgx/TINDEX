"use client";

import { AppStoreCard } from "@/common/components/ui/AppStoreCard";
import type { BlogPostType } from "@/common/types";
import useBaseNavigation from "@/hooks/navigation/useBaseNavigation";
import type React from "react";
import { useState } from "react";
import { Image, Pressable, Text, View } from "react-native";

interface BlogPostCardProps {
  post: BlogPostType;
  onPress?: (post: BlogPostType) => void;
}

export const BlogPostCard: React.FC<BlogPostCardProps> = ({
  post,
  onPress,
}) => {
  const [imageError, setImageError] = useState(false);
  const [logoError, setLogoError] = useState(false);

  const ticker = post.research_data?.ticker;

  const { toTicker } = useBaseNavigation();

  // Handle company name press to navigate to ticker view
  const handleCompanyPress = () => {
    // const ticker = extractTicker()
    if (ticker) {
      toTicker(ticker);
    }
  };

  // Get logo URL from research data or generate from ticker
  const getLogoUrl = (): string | null => {
    if (post.research_data?.logo_url) {
      return post.research_data.logo_url;
    }

    if (ticker) {
      // Use Clearbit logo service as fallback
      return `https://logo.clearbit.com/${ticker.toLowerCase()}.com`;
    }

    return null;
  };

  // Extract image URL from multimedia_data or use a placeholder
  const getImageUrl = () => {
    if (imageError) {
      return "https://images.unsplash.com/photo-1499750310107-5fef28a66643?w=400&h=250&fit=crop";
    }
    if (post.multimedia_data?.images?.[0]?.url) {
      return post.multimedia_data.images[0].url;
    }
    if (post.multimedia_data?.featured_image) {
      return post.multimedia_data.featured_image;
    }
    // Fallback to a placeholder image
    return "https://images.unsplash.com/photo-1499750310107-5fef28a66643?w=400&h=250&fit=crop";
  };

  // Format date
  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  // Truncate content for preview
  const truncateContent = (content: string, maxLength = 200) => {
    if (!content) return "";

    if (content.length <= maxLength) return content;
    return content.substring(0, maxLength).trim() + "...";
  };

  const handlePress = () => {
    onPress?.(post);
  };

  const logoUrl = getLogoUrl();

  return (
    <View className="mx-5 mb-8">
      <AppStoreCard variant="featured">
        {/* Company Header */}
        {ticker && (
          <View className="p-6 pb-4 border-b border-gray-700/30">
            <Pressable
              onPress={handleCompanyPress}
              className="flex-row items-center"
              android_ripple={{
                color: "rgba(255,255,255,0.05)",
                borderless: false,
              }}>
              {logoUrl && !logoError && (
                <View className="w-10 h-10 rounded-xl bg-gray-800/60 mr-4 border border-gray-700/40 overflow-hidden">
                  <Image
                    source={{ uri: logoUrl }}
                    className="w-full h-full"
                    resizeMode="contain"
                    onError={() => setLogoError(true)}
                  />
                </View>
              )}
              <View className="flex-1">
                <Text className="text-white text-lg font-bold tracking-tight mb-1">
                  {post.research_data?.company_name}
                </Text>
                <Text className="text-blue-400 text-sm font-semibold tracking-wide">
                  {ticker}
                </Text>
              </View>
              <View className="w-8 h-8 rounded-full bg-blue-500/20 flex items-center justify-center border border-blue-400/30">
                <Text className="text-blue-400 text-xs font-bold">→</Text>
              </View>
            </Pressable>
          </View>
        )}

        {/* Main Content */}
        <Pressable
          onPress={handlePress}
          android_ripple={{ color: "rgba(255,255,255,0.1)", borderless: false }}
          className="active:scale-[0.98] transition-transform duration-150">
          {/* Content */}
          <View className="p-7">
            {/* Title */}
            <Text className="text-white text-2xl font-black mb-4 leading-8 tracking-tight">
              {post.title}
            </Text>

            {/* Content Preview */}
            {post.content && (
              <Text
                className="text-gray-300 text-base leading-7 mb-6 font-medium"
                numberOfLines={3}>
                {truncateContent(post.content)}
              </Text>
            )}

            {/* Enhanced Footer */}
            <View className="flex-row justify-between items-center pt-5 border-t border-gray-700/50">
              <View className="flex-row items-center">
                <Text className="text-gray-400 text-sm font-semibold tracking-wide">
                  {formatDate(post.created_at)}
                </Text>
              </View>

              {post.reading_time && (
                <View className="flex-row items-center">
                  <Text className="text-gray-400 text-sm font-semibold tracking-wide">
                    {post.reading_time} min read
                  </Text>
                </View>
              )}
            </View>
          </View>
        </Pressable>
      </AppStoreCard>
    </View>
  );
};

import React, { useState } from "react";
import { View, Text, Image, Pressable } from "react-native";
import { Card, CardContent } from "./ui/card";
import { BlogPostType } from "@/types";

interface BlogPostCardProps {
  post: BlogPostType;
  onPress?: (post: BlogPostType) => void;
}

export const BlogPostCard: React.FC<BlogPostCardProps> = ({
  post,
  onPress,
}) => {
  const [imageError, setImageError] = useState(false);

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
  const truncateContent = (content: string, maxLength: number = 200) => {
    if (!content) return "";

    if (content.length <= maxLength) return content;
    return content.substring(0, maxLength).trim() + "...";
  };

  const handlePress = () => {
    onPress?.(post);
  };

  return (
    <Pressable
      onPress={handlePress}
      className="mb-6"
      android_ripple={{ color: "rgba(0,0,0,0.1)", borderless: false }}>
      <Card className="overflow-hidden bg-white border-0 shadow-2xl rounded-2xl mx-4 shadow-black drop-shadow-xl elevation-xl ">
        <View className="relative p-4 mb-4">
          <Image
            source={{ uri: getImageUrl() }}
            className="w-full h-80 rounded-lg"
            style={{ resizeMode: "cover" }}
            onError={() => setImageError(true)}
          />
          {/* Gradient overlay for better text readability */}
          <View className="absolute inset-0 bg-gradient-to-t from-black/30 via-transparent to-transparent" />
          {/* Subtle border overlay */}
          <View className="absolute inset-0 border border-gray-100/50" />
        </View>

        {/* Content */}
        <CardContent className="space-y-3">
          {/* Title */}
          <Text className="text-xl font-bold text-gray-900 mb-2 leading-6">
            {post.title}
          </Text>

          {/* Content Preview */}
          {post.content && (
            <Text
              className="text-sm text-gray-600 leading-5 mb-3"
              numberOfLines={4}>
              {truncateContent(post.content)}
            </Text>
          )}

          {/* Footer with date and reading time */}
          <View className="flex-row justify-between items-center pt-2 border-t border-gray-100">
            <Text className="text-xs text-gray-500 font-medium">
              {formatDate(post.created_at)}
            </Text>
            {post.reading_time && (
              <Text className="text-xs text-gray-500 font-medium">
                {post.reading_time} min read
              </Text>
            )}
          </View>
        </CardContent>
      </Card>
    </Pressable>
  );
};

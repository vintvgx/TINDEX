import React, { useState } from "react";
import {
  Modal,
  View,
  Text,
  ScrollView,
  Pressable,
  Image,
  StatusBar,
  Alert,
  ActivityIndicator,
} from "react-native";
import { BlogPostType } from "@/common/types";
import { Ionicons } from "@expo/vector-icons";
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { User } from "@supabase/supabase-js";
import { useDeleteBlogPostMutation } from "@/hooks/mutations/blogs/deleteBlogPostMutation";
import { DeleteBlogPostRequest } from "@/common/types/blogPosts/delete";
import { StockResearchModal } from "@/common/components/StockResearchModal";
import { useBlogPostQuery, BlogPostFromDB } from "@/hooks/queries/blogs/useBlogPostQuery";

interface PostDetailModalProps {
  user: User | null;
  post: BlogPostType | null;
  visible: boolean;
  onClose: () => void;
}

export const PostDetailModal: React.FC<PostDetailModalProps> = ({
  user,
  post,
  visible,
  onClose,
}) => {
  const [showResearchModal, setShowResearchModal] = useState(false);

  const { mutateAsync: deleteBlogPost } = useDeleteBlogPostMutation()

  // Fetch full blog post if only ID is provided
  const blogPostId = post?.id || null;
  const { data: fullBlogPost, isLoading: isLoadingBlogPost, error: blogPostError } = useBlogPostQuery(blogPostId);
  
  // Use fetched post if available, otherwise use the passed post
  // Type assertion: fullBlogPost matches the actual DB schema, post might be partial
  const displayPost = (fullBlogPost || post) as BlogPostFromDB | BlogPostType | null;

  if (!displayPost) {
    // Show loading state if we're fetching
    if (isLoadingBlogPost && visible) {
      return (
        <Modal
          visible={visible}
          animationType="slide"
          presentationStyle="pageSheet"
          onRequestClose={onClose}>
          <StatusBar barStyle="light-content" backgroundColor="#000000" />
          <View className="flex-1 bg-black justify-center items-center">
            <ActivityIndicator size="large" color="#3B82F6" />
            <Text className="text-gray-300 mt-4 font-medium">Loading blog post...</Text>
          </View>
        </Modal>
      );
    }
    return null;
  }

      // Show error state if fetch failed
      if (blogPostError && !post) {
        const errorMessage = blogPostError instanceof Error 
          ? blogPostError.message 
          : 'Unknown error';
        return (
          <Modal
            visible={visible}
            animationType="slide"
            presentationStyle="pageSheet"
            onRequestClose={onClose}>
            <StatusBar barStyle="light-content" backgroundColor="#000000" />
            <View className="flex-1 bg-black justify-center items-center px-6">
              <Ionicons name="alert-circle-outline" size={48} color="#EF4444" />
              <Text className="text-white text-xl font-bold mt-4 text-center">
                Failed to load blog post
              </Text>
              <Text className="text-gray-400 mt-2 text-center">
                {errorMessage}
              </Text>
              <Pressable
                onPress={onClose}
                className="mt-6 bg-blue-600 px-6 py-3 rounded-xl active:opacity-80">
                <Text className="text-white font-semibold">Close</Text>
              </Pressable>
            </View>
          </Modal>
        );
      }

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  const getImageUrl = () => {
    if (!displayPost) return "https://images.unsplash.com/photo-1499750310107-5fef28a66643?w=800&h=400&fit=crop";
    
    const post = displayPost as any;
    
    // Check if research_data has any image URLs
    if (post.research_data?.images?.[0]?.url) {
      return post.research_data.images[0].url;
    }
    if (post.research_data?.featured_image) {
      return post.research_data.featured_image;
    }
    // Check multimedia_data (for backward compatibility)
    if (post.multimedia_data?.images?.[0]?.url) {
      return post.multimedia_data.images[0].url;
    }
    if (post.multimedia_data?.featured_image) {
      return post.multimedia_data.featured_image;
    }
    // Fallback to a default stock market image
    return "https://images.unsplash.com/photo-1499750310107-5fef28a66643?w=800&h=400&fit=crop";
  };

  const handleDeleteBlogPost = async () => {
    try {
      const request: DeleteBlogPostRequest = {
        id: displayPost.id,
        user: user
      }
      const result = await deleteBlogPost(request)

      if (result.success) {
        Alert.alert(
          "Success",
          `Blog post deleted successfully!`
        );

        onClose()
      }
    } catch (error: any) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      Alert.alert(
        "Error",
        `Failed to delete blog post: ${errorMessage}`
      );
    }
  }
 
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet" // iOS only - gives native modal feel
      onRequestClose={onClose}>
      <StatusBar barStyle="light-content" backgroundColor="#000000" />

      {/* Header with close button */}
      <View className="absolute top-0 left-0 right-0 z-10 bg-black/80 backdrop-blur-xl pt-12 pb-4 px-4">
        <View className="flex-row justify-between items-center">
          <View />
          <Pressable
            onPress={onClose}
            className="bg-gray-800/80 rounded-full p-2 active:opacity-70">
            <Ionicons name="close" size={24} color="#FFFFFF" />
          </Pressable>
        </View>
      </View>

      <ScrollView
        className="flex-1 bg-black"
        showsVerticalScrollIndicator={false}
        bounces={false}>
        {/* Hero Image */}
        <View className="relative">
          <Image
            source={{ uri: getImageUrl() }}
            className="w-full h-80"
            style={{ resizeMode: "cover" }}
          />
          <View className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/20 to-transparent" />
        </View>

        {/* Content Container */}
        <View className="px-6 py-6 -mt-8 bg-black rounded-t-3xl relative z-10">
          {/* Ticker and Category */}
          <View className="flex-row flex-wrap items-center gap-2 mb-4">
            {(displayPost as any)?.ticker && (
              <View className="bg-blue-500/20 px-3 py-1.5 rounded-full border border-blue-500/30">
                <Text className="text-sm text-blue-400 font-semibold">
                  {(displayPost as any).ticker}
                </Text>
              </View>
            )}
            {(displayPost as any)?.category && (
              <View className="bg-gray-800/80 px-3 py-1.5 rounded-full border border-gray-700/50">
                <Text className="text-sm text-gray-300 font-semibold">
                  {(displayPost as any).category}
                </Text>
              </View>
            )}
            {/* Fallback: show topic if it exists (for backward compatibility) */}
            {(displayPost as any)?.topic?.name && !(displayPost as any)?.ticker && (
              <View className="bg-blue-500/20 px-3 py-1.5 rounded-full border border-blue-500/30">
                <Text className="text-sm text-blue-400 font-semibold">
                  {(displayPost as any).topic.name}
                </Text>
              </View>
            )}
          </View>

          {/* Title */}
          <Text className="text-3xl font-black text-white mb-4 leading-tight tracking-tight">
            {displayPost.title}
          </Text>

          {/* Row for displaying Ticker and Delete button */}
          <View className="flex-row justify-between items-center pt-2 border-t border-gray-800 mb-4">
            {/* Stock Ticker */}
            {displayPost.research_data?.ticker && (
              <Pressable
                onPress={() => setShowResearchModal(true)}
                className="active:opacity-70">
                <View className="bg-blue-500/20 px-4 py-2 rounded-full border border-blue-500/30">
                  <Text className="text-blue-400 font-bold text-lg">
                    {displayPost.research_data.ticker}
                  </Text>
                </View>
              </Pressable>
            )}
            {/* Delete button (only display if user is a superuser) */}
            {user?.role && (
              <Pressable
                onPress={handleDeleteBlogPost}
                className="bg-red-500/20 p-2 rounded-full border border-red-500/30 active:opacity-70"
              >
                <MaterialIcons name="delete" size={20} color="#EF4444" />
              </Pressable>
            )}
          </View>

          {/* Meta Information */}
          <View className="flex-row justify-between items-center mb-6 pb-6 border-b border-gray-800">
            <View className="flex-row items-center">
              <Ionicons name="time-outline" size={16} color="#6B7280" />
              <Text className="text-gray-400 text-sm font-medium ml-2">
                {formatDate(displayPost.created_at)}
              </Text>
            </View>
            {displayPost.reading_time && (
              <View className="flex-row items-center">
                <Ionicons name="book-outline" size={16} color="#6B7280" />
                <Text className="text-gray-400 text-sm font-medium ml-2">
                  {displayPost.reading_time} min read
                </Text>
              </View>
            )}
          </View>

          {/* Full Content */}
          <View className="mb-8">
            <Text className="text-base text-gray-200 leading-7 font-normal">
              {displayPost.content}
            </Text>
          </View>

          {/* Tags if available */}
          {(displayPost as any)?.tags && Array.isArray((displayPost as any).tags) && (displayPost as any).tags.length > 0 && (
            <View className="flex-row flex-wrap gap-2 mb-8">
              {(displayPost as any).tags.slice(0, 5).map((tag: string, index: number) => (
                <View 
                  key={index}
                  className="bg-gray-800/80 px-3 py-1.5 rounded-full border border-gray-700/50"
                >
                  <Text className="text-gray-300 text-xs font-medium">#{tag}</Text>
                </View>
              ))}
            </View>
          )}

          {/* Bottom spacing for safe scrolling */}
          <View className="h-20" />
        </View>
      </ScrollView>

      {/* Stock Research Modal */}
      <StockResearchModal
        visible={showResearchModal}
        onClose={() => setShowResearchModal(false)}
        researchData={displayPost.research_data}
        ticker={displayPost.research_data?.ticker || ""}
      />
    </Modal>
  );
};

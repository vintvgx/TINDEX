import React, { useState } from "react";
import {
  Modal,
  View,
  Text,
  ScrollView,
  Pressable,
  Image,
  StatusBar,
  Dimensions,
  Alert
} from "react-native";
import { BlogPostType } from "@/types";
import { Ionicons } from "@expo/vector-icons";
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { StockResearchModal } from "./StockResearchModal";
import { User } from "@supabase/supabase-js";
import { useDeleteBlogPostMutation } from "@/hooks/mutations/blogs/deleteBlogPostMutation";
import { DeleteBlogPostRequest } from "@/types/blogPosts/delete";

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

  const { mutateAsync: deleteBlogPost, isPending: deletionPending, isError: deleteBlogPostError } = useDeleteBlogPostMutation()

  if (!post) return null;

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  const getImageUrl = () => {
    if (post.multimedia_data?.images?.[0]?.url) {
      return post.multimedia_data.images[0].url;
    }
    if (post.multimedia_data?.featured_image) {
      return post.multimedia_data.featured_image;
    }
    return "https://images.unsplash.com/photo-1499750310107-5fef28a66643?w=800&h=400&fit=crop";
  };

  const handleDeleteBlogPost = async () => {
    try {
      const request: DeleteBlogPostRequest = {
        id: post.id,
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
      Alert.alert(
        "Error",
        `Failed to  delete blog post!`
      );
    }
  }
 
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet" // iOS only - gives native modal feel
      onRequestClose={onClose}>
      <StatusBar barStyle="light-content" backgroundColor="rgba(0,0,0,0.8)" />

      {/* Header with close button */}
      <View className="absolute top-0 left-0 right-0 z-10 bg-transparent pt-12 pb-4 px-4">
        <View className="flex-row justify-between items-center">
          <View />
          <Pressable
            onPress={onClose}
            className="bg-black/50 rounded-full p-2 backdrop-blur-sm">
            <Ionicons name="close" size={24} color="white" />
          </Pressable>
        </View>
      </View>

      <ScrollView
        className="flex-1 bg-white"
        showsVerticalScrollIndicator={false}
        bounces={false}>
        {/* Hero Image */}
        <View className="relative">
          <Image
            source={{ uri: getImageUrl() }}
            className="w-full h-80"
            style={{ resizeMode: "cover" }}
          />
          <View className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-black/20" />
        </View>

        {/* Content Container */}
        <View className="px-6 py-6 -mt-8 bg-white rounded-t-3xl relative z-10">
          {/* Topics/Tags */}
          {post.topic && (
            <View className="flex-row flex-wrap mb-4">
              <View className="bg-blue-100 px-3 py-1.5 rounded-full">
                <Text className="text-sm text-blue-700 font-semibold">
                  {post.topic.name}
                </Text>
              </View>
            </View>
          )}

          {/* Title */}
          <Text className="text-3xl font-bold text-gray-900 mb-4 leading-tight">
            {post.title}
          </Text>

          {/* Row for displaying Ticker and Delete button */}
          <View className="flex-row justify-between items-center pt-2 border-t border-gray-100">
            {/* Stock Ticker */}
            {post.research_data?.ticker && (
              <Pressable
                onPress={() => setShowResearchModal(true)}
                className="mb-4">
                <View className="bg-blue-100 px-4 py-2 rounded-full self-start">
                  <Text className="text-blue-700 font-bold text-lg">
                    {post.research_data.ticker}
                  </Text>
                </View>
              </Pressable>
            )}
            {/* Delete button (only display if user is a superuser) */}
            {user?.role && (
              <Pressable
                onPress={handleDeleteBlogPost}
                className="mb-4"
              >
                <MaterialIcons name="delete" size={24} color="black" />
              </Pressable>
            )}
          </View>

          {/* Meta Information */}
          <View className="flex-row justify-between items-center mb-6 pb-6 border-b border-gray-200">
            <Text className="text-base text-gray-600 font-medium">
              {formatDate(post.created_at)}
            </Text>
            {post.reading_time && (
              <Text className="text-base text-gray-600 font-medium">
                {post.reading_time} min read
              </Text>
            )}
          </View>



          {/* Full Content */}
          <View className="mb-8">
            <Text className="text-lg text-gray-800 leading-7 font-normal">
              {post.content}
            </Text>
          </View>

          {/* Additional content sections can go here */}

          {/* Bottom spacing for safe scrolling */}
          <View className="h-20" />
        </View>
      </ScrollView>

      {/* Stock Research Modal */}
      <StockResearchModal
        visible={showResearchModal}
        onClose={() => setShowResearchModal(false)}
        researchData={post.research_data}
        ticker={post.research_data?.ticker || ""}
      />
    </Modal>
  );
};

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
} from "react-native";
import { BlogPostType } from "@/types";
import { Ionicons } from "@expo/vector-icons"; // or your preferred icon library
import { StockResearchModal } from "./StockResearchModal";

interface PostDetailModalProps {
  post: BlogPostType | null;
  visible: boolean;
  onClose: () => void;
}

export const PostDetailModal: React.FC<PostDetailModalProps> = ({
  post,
  visible,
  onClose,
}) => {
  const [showResearchModal, setShowResearchModal] = useState(false);
  
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

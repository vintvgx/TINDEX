import { Header } from "@/common/components/FEED/Header";
import MainContent from "@/common/components/FEED/MainContent";
import { AddPostModal } from "@/common/components/FEED/modals/AddPostModal";
import { PostDetailModal } from "@/common/components/FEED/modals/PostDetailModal";
import { UnifiedTrendingStocksCard } from "@/common/components/FEED/cards/UnifiedTrendingStocksCard";
import { useAuth } from "@/common/utils/context/auth/AuthContext";
import { useFeedQuery } from "@/hooks/queries/blogs/useFeedQuery";
import { useTrendingStocks } from "@/hooks/queries/trending/useTrendingStocks";
import { useQueryClientReady } from "@/hooks/queries/useQueryClientReady";
import type { BlogPostType } from "@/common/types";
import { SortBy } from "@/common/types/blogPosts/create";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { SafeAreaView, View } from "react-native";
import * as Notifications from "expo-notifications";
import { router } from 'expo-router';


const FeedScreen = () => {
  const queryClient = useQueryClient();
  const isQueryClientReady = useQueryClientReady();

  const [selectedPost, setSelectedPost] = useState<BlogPostType | null>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [addModalVisible, setAddModalVisible] = useState(false);
  const [selectedSortBy, setSelectedSortBy] = useState<SortBy>(SortBy.VOLUME);
  const [scrollY, setScrollY] = useState(0);

  const { data: feed, isLoading: feedLoading } = useFeedQuery();
  const {
    data: trendingStocks,
    isLoading: trendingLoading,
    error: trendingError,
  } = useTrendingStocks(selectedSortBy);

  const {
    authState: { user },
  } = useAuth();

  const handlePostPress = (post: BlogPostType) => {
    console.log("Post pressed:", post.title);
    setSelectedPost(post);
    setModalVisible(true);
  };

  const handleCloseModal = () => {
    setModalVisible(false);
    setTimeout(() => setSelectedPost(null), 300);
  };

  const handleAddPress = () => {
    setAddModalVisible(true);
  };

  const handleAddModalClose = () => {
    setAddModalVisible(false);
  };

  const handleBlogPostSuccess = async () => {
    console.log("Post submitted successfully:");
    await queryClient.invalidateQueries({ queryKey: ["feed"] });
  };

  const handleSortChange = (sortBy: SortBy) => {
    setSelectedSortBy(sortBy);
  };

  const handleScroll = (newScrollY: number) => {
    setScrollY(newScrollY);
  };

  return (
    <SafeAreaView className="flex-1 bg-black">
      {/* Subtle background gradient */}
      <View className="absolute inset-0 bg-gradient-to-b from-gray-900/20 via-transparent to-gray-900/10" />

      {/* Header Component */}
      <Header onAddPress={handleAddPress} />

      {/* Unified Trending Stocks Component */}
      <UnifiedTrendingStocksCard
        stocks={trendingStocks}
        isLoading={trendingLoading}
        error={trendingError}
        selectedSortBy={selectedSortBy}
        onSortChange={handleSortChange}
        isQueryClientReady={isQueryClientReady}
        scrollY={scrollY}
      />

      {/* Main Content */}
      <MainContent
        feed={feed}
        feedLoading={feedLoading}
        handlePostPress={handlePostPress}
        onScroll={handleScroll}
      />

      {/* Modals */}
      <PostDetailModal
        user={user}
        post={selectedPost}
        visible={modalVisible}
        onClose={handleCloseModal}
      />
      <AddPostModal
        visible={addModalVisible}
        onClose={handleAddModalClose}
        onSubmit={handleBlogPostSuccess}
      />
    </SafeAreaView>
  );
};

export default FeedScreen;

import { Header } from "@/components/FEED/Header";
import MainContent from "@/components/FEED/MainContent";
import { AddPostModal } from "@/components/FEED/modals/AddPostModal";
import { PostDetailModal } from "@/components/FEED/modals/PostDetailModal";
import { UnifiedTrendingStocksCard } from "@/components/FEED/cards/UnifiedTrendingStocksCard";
import { useAuth } from "@/context/auth/AuthContext";
import { useFeedQuery } from "@/hooks/queries/blogs/useFeedQuery";
import { useTrendingStocks } from "@/hooks/queries/trending/useTrendingStocks";
import { useQueryClientReady } from "@/hooks/queries/useQueryClientReady";
import type { BlogPostType } from "@/types";
import { SortBy } from "@/types/blogPosts/create";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { SafeAreaView, View } from "react-native";

const HomeScreen = () => {
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

export default HomeScreen;

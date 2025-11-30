import { MinimizedWatchlistComponent } from "@/common/components/FEED/cards/MinimizedWatchlistComponent";
import { Header } from "@/common/components/FEED/Header";
import MainContent from "@/common/components/FEED/MainContent";
import { AddPostModal } from "@/common/components/FEED/modals/AddPostModal";
import { PostDetailModal } from "@/common/components/FEED/modals/PostDetailModal";
import { SetMinimizedWatchlistModal } from "@/common/components/FEED/modals/SetMinimizedWatchlistModal";
import type { BlogPostType } from "@/common/types";
import { useAuth } from "@/common/utils/context/auth/AuthContext";
import { logDebug } from "@/common/utils/strings/function";
import { useFeedQuery } from "@/hooks/queries/blogs/useFeedQuery";
import { useQueryClientReady } from "@/hooks/queries/useQueryClientReady";
import { useWatchlists } from "@/hooks/queries/watchlist/useWatchlist";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { SafeAreaView, View } from "react-native";

const FeedScreen = () => {
  const queryClient = useQueryClient();
  const isQueryClientReady = useQueryClientReady();

  const [selectedPost, setSelectedPost] = useState<BlogPostType | null>(null);
  const [hasErrorOrNoData, setHasErrorOrNoData] = useState(false);

  //Modals
  const [blogPostModalVisible, setBlogPostModalVisible] = useState(false);
  const [addModalVisible, setAddModalVisible] = useState(false);
  const [watchlistModalVisible, setWatchlistModalVisible] = useState(false);

  // Feed data 
  const { data: feed, isLoading: feedLoading } = useFeedQuery();

  // Watchlists
  const { data: watchlistsData, isLoading: watchlistsLoading, error: watchlistError, refetch: refetchWatchlists } = useWatchlists();

  const {
    authState: { user, profile },
  } = useAuth();

  const handlePostPress = (post: BlogPostType) => {
    logDebug("Post pressed:", post.title);
    setSelectedPost(post);
    setBlogPostModalVisible(true);
  };


  const handleCloseModal = () => {
      setBlogPostModalVisible(false);
      setTimeout(() => setSelectedPost(null), 300);
  };

  const handleAddPress = () => {
    setAddModalVisible(true);
  };

  const handleAddModalClose = () => {
    setAddModalVisible(false);
  };

  const handleWatchlistModalClose = () => {
    setWatchlistModalVisible(false)
  }

  const handleSetWatchlistModalPress = () => {
    setWatchlistModalVisible(true)
  }

  const handleWatchlistRefresh = async () => {
    try {
      await refetchWatchlists();
    } catch (error) {
      console.error("Failed to refresh watchlists:", error);
    }
  }

  const handleErrorOrNoDataChange = (hasErrorOrNoData: boolean) => {
    setHasErrorOrNoData(hasErrorOrNoData);
  };

  const handleBlogPostSuccess = async () => {
    console.log("Post submitted successfully");
    await queryClient.invalidateQueries({ queryKey: ["feed"] });
  };

  const handleScroll = (_newScrollY: number) => {
    // Scroll handling can be implemented here if needed
  };

  return (
    <SafeAreaView className="flex-1 bg-black">
      {/* Subtle background gradient */}
      <View className="absolute inset-0 bg-gradient-to-b from-gray-900/20 via-transparent to-gray-900/10" />

      {/* Header Component */}
      <Header onAddPress={handleAddPress} />

      {/* Unified Trending Stocks Component */}
      <MinimizedWatchlistComponent
        watchlists={watchlistsData}
        isLoading={watchlistsLoading}
        error={watchlistError}
        isQueryClientReady={isQueryClientReady}
        openSetWatchlistModal={handleSetWatchlistModalPress}
        profile={profile}
        onErrorOrNoDataChange={handleErrorOrNoDataChange}
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
        visible={blogPostModalVisible}
        onClose={handleCloseModal}
      />
      <AddPostModal
        visible={addModalVisible}
        onClose={handleAddModalClose}
        onSubmit={handleBlogPostSuccess}
      />
      <SetMinimizedWatchlistModal
        visible={watchlistModalVisible}
        onClose={handleWatchlistModalClose}
        hasErrorOrNoData={hasErrorOrNoData}
        onRefresh={handleWatchlistRefresh}
      />
    </SafeAreaView>
  );
};

export default FeedScreen;

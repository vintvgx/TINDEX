"use client"

import { useFeedQuery } from "@/hooks/queries/blogs/useFeedQuery"
import { useTrendingStocks } from "@/hooks/queries/trending/useTrendingStocks"
import { useQueryClient } from "@tanstack/react-query"
import { ActivityIndicator, SafeAreaView, ScrollView, Text, View } from "react-native"
import { Header } from "@/components/FEED/Header"
import type { BlogPostType } from "@/types"
import { useState } from "react"
import { AddPostModal } from "@/components/FEED/modals/AddPostModal"
import { useAuth } from "@/context/auth/AuthContext"
import { useQueryClientReady } from "@/hooks/queries/useQueryClientReady"
import { PostDetailModal } from "@/components/FEED/modals/PostDetailModal"
import { BlogPostCard } from "@/components/FEED/cards/BlogPostCard"
import { TrendingStocksCard } from "@/components/FEED/cards/TrendingStocksCard"

const HomeScreen = () => {
  const queryClient = useQueryClient()
  const isQueryClientReady = useQueryClientReady()

  const [selectedPost, setSelectedPost] = useState<BlogPostType | null>(null)
  const [modalVisible, setModalVisible] = useState(false)
  const [addModalVisible, setAddModalVisible] = useState(false)
  const [selectedSortBy, setSelectedSortBy] = useState<"volume" | "change" | "pe" | "marketcap">("volume")

  const { data: feed, isLoading: feedLoading } = useFeedQuery()
  const { data: trendingStocks, isLoading: trendingLoading, error: trendingError } = useTrendingStocks(selectedSortBy)
  const {
    authState: { user },
  } = useAuth()

  const handlePostPress = (post: BlogPostType) => {
    console.log("Post pressed:", post.title)
    setSelectedPost(post)
    setModalVisible(true)
  }

  const handleCloseModal = () => {
    setModalVisible(false)
    setTimeout(() => setSelectedPost(null), 300)
  }

  const handleAddPress = () => {
    console.log("Add button pressed")
    setAddModalVisible(true)
  }

  const handleAddModalClose = () => {
    setAddModalVisible(false)
  }

  const handleBlogPostSuccess = async () => {
    console.log("Post submitted successfully:")
    await queryClient.invalidateQueries({ queryKey: ["feed"] })
  }

  const handleSortChange = (sortBy: "volume" | "change" | "pe" | "marketcap") => {
    setSelectedSortBy(sortBy)
  }

  return (
    <SafeAreaView className="flex-1 bg-black">
      {/* Header Component */}
      <Header onAddPress={handleAddPress} />

      <TrendingStocksCard
            stocks={trendingStocks}
            isLoading={trendingLoading}
            error={trendingError}
            selectedSortBy={selectedSortBy}
            onSortChange={handleSortChange}
            isQueryClientReady={isQueryClientReady}
          />

      {/* Main Content */}
      {feedLoading ? (
        <View className="flex-1 justify-center items-center">
          <ActivityIndicator size="large" color="#007AFF" />
          <Text className="mt-4 text-base text-gray-400 font-medium">Loading feed...</Text>
        </View>
      ) : (
        <ScrollView
          className="flex-1"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 20, paddingTop: 20 }}
        >
          {/* Trending Stocks Card */}
          {/* <TrendingStocksCard
            stocks={trendingStocks}
            isLoading={trendingLoading}
            error={trendingError}
            selectedSortBy={selectedSortBy}
            onSortChange={handleSortChange}
            isQueryClientReady={isQueryClientReady}
          /> */}
              {/* <View className="absolute top-0 left-0 right-0 z-50 mx-4 mb-6"> */}


          {/* Blog Posts */}
          {feed && feed.length > 0 ? (
            <>
              {feed.map((post) => (
                <BlogPostCard key={post.id} post={post} onPress={handlePostPress} />
              ))}
            </>
          ) : (
            <View className="flex-1 justify-center items-center px-8 py-20">
              <Text className="text-xl font-semibold text-white mb-2 text-center">No Posts Available</Text>
              <Text className="text-base text-gray-400 text-center leading-6">Check back later for new content</Text>
            </View>
          )}
        </ScrollView>
      )}

      {/* Modal for post details */}
      <PostDetailModal user={user} post={selectedPost} visible={modalVisible} onClose={handleCloseModal} />

      {/* Modal for adding new posts */}
      <AddPostModal visible={addModalVisible} onClose={handleAddModalClose} onSubmit={handleBlogPostSuccess} />
    </SafeAreaView>
  )
}

export default HomeScreen

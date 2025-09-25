import { BlogPostType, FeedType } from "@/common/types";
import React from "react";
import {
  ActivityIndicator,
  ScrollView,
  Text,
  View
} from "react-native";
import { BlogPostCard } from "./cards/BlogPostCard";

interface MainContentType {
  feedLoading: boolean;
  feed: FeedType | null | undefined;
  handlePostPress: (post: BlogPostType) => void;
  onScroll?: (scrollY: number) => void;
}

const MainContent: React.FC<MainContentType> = ({
  feedLoading,
  feed,
  handlePostPress,
  onScroll
}) => {
  const posts = feed?.posts;

  const handleScroll = (event: any) => {
    const scrollY = event.nativeEvent.contentOffset.y
    onScroll?.(scrollY)
  }

  return (
    <>
      {feedLoading ? (
        <View className="flex-1 justify-center items-center px-8">
          <View className="bg-gray-900/50 rounded-3xl p-8 border border-gray-800/30">
            <ActivityIndicator size="large" color="#007AFF" />
            <Text className="mt-6 text-lg text-gray-300 font-semibold text-center tracking-wide">Loading feed...</Text>
            <Text className="mt-2 text-sm text-gray-500 text-center font-medium">Fetching the latest content</Text>
          </View>
        </View>
      ) : (
        <ScrollView
          className="flex-1"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 20, paddingTop: 20 }}
          onScroll={handleScroll}
          scrollEventThrottle={16}
        >
          {feed && posts && posts.length > 0 ? (
            <>
              {posts.map((post) => (
                <BlogPostCard key={post.id} post={post} onPress={handlePostPress} />
              ))}
            </>
          ) : (
            <View className="flex-1 justify-center items-center px-8 py-24">
              <View className="bg-gray-900/30 rounded-3xl p-12 border border-gray-800/30 text-center">
                <Text className="text-2xl font-black text-white mb-4 text-center tracking-tight">
                  No Posts Available
                </Text>
                <Text className="text-base text-gray-400 text-center leading-7 font-medium">
                  Check back later for new content
                </Text>
                <View className="w-16 h-1 bg-gradient-to-r from-blue-500 to-blue-600 rounded-full mx-auto mt-6" />
              </View>
            </View>
          )}
        </ScrollView>
      )}
    </>
  )
}

export default MainContent

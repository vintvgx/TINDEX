import { FeedType, UnifiedFeedItem } from "@/common/types";
import React from "react";
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  Text,
  View
} from "react-native";
import { UnifiedPostCard, type FeedItemType } from "./cards/UnifiedPostCard";
import type { BlogPostType } from "@/common/types";
import type { TickerUpdate } from "@/hooks/queries/ticker/useTickerUpdatesQuery";

interface MainContentType {
  feedLoading: boolean;
  feed: FeedType | null | undefined;
  handlePostPress: (item: BlogPostType | TickerUpdate, type: "blog" | "update") => void;
  onScroll?: (scrollY: number) => void;
  refetchFeed?: () => void;
  isRefetching?: boolean;
}

const MainContent: React.FC<MainContentType> = ({
  feedLoading,
  feed,
  handlePostPress,
  onScroll,
  refetchFeed,
  isRefetching = false
}) => {
  const items = feed?.items;

  const handleScroll = (event: any) => {
    const scrollY = event.nativeEvent.contentOffset.y
    onScroll?.(scrollY)
  }

  const handleRefresh = async () => {
    if (refetchFeed) {
      await refetchFeed();
    }
  }

  // Convert UnifiedFeedItem to FeedItemType for UnifiedPostCard
  const convertToFeedItem = (item: UnifiedFeedItem): FeedItemType => {
    if (item.item_type === "update") {
      // Convert to TickerUpdate format
      const tickerUpdate: TickerUpdate = {
        id: item.id,
        ticker: item.ticker,
        content: item.content, // For updates, content is the actual content
        character_count: item.character_count,
        tags: item.tags,
        stock_research_id: null,
        research_data: null, // Can be fetched separately if needed
        model_used: null,
        target_length: null,
        status: item.status,
        published_at: item.published_at,
        user_id: item.user_id,
        created_at: item.created_at,
        updated_at: item.created_at,
      };
      return { type: "update", data: tickerUpdate };
    } else {
      // Convert to BlogPostType format
      // In unified_feed view: content field = title for blogs, full_content = content
      const blogPost: BlogPostType = {
        id: item.id,
        topic_id: "", // Not available in unified_feed view
        topic: {
          id: "",
          name: item.ticker,
          description: "",
          category: "",
          is_active: true,
          created_at: item.created_at,
        },
        title: item.content, // For blogs, content field contains the title
        content: item.full_content, // Full content
        keywords: item.tags || [],
        hashtags: [],
        word_count: 0, // Can be calculated if needed
        reading_time: 0, // Can be calculated if needed
        status: item.status as 'draft' | 'published' | 'failed',
        created_at: item.created_at,
        published_at: item.published_at || undefined,
        user_id: item.user_id || "",
        research_data: null, // Can be fetched separately if needed
      };
      return { type: "blog", data: blogPost };
    }
  };

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
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={handleRefresh}
              tintColor="#007AFF"
              colors={["#007AFF"]}
            />
          }
        >
          {feed && items && items.length > 0 ? (
            <>
              {items.map((item, index) => {
                const feedItem = convertToFeedItem(item);
                return (
                  <UnifiedPostCard
                    key={item.id}
                    item={feedItem}
                    onPress={() => {
                      if (item.item_type === "update") {
                        handlePostPress((feedItem.data as TickerUpdate), "update");
                      } else {
                        handlePostPress((feedItem.data as BlogPostType), "blog");
                      }
                    }}
                    isLast={index === items.length - 1}
                  />
                );
              })}
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

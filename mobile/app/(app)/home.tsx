import { useFeedQuery } from "@/hooks/queries/blogs/useFeedQuery";
import { prettyJSON } from "@/utils/strings/function";
import { useQueryClient } from "@tanstack/react-query";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { BlogPostCard } from "@/components/BlogPostCard";
import { BlogPost } from "@/types";

const HomeScreen = () => {
  const queryClient = useQueryClient();

  const { data: feed, isLoading: feedLoading } = useFeedQuery();

  console.log("Loading feed: " + prettyJSON(feed))

  const handlePostPress = (post: BlogPost) => {
    // TODO: Navigate to post detail screen
    console.log('Post pressed:', post.title);
  };

  return (
    <View className="mt-20 flex-1 bg-gradient-to-b from-gray-50 to-gray-100">
      {feedLoading ? (
        <View className="flex-1 justify-center items-center bg-gray-50">
          <ActivityIndicator size="large" color="#007AFF" />
          <Text className="mt-4 text-base text-gray-600 font-medium">Loading feed...</Text>
        </View>
      ) : feed && feed.length > 0 ? (
        <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
          <View className="p-4">
            {feed.map((post) => (
              <BlogPostCard
                key={post.id}
                post={post}
                onPress={handlePostPress}
              />
            ))}
          </View>
        </ScrollView>
      ) : (
        <View className="flex-1 justify-center items-center px-8">
          <Text className="text-xl font-semibold text-gray-700 mb-2 text-center">No Posts Available</Text>
          <Text className="text-base text-gray-600 text-center leading-6">
            Check back later for new content
          </Text>
        </View>
      )}
    </View>
  );
};

export default HomeScreen;

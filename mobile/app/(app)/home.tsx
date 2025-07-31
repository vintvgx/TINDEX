import { useFeedQuery } from "@/hooks/queries/blogs/useFeedQuery";
import { prettyJSON } from "@/utils/strings/function";
import { useQueryClient } from "@tanstack/react-query";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";

const HomeScreen = () => {
  const queryClient = useQueryClient();

  const { data: feed, isLoading: feedLoading } = useFeedQuery();

  console.log("Loading feed: " + prettyJSON(feed))
  

  return (
    <View className="flex-1 bg-gray-50">
      {feedLoading ? (
        <View className="flex-1 justify-center items-center bg-gray-50">
          <ActivityIndicator size="large" color="#007AFF" />
          <Text className="mt-4 text-base text-gray-600 font-medium">Loading feed...</Text>
        </View>
      ) : feed && feed.length > 0 ? (
        <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
          <View className="p-4">
            {feed.map((post) => (
              <View key={post.id} className="bg-white rounded-xl p-4 mb-4 shadow-sm">
                <Text className="text-lg font-semibold text-gray-900 mb-2 leading-6">{post.title}</Text>
                {post.content && (
                  <Text className="text-sm text-gray-600 leading-5 mb-3" numberOfLines={3}>
                    {post.content}
                  </Text>
                )}
                <View className="flex-row justify-between items-center">
                  <Text className="text-xs text-gray-400 font-medium">
                    {new Date(post.created_at || Date.now()).toLocaleDateString()}
                  </Text>
                </View>
              </View>
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

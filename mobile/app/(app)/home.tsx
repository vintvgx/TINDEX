import { useFeedQuery } from "@/hooks/queries/blogs/useFeedQuery";
import { prettyJSON } from "@/utils/strings/function";
import { useQueryClient } from "@tanstack/react-query";
import { ActivityIndicator, SafeAreaView, ScrollView, Text, View } from "react-native";
import { BlogPostCard } from "@/components/BlogPostCard";
import { Header } from "@/components/FEED/Header";
import { BlogPostType } from "@/types";
import { useState } from "react";
import { PostDetailModal } from "@/components/PostDetailModal";
import { AddPostModal } from "@/components/AddPostModal";
import { useAuth } from "@/context/auth/AuthContext";

const HomeScreen = () => {
  const queryClient = useQueryClient();
  const [selectedPost, setSelectedPost] = useState<BlogPostType | null>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [addModalVisible, setAddModalVisible] = useState(false);

  const { data: feed, isLoading: feedLoading } = useFeedQuery();
  const { authState: { user } } = useAuth();


  const handlePostPress = (post: BlogPostType) => {
    console.log('Post pressed:', post.title);
    setSelectedPost(post);
    setModalVisible(true);
  };

  const handleCloseModal = () => {
    setModalVisible(false);
    // Small delay to let animation complete before clearing post
    setTimeout(() => setSelectedPost(null), 300);
  };

  const handleAddPress = () => {
    console.log('Add button pressed');
    setAddModalVisible(true);
  };

  const handleAddModalClose = () => {
    setAddModalVisible(false);
  };

  const handleBlogPostSuccess = async () => {
    console.log('Post submitted successfully:');
    // Invalidate the feed query to refresh the list
    await queryClient.invalidateQueries({ queryKey: ['feed'] });
  };

  return (
    <SafeAreaView className="flex-1 bg-gray-100">
      {/* Header Component */}
      <View className="">
        <Header onAddPress={handleAddPress} />
      </View>

      {/* Main Content */}
      {feedLoading ? (
        <View className="flex-1 justify-center items-center">
          <ActivityIndicator size="large" color="#007AFF" />
          <Text className="mt-4 text-base text-gray-600 font-medium">Loading feed...</Text>
        </View>
      ) : feed && feed.length > 0 ? (
        <ScrollView 
          className="flex-1" 
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 20 }}
        >
          <View className="pt-4">
            {/* Single Column Layout for Full-Width Cards */}
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
          <Text className="text-xl font-semibold text-gray-700 mb-2 text-center">
            No Posts Available
          </Text>
          <Text className="text-base text-gray-600 text-center leading-6">
            Check back later for new content
          </Text>
        </View>
      )}

      {/* Modal for post details */}
      <PostDetailModal
        user={user}
        post={selectedPost}
        visible={modalVisible}
        onClose={handleCloseModal}
      />

      {/* Modal for adding new posts */}
      <AddPostModal
        visible={addModalVisible}
        onClose={handleAddModalClose}
        onSubmit={handleBlogPostSuccess}
      />
    </SafeAreaView>
  );
};

export default HomeScreen;
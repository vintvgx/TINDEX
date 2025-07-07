import { useFeedQuery } from "@/hooks/queries/blogs/useFeedQuery";
import { prettyJSON } from "@/utils/strings/function";
import { useQueryClient } from "@tanstack/react-query";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";

const HomeScreen = () => {
  const queryClient = useQueryClient();

  const { data: feed, isLoading: feedLoading } = useFeedQuery();

  console.log("Loading feed: " + prettyJSON(feed))
  

  return (
    <View style={styles.container}>
      {feedLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#007AFF" />
          <Text style={styles.loadingText}>Loading feed...</Text>
        </View>
      ) : feed && feed.length > 0 ? (
        <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
          <View style={styles.feedContainer}>
            {feed.map((post) => (
              <View key={post.id} style={styles.postCard}>
                <Text style={styles.postTitle}>{post.title}</Text>
                {post.content && (
                  <Text style={styles.postContent} numberOfLines={3}>
                    {post.content}
                  </Text>
                )}
                <View style={styles.postMeta}>
                  <Text style={styles.postDate}>
                    {new Date(post.created_at || Date.now()).toLocaleDateString()}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        </ScrollView>
      ) : (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyTitle}>No Posts Available</Text>
          <Text style={styles.emptySubtitle}>
            Check back later for new content
          </Text>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8F9FA',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F8F9FA',
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: '#6C757D',
    fontWeight: '500',
  },
  scrollView: {
    flex: 1,
  },
  feedContainer: {
    padding: 16,
  },
  postCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 3.84,
    elevation: 5,
  },
  postTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#212529',
    marginBottom: 8,
    lineHeight: 24,
  },
  postContent: {
    fontSize: 14,
    color: '#6C757D',
    lineHeight: 20,
    marginBottom: 12,
  },
  postMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  postDate: {
    fontSize: 12,
    color: '#ADB5BD',
    fontWeight: '500',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#495057',
    marginBottom: 8,
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: 16,
    color: '#6C757D',
    textAlign: 'center',
    lineHeight: 22,
  },
});

export default HomeScreen;

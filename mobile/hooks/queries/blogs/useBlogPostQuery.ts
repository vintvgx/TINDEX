import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/common/utils/context/auth/AuthContext";
import { supabase } from "@/lib/supabase/supabase";
import { BlogPostType } from "@/common/types";
import { logDebug } from "@/common/utils/strings/function";

/**
 * Custom hook to fetch a single blog post by ID
 * 
 * @param blogPostId - The ID of the blog post to fetch
 * @returns React Query result with blog post data
 */
export function useBlogPostQuery(blogPostId: string | null) {
  const { authState: { user } } = useAuth();

  return useQuery({
    queryKey: ["blogPost", blogPostId],
    queryFn: async (): Promise<BlogPostType | null> => {
      if (!blogPostId || !user) {
        return null;
      }

      logDebug("Fetching blog post:", blogPostId);

      // Fetch the full blog post with related data
      const { data, error } = await supabase
        .from("blog_posts")
        .select(`
          id,
          topic_id,
          title,
          content,
          meta_description,
          keywords,
          hashtags,
          word_count,
          reading_time,
          status,
          generation_job_id,
          seo_data,
          multimedia_data,
          research_data,
          created_at,
          published_at,
          user_id,
          topic:topics(
            id,
            name,
            description,
            created_at
          )
        `)
        .eq("id", blogPostId)
        .single();

      if (error) {
        console.error("Error fetching blog post:", error);
        throw error;
      }

      logDebug("Blog post fetched successfully");
      return data as BlogPostType;
    },
    enabled: !!blogPostId && !!user,
    staleTime: 5 * 60 * 1000, // 5 minutes
    retry: 2,
  });
}


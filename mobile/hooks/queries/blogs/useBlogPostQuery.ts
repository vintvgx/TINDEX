import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/common/utils/context/auth/AuthContext";
import { supabase } from "@/lib/supabase/supabase";
import { logDebug } from "@/common/utils/strings/function";

/**
 * Blog post type matching the actual database schema
 */
export interface BlogPostFromDB {
  id: string;
  ticker: string;
  title: string;
  content: string;
  word_count: number | null;
  reading_time: number | null;
  stock_research_id: string | null;
  model_used: string | null;
  target_length: number | null;
  generation_prompt: string | null;
  tags: string[] | null;
  category: string | null;
  excerpt: string | null;
  status: string | null;
  published_at: string | null;
  user_id: string | null;
  created_at: string;
  updated_at: string;
  research_data: any;
}

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
    queryFn: async (): Promise<BlogPostFromDB | null> => {
      if (!blogPostId || !user) {
        return null;
      }

      logDebug("Fetching blog post:", blogPostId);

      // Fetch the full blog post with all fields from the schema
      const { data, error } = await supabase
        .from("blog_posts")
        .select(`
          id,
          ticker,
          title,
          content,
          word_count,
          reading_time,
          stock_research_id,
          model_used,
          target_length,
          generation_prompt,
          tags,
          category,
          excerpt,
          status,
          published_at,
          user_id,
          created_at,
          updated_at,
          research_data
        `)
        .eq("id", blogPostId)
        .single();

      if (error) {
        console.error("Error fetching blog post:", error);
        throw error;
      }

      logDebug("Blog post fetched successfully");
      return data as BlogPostFromDB;
    },
    enabled: !!blogPostId && !!user,
    staleTime: 5 * 60 * 1000, // 5 minutes
    retry: 2,
  });
}


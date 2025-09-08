import { supabase } from "@/lib/supabase/supabase";
import {
    BlogDeletionException
} from "@/utils/posts/functions";
import { User } from "@supabase/supabase-js";
import {
    useMutation,
    useQueryClient
} from "@tanstack/react-query";

// TODO replace in blogPosts/delete.ts
interface DeleteBlogPostRequest {
  id: string;
  user: User;
}

// TODO replace in blogPosts/delete.ts
interface DeleteBlogPostResponse {
  success: boolean;
  data: string | any;
}

/**
 * Deletes a blog post directly making a call to supabase.
 *
 * @param id - id of the blog post
 * @param user object of the user attempting to delete (must be superuser to delete)
 *
 * @returns Promise<Boolean> : if the blog post was successfully deleted
 */
const deleteBlogPost = async (
  request: DeleteBlogPostRequest
): Promise<DeleteBlogPostResponse> => {
  try {
    // Verify user has an active session
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session || request.user.role != "superuser") {
      throw new BlogDeletionException("User not authenticated", "UNAUTHORIZED");
    }

    const { data, error } = await supabase
      .from("blog_posts")
      .delete()
      .eq("id", request.id)
      .select(); // .select() is required to get data/error in the response

    if (error) {
      console.error("Error deleting record:", error.message);
      throw new BlogDeletionException(
        "Failed to delete blog post",
        "DATABASE_ERROR"
      );
    } else {
      console.log("Record deleted successfully:", data);
    }

    const result: DeleteBlogPostResponse = { success: true, data: data };
    return result;
  } catch (error) {
    const result = { success: false, data: error };
    return result;
  }
};

/**
 * Hook for deleting blog post with React Query Integration.
 * @returns If post was deleted successfully
 */
export const useDeleteBlogPostMutation = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deleteBlogPost,

    onSuccess: (data) => {
      console.log("Deleted blog post successfully");

      // Invalidate and refetch relevant queries
      queryClient.invalidateQueries({
        queryKey: ["feed"],
      });

      queryClient.invalidateQueries({
        queryKey: ["blog-posts"],
      });
    },

    onError: (error: BlogDeletionException) => {
        console.error('Blog post generation failed:', error);
        
        // Log specific error details for debugging
        if (error.originalError) {
          console.error('Original error:', error.originalError);
        }
      },
  });
};

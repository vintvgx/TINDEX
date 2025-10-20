import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/supabase';
import { BlogPostType } from '@/common/types';
import {  GenerateBlogPostRequest, GenerateBlogPostResponse  } from '@/common/types/blogPosts/create';
import { BlogGenerationException, validateBlogGenerationRequest } from '@/common/utils/posts/functions';



/**
 * Generates a blog post using an api endpoint (research_yfinance)
 *  - generates research data
 *  - generates blog post 
 * 
 * @param request - The blog post generation request
 * @returns Promise<GenerateBlogPostResponse>
 */
const generateBlogPost = async (request: GenerateBlogPostRequest): Promise<GenerateBlogPostResponse> => {
  try {
    // Validate the request
    validateBlogGenerationRequest(request);

    // Verify user has an active session 
    const { data: { session } } = await supabase.auth.getSession();
    
    if (!session) {
      throw new BlogGenerationException(
        'User not authenticated',
        'UNAUTHORIZED'
      );
    }

    // Make the API call to the Edge Function
    const response = await fetch(
      `https://alethia-production.up.railway.app/generate_post/${request.ticker}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          userId: request.userId,
          ticker: request.ticker,
          targetLength: request.targetLength,
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Blog generation API error:', response.status, errorText);
      
      if (response.status === 401) {
        throw new BlogGenerationException(
          'Unauthorized access to blog generation service',
          'UNAUTHORIZED'
        );
      }
      
      if (response.status === 429) {
        throw new BlogGenerationException(
          'Rate limit exceeded for blog generation',
          'GENERATION_FAILED'
        );
      }

      throw new BlogGenerationException(
        `Blog generation failed with status ${response.status}`,
        'GENERATION_FAILED'
      );
    }

    const result: GenerateBlogPostResponse = await response.json();

    if (!result.success) {
      throw new BlogGenerationException(
        result.message || 'Blog generation failed',
        'GENERATION_FAILED'
      );
    }

    return result;

  } catch (error) {
    // Re-throw TopicCreationException as-is
    if (error instanceof BlogGenerationException) {
      throw error;
    }

    // Handle network errors
    if (error instanceof TypeError && error.message.includes('fetch')) {
      throw new BlogGenerationException(
        'Network error occurred while generating blog post',
        'NETWORK_ERROR',
        error
      );
    }

    // Handle unknown errors
    console.error('Unknown error generating blog post:', error);
    throw new BlogGenerationException(
      'An unexpected error occurred while generating blog post',
      'UNKNOWN_ERROR',
      error
    );
  }
};


/**
 * Hook for generating blog posts with React Query integration
 * @returns Mutation object with generateBlogPost function and state
 */
export const useGenerateBlogPostMutation = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: generateBlogPost,
    
    onSuccess: (data) => {
      console.log('Blog post generated successfully:', data.blogPostId);
      
      // Invalidate and refetch relevant queries
      queryClient.invalidateQueries({
        queryKey: ['feed'],
      });
      
      queryClient.invalidateQueries({
        queryKey: ['blog-posts'],
      });

      // Optionally update the cache with the new blog post
      queryClient.setQueryData(
        ['blog-posts'],
        (oldData: BlogPostType[] | undefined) => {
          if (oldData) {
            return [data.blogPostData as BlogPostType, ...oldData];
          }
          return [data.blogPostData as BlogPostType];
        }
      );
    },

    onError: (error: BlogGenerationException) => {
      console.error('Blog post generation failed:', error);
      
      // Log specific error details for debugging
      if (error.originalError) {
        console.error('Original error:', error.originalError);
      }
    },
  });
};

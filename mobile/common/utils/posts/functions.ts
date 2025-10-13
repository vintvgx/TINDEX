import {
  GenerateBlogPostRequest,
  BlogException,
} from "@/common/types/blogPosts/create";

/**
 * Custom error class for topic creation errors
 */
export class BlogGenerationException extends Error {
  constructor(
    message: string,
    public code: BlogException,
    public originalError?: any
  ) {
    super(message);
    console.error("Error occurred during generation of blog post:", message);
    this.name = "BlogGenerationException";
  }
}

/**
 * Custom error class for topic creation errors
 */
export class BlogDeletionException extends Error {
  constructor(
    message: string,
    public code: BlogException,
    public originalError?: any
  ) {
    super(message);
    console.error("Error deleting blog post:", message);
    this.name = "BlogDeletionException";
  }
}

/**
 * Validates the blog post generation request
 *
 * @param request - The blog post generation request
 * @returns true if valid, throws TopicCreationException if invalid
 */
export const validateBlogGenerationRequest = (
    request: GenerateBlogPostRequest
  ): boolean => {
    if (!request.userId || request.userId.trim().length === 0) {
      throw new BlogGenerationException(
        "User ID is required for blog generation",
        "INVALID_INPUT"
      );
    }
  
    if (!request.ticker || request.ticker.trim().length === 0) {
      throw new BlogGenerationException(
        "Topic name is required for blog generation",
        "INVALID_INPUT"
      );
    }
  
    if (!request.categoryName || request.categoryName.trim().length === 0) {
      throw new BlogGenerationException(
        "Category name is required for blog generation",
        "INVALID_INPUT"
      );
    }
  
    if (
      !request.targetLength ||
      request.targetLength < 100 ||
      request.targetLength > 2000
    ) {
      throw new BlogGenerationException(
        "Target length must be between 100 and 2000 words",
        "INVALID_INPUT"
      );
    }
  
    return true;
  };
  

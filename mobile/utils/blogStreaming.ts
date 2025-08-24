/**
 * Blog Streaming Utilities
 * 
 * This module provides utilities for handling streaming blog post generation
 * from the API, including real-time content display and error handling.
 */

export interface BlogStreamingOptions {
  topic: string;
  researchData: Record<string, any>;
  targetLength?: number;
  ticker?: string;
  onChunk?: (chunk: string) => void;
  onComplete?: (fullContent: string) => void;
  onError?: (error: string) => void;
}

export interface StreamingResponse {
  chunk?: string;
  complete?: boolean;
  error?: string;
  success: boolean;
}

/**
 * Stream blog post generation from the API
 * 
 * @param options - Configuration options for streaming
 * @returns Promise that resolves when streaming is complete
 */
export async function streamBlogPost(options: BlogStreamingOptions): Promise<string> {
  const {
    topic,
    researchData,
    targetLength = 800,
    ticker,
    onChunk,
    onComplete,
    onError
  } = options;

  let fullContent = '';

  try {
    const response = await fetch('/api/generate_blog_post_stream', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        topic,
        research_data: researchData,
        target_length: targetLength,
        ticker,
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No response body available for streaming');
    }

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data: StreamingResponse = JSON.parse(line.slice(6));
            
            if (data.error) {
              onError?.(data.error);
              throw new Error(data.error);
            }

            if (data.chunk) {
              fullContent += data.chunk;
              onChunk?.(data.chunk);
            }

            if (data.complete) {
              onComplete?.(fullContent);
              return fullContent;
            }
          } catch (parseError) {
            console.warn('Failed to parse streaming data:', line, parseError);
          }
        }
      }
    }

    return fullContent;

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    onError?.(errorMessage);
    throw error;
  }
}

/**
 * Generate blog post without streaming (single response)
 * 
 * @param options - Configuration options for blog generation
 * @returns Promise with the complete blog post data
 */
export async function generateBlogPost(options: Omit<BlogStreamingOptions, 'onChunk' | 'onComplete' | 'onError'>): Promise<{
  success: boolean;
  title?: string;
  content?: string;
  word_count?: number;
  reading_time?: number;
  ticker?: string;
  error?: string;
}> {
  const { topic, researchData, targetLength = 800, ticker } = options;

  try {
    const response = await fetch('/api/generate_blog_post', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        topic,
        research_data: researchData,
        target_length: targetLength,
        ticker,
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return await response.json();

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    return {
      success: false,
      error: errorMessage,
    };
  }
}

/**
 * Test Anthropic API connection
 * 
 * @returns Promise with connection test result
 */
export async function testAnthropicConnection(): Promise<{
  success: boolean;
  message?: string;
  response?: string;
  error?: string;
}> {
  try {
    const response = await fetch('/api/test_anthropic', {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return await response.json();

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    return {
      success: false,
      error: errorMessage,
    };
  }
}

/**
 * React Hook for streaming blog post generation
 * 
 * This hook provides a convenient way to use streaming blog generation
 * in React components with state management.
 * 
 * Note: This requires React to be imported in the file where it's used.
 */
export function useBlogStreaming() {
  // Note: React.useState and React.useCallback should be imported from 'react'
  // This is a template - implement with proper React imports in your component
  return {
    isStreaming: false,
    content: '',
    error: null,
    isComplete: false,
    startStreaming: async () => {},
    reset: () => {},
  };
}

// Example usage - implement this in your React component file
export const BlogStreamingExample = () => {
  // Implementation would go here with proper React imports
  return null;
}; 
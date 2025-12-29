import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/supabase';
import { RAILWAY_BASE_URL } from '@/lib/railway.config';

/**
 * Request interface for generating a ticker update
 */
export interface GenerateTickerUpdateRequest {
  ticker: string;
  userId: string;
  targetLength?: number; // Optional, defaults to 270, max 500
}

/**
 * Response interface for ticker update generation
 */
export interface GenerateTickerUpdateResponse {
  success: boolean;
  content: string;
  tags: string[];
  character_count: number;
  ticker: string;
  error?: string;
}

export interface  TickerUpdateRequestBody {
  target_length?: number
};

/**
 * Generates a ticker update (tweet-like content) using the API endpoint
 * 
 * @param request - The ticker update generation request
 * @returns Promise<GenerateTickerUpdateResponse>
 */
const generateTickerUpdate = async (
  request: GenerateTickerUpdateRequest
): Promise<GenerateTickerUpdateResponse> => {
  try {
    // Validate the request
    if (!request.ticker) {
      throw new Error('Ticker is required');
    }

    // Validate targetLength if provided
    if (request.targetLength !== undefined) {
      if (request.targetLength < 50 || request.targetLength > 500) {
        throw new Error('targetLength must be between 50 and 500 characters');
      }
    }

    // Verify user has an active session
    const { data: { session } } = await supabase.auth.getSession();
    
    if (!session) {
      throw new Error('User not authenticated');
    }

    // Prepare request body
    const requestBody: TickerUpdateRequestBody = {};
    if (request.targetLength !== undefined) {
      requestBody.target_length = request.targetLength;
    }

    // Make the API call
    const response = await fetch(
      `${RAILWAY_BASE_URL}/generate_ticker_update/${request.ticker}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(requestBody),
      }
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(
        errorData.error || `Failed to generate ticker update: ${response.statusText}`
      );
    }

    const data: GenerateTickerUpdateResponse = await response.json();

    if (!data.success) {
      throw new Error(data.error || 'Failed to generate ticker update');
    }

    return data;
  } catch (error) {
    console.error('Error generating ticker update:', error);
    throw error;
  }
};

/**
 * Hook for generating ticker updates with React Query integration
 * @returns Mutation object with generateTickerUpdate function and state
 */
export const useGenerateTickerUpdateMutation = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: generateTickerUpdate,
    
    onSuccess: (data, variables) => {
      console.log('Ticker update generated successfully:', data.ticker);
      
      // Invalidate and refetch ticker updates for this ticker
      queryClient.invalidateQueries({
        queryKey: ['ticker-updates', variables.ticker],
      });
    },

    onError: (error: Error) => {
      console.error('Ticker update generation failed:', error);
    },
  });
};


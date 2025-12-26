import { useMutation, useQueryClient } from '@tanstack/react-query';

/**
 * Response from ORB control endpoints
 */
interface ORBControlResponse {
  success: boolean;
  message?: string;
  error?: string;
}

/**
 * Start ORB monitoring service
 * @param debug - If true, bypasses market hours check for testing
 */
const startORBService = async (debug: boolean = false): Promise<ORBControlResponse> => {
  try {
      //TODO Update to production once merged
    //   const apiUrl = `https://alethia-production.up.railway.app/tindex/orb/start`;

        const apiUrl = `https://alethia-test-eng.up.railway.app/tindex/orb/start`
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ debug }),
    });
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `Failed to start ORB service: ${response.statusText}`);
    }
    
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error starting ORB service:', error);
    throw error;
  }
};

/**
 * Stop ORB monitoring service
 */
const stopORBService = async (): Promise<ORBControlResponse> => {
  try {
       //TODO Update to production once merged
    //   const apiUrl = `https://alethia-production.up.railway.app/tindex/orb/stop`;

    const apiUrl = `https://alethia-test-eng.up.railway.app/tindex/orb/stop`
    
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Note: Stop endpoint may require Authorization header in production
        // Add if needed: 'Authorization': `Bearer ${apiKey}`
      },
    });
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `Failed to stop ORB service: ${response.statusText}`);
    }
    
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error stopping ORB service:', error);
    throw error;
  }
};

/**
 * Hook for starting ORB monitoring service with React Query integration
 * @returns Mutation object with startORB function and state
 */
export const useStartORBMutation = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (debug: boolean = false) => startORBService(debug),
    
    onSuccess: () => {
      console.log('ORB service started successfully');
      
      // Invalidate and refetch status to get updated state
      queryClient.invalidateQueries({
        queryKey: ['orb-status'],
      });
    },

    onError: (error: Error) => {
      console.error('ORB service start failed:', error);
    },
  });
};

/**
 * Hook for stopping ORB monitoring service with React Query integration
 * @returns Mutation object with stopORB function and state
 */
export const useStopORBMutation = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: stopORBService,
    
    onSuccess: () => {
      console.log('ORB service stopped successfully');
      
      // Invalidate and refetch status to get updated state
      queryClient.invalidateQueries({
        queryKey: ['orb-status'],
      });
    },

    onError: (error: Error) => {
      console.error('ORB service stop failed:', error);
    },
  });
};


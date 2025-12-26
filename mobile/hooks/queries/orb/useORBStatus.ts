import { useQuery } from "@tanstack/react-query";

/**
 * ORB Status Response from API
 */
export interface ORBStatusResponse {
  running: boolean;
  calculation_phase?: boolean;
  active_tickers?: string[];
  orb_ranges_count?: number;
}

/**
 * Custom hook to fetch ORB monitoring service status
 * 
 * @returns React Query result with ORB status data
 */
export function useORBStatus() {
  return useQuery({
    queryKey: ['orb-status'],
    queryFn: async (): Promise<ORBStatusResponse> => {
      try {
        //TODO Update to production once merged
        // const apiUrl = `https://alethia-production.up.railway.app/tindex/orb/status`;

        const apiUrl = `https://alethia-test-eng.up.railway.app/tindex/orb/status`
        
        const response = await fetch(apiUrl, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        });
        
        if (!response.ok) {
          throw new Error(`Failed to fetch ORB status: ${response.statusText}`);
        }
        
        const data = await response.json();
        return data;
      } catch (error) {
        console.error('Error fetching ORB status:', error);
        // Return default status on error
        return {
          running: false,
        };
      }
    },
    enabled: true,
    staleTime: 5 * 1000, // 5 seconds - status changes frequently
    refetchInterval: 10 * 1000, // Refetch every 10 seconds to keep status current
    retry: 2,
    retryDelay: 1000,
  });
}


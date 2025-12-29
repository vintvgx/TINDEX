import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { RAILWAY_BASE_URL } from '@/lib/railway.config';

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
 * Checks if the current time is within service hours (9:00 AM - 5:00 PM Eastern Time)
 * 
 * Uses Intl.DateTimeFormat with formatToParts for reliable timezone-aware parsing
 * across different environments and locales.
 * 
 * @returns boolean indicating if we're within service hours
 */
function isWithinServiceHours(): boolean {
  try {
    const now = new Date();
    
    // Create Intl.DateTimeFormat configured for Eastern Time
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      hour: 'numeric',
      minute: 'numeric',
      hour12: false,
    });
    
    // Use formatToParts to reliably extract hour and minute parts
    const parts = formatter.formatToParts(now);
    
    // Extract hour and minute parts with defensive checks
    let hour: number | null = null;
    let minute: number | null = null;
    
    for (const part of parts) {
      if (part.type === 'hour' && hour === null) {
        const parsedHour = parseInt(part.value, 10);
        if (!isNaN(parsedHour) && parsedHour >= 0 && parsedHour <= 23) {
          hour = parsedHour;
        }
      } else if (part.type === 'minute' && minute === null) {
        const parsedMinute = parseInt(part.value, 10);
        if (!isNaN(parsedMinute) && parsedMinute >= 0 && parsedMinute <= 59) {
          minute = parsedMinute;
        }
      }
    }
    
    // Fallback behavior: if parsing fails, default to false (outside service hours)
    if (hour === null || minute === null) {
      console.warn('Failed to parse hour or minute from timezone formatter, defaulting to outside service hours');
      return false;
    }
    
    // Calculate current time in minutes since midnight
    const currentMinutes = hour * 60 + minute;
    
    // Service hours: 9:00 AM - 5:00 PM Eastern Time
    const startMinutes = 9 * 60; // 9:00 AM = 540 minutes
    const endMinutes = 17 * 60; // 5:00 PM = 1020 minutes
    
    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  } catch (error) {
    // Defensive fallback: if any error occurs, default to outside service hours
    console.error('Error checking service hours:', error);
    return false;
  }
}

/**
 * Custom hook to fetch ORB monitoring service status
 * Only fetches during service hours (9:00 AM - 5:00 PM Eastern Time)
 * 
 * @returns React Query result with ORB status data
 */
export function useORBStatus() {
  // Track whether we're within service hours
  // Updates every minute to handle time transitions
  const [isServiceHours, setIsServiceHours] = useState(() => isWithinServiceHours());
  
  useEffect(() => {
    // Update service hours status immediately
    setIsServiceHours(isWithinServiceHours());
    
    // Set up interval to check every minute
    // This ensures we catch transitions at 9:00 AM and 5:00 PM
    const interval = setInterval(() => {
      setIsServiceHours(isWithinServiceHours());
    }, 60 * 1000); // Check every minute
    
    return () => clearInterval(interval);
  }, []);
  
  return useQuery({
    queryKey: ['orb-status'],
    queryFn: async (): Promise<ORBStatusResponse> => {
      try {
        const apiUrl = `${RAILWAY_BASE_URL}/tindex/orb/status`;
        
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
    enabled: isServiceHours, // Only fetch during service hours (9:00 AM - 5:00 PM ET)
    staleTime: 30 * 1000, // 30 seconds
    refetchInterval: isServiceHours ? 10 * 1000 : false, // Only refetch during service hours
    retry: 2,
    retryDelay: 1000,
  });
}


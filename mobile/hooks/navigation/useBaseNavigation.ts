import { useCallback, useRef } from 'react';
import NavigationService from '@/common/services/NavigationService';
import { router, usePathname } from 'expo-router';

/**
 * useBaseNavigation - Custom hook for accessing navigation methods
 * 
 * This hook provides a convenient way to access navigation methods throughout the app
 * while maintaining the singleton pattern of NavigationService. It also provides
 * memoized callbacks for better performance in React components.
 * 
 * Key Features:
 * - Memoized navigation callbacks for performance
 * - Type-safe navigation methods
 * - Consistent API across components
 * - Easy to test and mock
 * - Built-in debounce protection against rapid navigation calls
 */

const NAVIGATION_DEBOUNCE_MS = 500; // 500ms debounce for navigation actions

export const useBaseNavigation = () => {
  // Get the singleton instance
  const navigationService = NavigationService.getInstance();

  // Get the current pathname
  const pathname = usePathname();

  // Debounce tracking
  const lastNavigationTime = useRef<number>(0);
  const pendingNavigation = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * Generic debounce wrapper for navigation actions
   * Prevents rapid successive navigation calls that could cause issues
   */
  const debounceNavigation = useCallback((navigationFn: () => void, immediate: boolean = false) => {
    const now = Date.now();
    const timeSinceLastNav = now - lastNavigationTime.current;

    // If there's a pending navigation, ignore this call (true debounce behavior)
    if (pendingNavigation.current) {
      console.log('[Navigation] Debounced - ignoring rapid click');
      return;
    }

    // If not enough time has passed since last navigation, ignore
    if (!immediate && timeSinceLastNav < NAVIGATION_DEBOUNCE_MS) {
      console.log('[Navigation] Debounced - too soon after last navigation');
      return;
    }

    // Execute navigation and set cooldown
    lastNavigationTime.current = now;
    navigationFn();

    // Set a cooldown period where new navigations are blocked
    pendingNavigation.current = setTimeout(() => {
      pendingNavigation.current = null;
    }, NAVIGATION_DEBOUNCE_MS);
  }, []);

  // ==================== BASE NAVIGATION METHODS ====================

  /**
   * Navigates directly to a specific path with optional parameters
   * Now includes debounce protection to prevent rapid navigation calls
   */
  const navigateTo = useCallback((path: any, params?: any) => {
    debounceNavigation(() => {
      console.log(`[Navigation] From: ${pathname} To: ${path}`, params);
      router.push({ pathname: path, params });
    });
  }, [pathname, debounceNavigation]);

  /**
   * Navigates back to the previous screen in the navigation stack
   * Back navigation is immediate (not debounced) as it's typically safe
   */
  const navigateBack = useCallback(() => {
    console.log(`[Navigation] Going back from: ${pathname}`);
    if (router.canGoBack()) {
      router.back();
    } else {
      navigationService.toFeed();
    }
  }, [pathname, navigationService]);

  /**
   * Replaces the current screen with a new screen (no back navigation)
   * Includes debounce protection
   */
  const replaceTo = useCallback((path: any, params?: any) => {
    debounceNavigation(() => {
      console.log(`[Navigation] Replacing: ${pathname} with: ${path}`);
      router.replace({ pathname: path, params });
    });
  }, [pathname, debounceNavigation]);

  /**
   * Resets the entire navigation stack to a specific route
   * Immediate execution (no debounce) as resets are typically intentional
   */
  const resetTo = useCallback((path: any) => {
    console.log(`[Navigation] Resetting to: ${path}`);
    router.dismissAll();
    router.replace(path);
  }, []);

  /**
   * Navigate to ticker detail screen
   * Debounced to prevent accidental double-taps
   */
  const toTicker = useCallback((ticker: string, options?: { fullScreenChart?: boolean }) => {
    debounceNavigation(() => {
      console.log("Navigating to [ticker]:", ticker);
      navigationService.toTicker(ticker, options);
    });
  }, [navigationService, debounceNavigation]);

  /**
   * Navigate to feed screen (main tab)
   * Debounced to prevent rapid tab switching
   */
  const toFeed = useCallback(() => {
    debounceNavigation(() => {
      navigationService.toFeed();
    });
  }, [navigationService, debounceNavigation]);

  /**
   * Navigate to profile screen
   * Debounced to prevent accidental double-taps
   */
  const toProfile = useCallback((userId?: string) => {
    debounceNavigation(() => {
      navigationService.toProfile(userId);
    });
  }, [navigationService, debounceNavigation]);

  /**
   * Navigate to search screen
   * Debounced to prevent rapid navigation
   */
  const toSearch = useCallback(() => {
    debounceNavigation(() => {
      navigationService.toSearch();
    });
  }, [navigationService, debounceNavigation]);

  /**
   * Navigate to watchlists screen
   * Debounced to prevent rapid navigation
   */
  const toWatchlists = useCallback(() => {
    debounceNavigation(() => {
      navigationService.toWatchlists();
    });
  }, [navigationService, debounceNavigation]);

  /**
   * Navigate to notifications screen
   * Debounced to prevent rapid navigation
   */
  const toNotifications = useCallback(() => {
    debounceNavigation(() => {
      navigationService.toNotifications();
    });
  }, [navigationService, debounceNavigation]);

  /**
   * Navigate to authentication screen
   * Immediate execution as auth flows should be responsive
   */
  const toAuth = useCallback(() => {
    navigationService.toAuth();
  }, [navigationService]);

  // ==================== NAVIGATION CONTROL METHODS ====================

  /**
   * Navigate back to previous screen with fallback
   * Immediate execution for responsive back navigation
   */
  const back = useCallback(() => {
    console.log(`Back button pressed from ${navigationService.getCurrentRoute()}`);
    navigationService.back();
  }, [navigationService]);

  /**
   * Check if navigation can go back
   */
  const canGoBack = useCallback(() => {
    return navigationService.canGoBack();
  }, [navigationService]);

  // ==================== MODAL NAVIGATION METHODS ====================

  /**
   * Open a modal screen
   * Debounced to prevent multiple modal opens
   */
  const openModal = useCallback((modalName: string, params?: Record<string, any>) => {
    debounceNavigation(() => {
      navigationService.openModal(modalName, params);
    });
  }, [navigationService, debounceNavigation]);

  /**
   * Close current modal
   * Immediate execution for responsive modal closing
   */
  const closeModal = useCallback(() => {
    navigationService.closeModal();
  }, [navigationService]);

  // ==================== UTILITY METHODS ====================

  /**
   * Navigate to a specific route with parameters
   * Debounced by default, can be made immediate with flag
   */
  const navigate = useCallback((pathname: string, params?: Record<string, any>, replace: boolean = false) => {
    debounceNavigation(() => {
      navigationService.navigate(pathname, params, replace);
    });
  }, [navigationService, debounceNavigation]);

  /**
   * Reset navigation stack to a specific route
   * Immediate execution as resets are typically intentional
   */
  const reset = useCallback((pathname: string) => {
    navigationService.reset(pathname);
  }, [navigationService]);

  /**
   * Get current route information
   */
  const getCurrentRoute = useCallback(() => {
    return navigationService.getCurrentRoute();
  }, [navigationService]);

  // ==================== RETURN HOOK API ====================

  return {
    // Base navigation methods (low-level)
    navigateTo,      // Direct path navigation (debounced)
    navigateBack,    // Smart back navigation (immediate)
    replaceTo,       // Replace current screen (debounced)
    resetTo,         // Reset navigation stack (immediate)

    // Screen navigation (debounced where appropriate)
    toTicker,        // Debounced
    toFeed,          // Debounced
    toProfile,       // Debounced
    toSearch,        // Debounced
    toWatchlists,    // Debounced
    toNotifications, // Debounced
    toAuth,          // Immediate
    
    // Navigation control
    canGoBack,
    
    // Modal navigation
    openModal,       // Debounced
    closeModal,      // Immediate
    
    // Utility methods
    navigate,        // Debounced
    reset,           // Immediate
    getCurrentRoute,
    
    // Direct access to service instance (for advanced use cases)
    navigationService,
  };
};

export default useBaseNavigation;
import { useCallback } from 'react';
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
 */
export const useBaseNavigation = () => {
  // Get the singleton instance
  const navigationService = NavigationService.getInstance();

  // Get the current pathname
  const pathname = usePathname();

  // ==================== BASE NAVIGATION METHODS ====================

  /**
   * Navigates directly to a specific path with optional parameters
   * 
   * This is a low-level navigation method that allows direct path navigation.
   * Use this when you need to navigate to routes not covered by specific methods.
   * 
   * @param path - The target route path (e.g., '/profile/123', '/settings')
   * @param params - Optional parameters to pass to the target screen
   * 
   * @example
   * navigateTo('/profile/123', { userId: '123' })
   * navigateTo('/settings')
   */
  const navigateTo = useCallback((path: any, params?: any) => {
    console.log(`[Navigation] From: ${pathname} To: ${path}`, params);
    router.push({ pathname: path, params });
  }, [pathname]);

  /**
   * Navigates back to the previous screen in the navigation stack
   * 
   * This method handles back navigation with intelligent fallback:
   * - If there's navigation history, it goes back
   * - If no history exists, it navigates to the root screen
   * 
   * @example
   * navigateBack() // Goes back or to root if no history
   */
  const navigateBack = useCallback(() => {
    console.log(`[Navigation] Going back from: ${pathname}`);
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/');
    }
  }, [pathname]);

  /**
   * Replaces the current screen with a new screen (no back navigation)
   * 
   * This method replaces the current route instead of pushing a new one.
   * Useful for redirects, authentication flows, or when you don't want
   * users to navigate back to the current screen.
   * 
   * @param path - The target route path to replace current screen
   * @param params - Optional parameters to pass to the target screen
   * 
   * @example
   * replaceTo('/auth') // Replaces current screen with auth
   * replaceTo('/profile/123', { userId: '123' })
   */
  const replaceTo = useCallback((path: any, params?: any) => {
    console.log(`[Navigation] Replacing: ${pathname} with: ${path}`);
    router.replace({ pathname: path, params });
  }, [pathname]);

  /**
   * Resets the entire navigation stack to a specific route
   * 
   * This method clears all navigation history and sets the specified route
   * as the new root. Useful for major navigation resets like:
   * - After successful authentication
   * - When switching between major app sections
   * - Deep link handling
   * 
   * @param path - The target route path to reset to
   * 
   * @example
   * resetTo('/feed') // Clears all history and goes to feed
   * resetTo('/auth') // Resets to authentication screen
   */
  const resetTo = useCallback((path: any) => {
    console.log(`[Navigation] Resetting to: ${path}`);
    router.dismissAll();
    router.replace(path);
  }, []);

  /**
   * Navigate to ticker detail screen
   * @param ticker - Stock ticker symbol
   */
  const toTicker = useCallback((ticker: string) => {
    console.log("Navigating to [ticker]:", ticker);
    navigationService.toTicker(ticker);
  }, [navigationService]);

  /**
   * Navigate to feed screen (main tab)
   */
  const toFeed = useCallback(() => {
    navigationService.toFeed();
  }, [navigationService]);

  /**
   * Navigate to profile screen
   * @param userId - Optional user ID for specific user profile
   */
  const toProfile = useCallback((userId?: string) => {
    navigationService.toProfile(userId);
  }, [navigationService]);

  /**
   * Navigate to search screen
   */
  const toSearch = useCallback(() => {
    navigationService.toSearch();
  }, [navigationService]);

  /**
   * Navigate to watchlists screen
   */
  const toWatchlists = useCallback(() => {
    navigationService.toWatchlists();
  }, [navigationService]);

  /**
   * Navigate to notifications screen
   */
  const toNotifications = useCallback(() => {
    navigationService.toNotifications();
  }, [navigationService]);

  /**
   * Navigate to authentication screen
   */
  const toAuth = useCallback(() => {
    navigationService.toAuth();
  }, [navigationService]);

  // ==================== NAVIGATION CONTROL METHODS ====================

  /**
   * Navigate back to previous screen with fallback
   */
  const back = useCallback(() => {
    console.log(`Back button pressed from ${navigationService.getCurrentRoute}`);

    navigationService.back();
  }, [navigationService]);

  /**
   * Check if navigation can go back
   * @returns boolean indicating if back navigation is possible
   */
  const canGoBack = useCallback(() => {
    return navigationService.canGoBack();
  }, [navigationService]);

  // ==================== MODAL NAVIGATION METHODS ====================

  /**
   * Open a modal screen
   * @param modalName - Name of the modal screen
   * @param params - Optional parameters to pass to the modal
   */
  const openModal = useCallback((modalName: string, params?: Record<string, any>) => {
    navigationService.openModal(modalName, params);
  }, [navigationService]);

  /**
   * Close current modal
   */
  const closeModal = useCallback(() => {
    navigationService.closeModal();
  }, [navigationService]);

  // ==================== UTILITY METHODS ====================

  /**
   * Navigate to a specific route with parameters
   * @param pathname - Route path
   * @param params - Optional parameters
   * @param replace - Whether to replace current route instead of pushing
   */
  const navigate = useCallback((pathname: string, params?: Record<string, any>, replace: boolean = false) => {
    navigationService.navigate(pathname, params, replace);
  }, [navigationService]);

  /**
   * Reset navigation stack to a specific route
   * @param pathname - Route to reset to
   */
  const reset = useCallback((pathname: string) => {
    navigationService.reset(pathname);
  }, [navigationService]);

  /**
   * Get current route information
   * @returns Current route path or null if unavailable
   */
  const getCurrentRoute = useCallback(() => {
    return navigationService.getCurrentRoute();
  }, [navigationService]);

  // ==================== RETURN HOOK API ====================

  return {
    // Base navigation methods (low-level)
    navigateTo,      // Direct path navigation
    navigateBack,    // Smart back navigation
    replaceTo,       // Replace current screen
    resetTo,         // Reset navigation stack

    // Screen navigation
    toTicker,
    toFeed,
    toProfile,
    toSearch,
    toWatchlists,
    toNotifications,
    toAuth,
    
    // Navigation control
    // back, TODO remove ( use navigateBack )
    canGoBack,
    
    // Modal navigation
    openModal,
    closeModal,
    
    // Utility methods
    navigate,
    reset,
    getCurrentRoute,
    
    // Direct access to service instance (for advanced use cases)
    navigationService,
  };
};

export default useBaseNavigation;
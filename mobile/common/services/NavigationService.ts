import { router } from 'expo-router';

/**
 * NavigationService - Singleton service for managing app navigation
 * 
 * This service provides a centralized way to handle navigation throughout the app,
 * ensuring consistent navigation patterns and making it easier to maintain and test.
 * 
 * Key Features:
 * - Singleton pattern for global access
 * - Type-safe navigation methods
 * - Consistent navigation patterns
 * - Fallback navigation for edge cases
 * - Modal navigation support
 */
class NavigationService {
  private static instance: NavigationService;

  /**
   * Get the singleton instance of NavigationService
   * @returns NavigationService instance
   */
  static getInstance(): NavigationService {
    if (!NavigationService.instance) {
      NavigationService.instance = new NavigationService();
    }
    return NavigationService.instance;
  }

  // ==================== SCREEN NAVIGATION METHODS ====================

  /**
   * Navigate to ticker detail screen
   * @param ticker - Stock ticker symbol
   */
  toTicker(ticker: string): void {
    if (!ticker || typeof ticker !== 'string') {
      console.warn('NavigationService.toTicker: Invalid ticker provided');
      return;
    }
    
    try {
      router.push(`/ticker/${ticker.toUpperCase()}`);
    } catch (error) {
      console.error('NavigationService.toTicker: Navigation failed', error);
    }
  }

  /**
   * Navigate to feed screen (main tab)
   */
  toFeed(): void {
    try {
      router.replace('/(app)/(tabs)/feed');
    } catch (error) {
      console.error('NavigationService.toFeed: Navigation failed', error);
    }
  }

  /**
   * Navigate to profile screen
   * @param userId - Optional user ID for specific user profile
   * 
   */
  toProfile(userId?: string): void {
    try {
      if (userId && typeof userId === 'string') {
        router.push(`/profile`);
      } else {
        router.push('/(app)/(tabs)/profile');
      }
    } catch (error) {
      console.error('NavigationService.toProfile: Navigation failed', error);
    }
  }

    /**
   * Navigate to profile screen
   * @param userId - Optional user ID for specific user profile
   * 
   * TODO implement navigating to a user's profile
   * 
   */
    toUserProfile(userId?: string): void {
        try {
          if (userId && typeof userId === 'string') {
            //TODO 
            // router.push(`/profile/${userId}`);`
          } else {
            router.push('/(app)/(tabs)/profile');
          }
        } catch (error) {
          console.error('NavigationService.toProfile: Navigation failed', error);
        }
      }
    

  /**
   * Navigate to search screen
   */
  toSearch(): void {
    try {
      router.push('/(app)/(tabs)/search');
    } catch (error) {
      console.error('NavigationService.toSearch: Navigation failed', error);
    }
  }

  /**
   * Navigate to watchlists screen
   */
  toWatchlists(): void {
    try {
      router.push('/(app)/(tabs)/watchlists');
    } catch (error) {
      console.error('NavigationService.toWatchlists: Navigation failed', error);
    }
  }

  /**
   * Navigate to notifications screen
   */
  toNotifications(): void {
    try {
      router.push('/(app)/(tabs)/notifications');
    } catch (error) {
      console.error('NavigationService.toNotifications: Navigation failed', error);
    }
  }

    /**
   * Navigate to a specified notification within notifications screen
   * @param id - the identification of the notification 
   *  
   * TODO implemnt
   */
    toNotificationID(id?: string): void {
        try {
        //TODO 
        //   router.push(`/(app)/(tabs)/notifications/${id}`);
        } catch (error) {
          console.error('NavigationService.toNotifications: Navigation failed', error);
        }
      }

  /**
   * Navigate to authentication screen
   */
  toAuth(): void {
    try {
      router.replace('/(public)/auth');
    } catch (error) {
      console.error('NavigationService.toAuth: Navigation failed', error);
    }
  }

  // ==================== NAVIGATION CONTROL METHODS ====================

  /**
   * Navigate back to previous screen with fallback
   */
  back(): void {
    try {
      if (router.canGoBack()) {
        router.back();
      } else {
        // Fallback to feed if no history
        this.toFeed();
      }
    } catch (error) {
      console.error('NavigationService.back: Navigation failed', error);
      // Fallback to feed on error
      this.toFeed();
    }
  }

  /**
   * Check if navigation can go back
   * @returns boolean indicating if back navigation is possible
   */
  canGoBack(): boolean {
    try {
      return router.canGoBack();
    } catch (error) {
      console.error('NavigationService.canGoBack: Error checking navigation state', error);
      return false;
    }
  }

  // ==================== MODAL NAVIGATION METHODS ====================

  /**
   * Open a modal screen
   * @param modalName - Name of the modal screen
   * @param params - Optional parameters to pass to the modal
   * 
   * TODO fix and implement
   */
  openModal(modalName: string, params?: Record<string, any>): void {
    if (!modalName || typeof modalName !== 'string') {
      console.warn('NavigationService.openModal: Invalid modal name provided');
      return;
    }

    try {
      if (params) {
        router.push({ 
          pathname: `/modals/${modalName}`, 
          params 
        });
      } else {
        router.push(`/modals/${modalName}`);
      }
    } catch (error) {
      console.error('NavigationService.openModal: Navigation failed', error);
    }
  }

  /**
   * Close current modal
   */
  closeModal(): void {
    try {
      router.back();
    } catch (error) {
      console.error('NavigationService.closeModal: Navigation failed', error);
    }
  }

  // ==================== UTILITY METHODS ====================

  /**
   * Navigate to a specific route with parameters
   * @param pathname - Route path
   * @param params - Optional parameters
   * @param replace - Whether to replace current route instead of pushing
   */
  navigate(pathname: string, params?: Record<string, any>, replace: boolean = false): void {
    if (!pathname || typeof pathname !== 'string') {
      console.warn('NavigationService.navigate: Invalid pathname provided');
      return;
    }

    try {
      if (params) {
        const navigationMethod = replace ? router.replace : router.push;
        navigationMethod({ pathname, params });
      } else {
        const navigationMethod = replace ? router.replace : router.push;
        navigationMethod(pathname);
      }
    } catch (error) {
      console.error('NavigationService.navigate: Navigation failed', error);
    }
  }

  /**
   * Reset navigation stack to a specific route
   * @param pathname - Route to reset to
   */
  reset(pathname: string): void {
    if (!pathname || typeof pathname !== 'string') {
      console.warn('NavigationService.reset: Invalid pathname provided');
      return;
    }

    try {
      router.replace(pathname);
    } catch (error) {
      console.error('NavigationService.reset: Navigation failed', error);
    }
  }

  /**
   * Get current route information
   * @returns Current route path or null if unavailable
   */
  getCurrentRoute(): string | null {
    try {
      // Note: expo-router doesn't provide direct access to current route
      // This is a placeholder for future implementation
      return null;
    } catch (error) {
      console.error('NavigationService.getCurrentRoute: Error getting current route', error);
      return null;
    }
  }
}

export default NavigationService;
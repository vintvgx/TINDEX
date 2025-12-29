/**
 * Railway API Configuration
 * 
 * Centralized configuration for Railway API base URLs.
 * Switch between production and engineering environments by changing the ENVIRONMENT constant.
 */

/**
 * Available Railway environments
 */
export enum RailwayEnvironment {
  PRODUCTION = 'production',
  ENGINEERING = 'engineering',
}

/**
 * Railway API base URLs
 */
const RAILWAY_URLS = {
  [RailwayEnvironment.PRODUCTION]: 'https://alethia-production.up.railway.app',
  [RailwayEnvironment.ENGINEERING]: 'https://alethia-test-eng.up.railway.app',
} as const;

/**
 * Current environment selection
 * 
 * Change this value to switch between environments:
 * - RailwayEnvironment.PRODUCTION: Production environment
 * - RailwayEnvironment.ENGINEERING: Engineering/test environment
 */
const ENVIRONMENT: RailwayEnvironment = RailwayEnvironment.ENGINEERING;

/**
 * Base URL for Railway API endpoints
 * 
 * This is the base URL that should be used for all Railway API calls.
 * All endpoints should be appended to this base URL.
 * 
 * @example
 * ```typescript
 * const response = await fetch(`${RAILWAY_BASE_URL}/generate_post/${ticker}`);
 * ```
 */
export const RAILWAY_BASE_URL: string = RAILWAY_URLS[ENVIRONMENT];

/**
 * Helper function to get the current environment
 * @returns Current Railway environment
 */
export const getRailwayEnvironment = (): RailwayEnvironment => ENVIRONMENT;

/**
 * Helper function to check if we're in production
 * @returns True if current environment is production
 */
// export const isProduction = (): boolean =>  ENVIRONMENT === RailwayEnvironment.PRODUCTION ;


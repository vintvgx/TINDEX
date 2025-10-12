/**
 * Cron Job: Watchlist Notifications
 * 
 * Runs daily at 7 AM and 7 PM to notify users about their subscribed watchlists.
 * 
 * Flow:
 * 1. Fetch latest watchlist data from API
 * 2. Query users who have watchlist notifications enabled
 * 3. Send personalized push notifications via Expo
 * 4. Include redirect data to open specific watchlist
 * 
 * @version 1.0.0
 * @cron 0 7,19 * * * (7 AM and 7 PM daily)
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { corsHeaders } from "../shared/utils/constants.ts";

// ========================================
// TYPE DEFINITIONS
// ========================================

interface WatchlistStock {
  ticker: string;
  company: string;
  price: number;
  change: number;
  change_percent: number;
  market_cap: number;
  pe_ratio: number | null;
  volume: number;
  avg_volume: number;
  week_change: number | null;
  week_range: string;
}

interface WatchlistData {
  success: boolean;
  timestamp: number;
  watchlist_type: string;
  count: number;
  data: WatchlistStock[];
}

interface WatchlistResponse {
  success: boolean;
  timestamp: number;
  watchlists: {
    gainers: WatchlistData;
    most_active: WatchlistData;
    trending: WatchlistData;
  };
}

interface UserProfile {
  id: string;
  expo_push_token: string;
  notification_preferences: {
    enabled: boolean;
    watchlist_alerts?: boolean;
  };
  watchlist_subscriptions: WatchlistType[]; // ✨ Now strongly typed
}

// Add enum to match mobile types
enum WatchlistTypeEnum {
  BIGGEST_GAINERS = 'biggest-gainers',
  TRENDING = 'trending',
  MOST_ACTIVE = 'most-active',
  INSIDER_BUYING = 'insider_buying',
  CONGRESS_TRADING = 'congress_trading',
  TOP_GAINERS = 'top_gainers',
  TOP_LOSERS = 'top_losers',
}

type WatchlistType = `${WatchlistTypeEnum}`;

// Type guard for runtime validation
function isValidWatchlistType(value: unknown): value is WatchlistType {
  const validTypes = Object.values(WatchlistTypeEnum);
  return typeof value === 'string' && validTypes.includes(value as WatchlistTypeEnum);
}

interface ExpoPushMessage {
  to: string;
  sound: string;
  title: string;
  body: string;
  data: {
    screen: string;
    watchlistType: WatchlistType; 
    subscribedWatchlists: WatchlistType[]; 
  };
  badge?: number;
  priority: string;
  channelId: string;
}

interface ExpoPushReceipt {
  data?: {
    id: string;
    status: string;
  };
  error?: string;
}

const WATCHLIST_LABELS: Record<WatchlistTypeEnum, string> = {
  [WatchlistTypeEnum.BIGGEST_GAINERS]: "Biggest Gainers",
  [WatchlistTypeEnum.TRENDING]: "Trending",
  [WatchlistTypeEnum.MOST_ACTIVE]: "Most Active",
  [WatchlistTypeEnum.INSIDER_BUYING]: "Insider Buying",
  [WatchlistTypeEnum.CONGRESS_TRADING]: "Congress Trading",
  [WatchlistTypeEnum.TOP_GAINERS]: "Top Gainers",
  [WatchlistTypeEnum.TOP_LOSERS]: "Top Losers",
};


// ========================================
// CONSTANTS
// ========================================

const WATCHLIST_API_URL = "https://alethia-test-eng.up.railway.app/watchlist/all";
const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

// ========================================
// HELPER FUNCTIONS
// ========================================

/**
 * Fetches watchlist data from the external API
 * @throws {Error} If API request fails
 */
async function fetchWatchlistData(): Promise<WatchlistResponse> {
  console.log(`Fetching watchlist data from: ${WATCHLIST_API_URL}`);
  
  const response = await fetch(WATCHLIST_API_URL);
  
  if (!response.ok) {
    throw new Error(`Failed to fetch watchlist data: ${response.statusText}`);
  }
  
  const data: WatchlistResponse = await response.json();
  
  if (!data.success) {
    throw new Error("Watchlist API returned unsuccessful response");
  }
  
  console.log(`Successfully fetched watchlist data. Timestamp: ${data.timestamp}`);
  return data;
}

/**
 * Queries Supabase for users who should receive watchlist notifications
 * @param supabaseClient - Initialized Supabase client
 */
async function getEligibleUsers(supabaseClient: any): Promise<UserProfile[]> {
  console.log("Querying eligible users from database...");
  
  const { data, error } = await supabaseClient
    .from("user_profiles")
    .select("id, expo_push_token, notification_preferences, watchlist_subscriptions")
    .not("expo_push_token", "is", null)
    .not("watchlist_subscriptions", "eq", "[]")
    .eq("is_active", true);
  
  if (error) {
    console.error("Error querying users:", error);
    throw error;
  }
  
  // Filter with type validation
  const eligibleUsers = (data as UserProfile[]).filter(user => {
    const prefs = user.notification_preferences;
    const hasValidSubscriptions = user.watchlist_subscriptions?.some(isValidWatchlistType) ?? false;
    
    return (
      prefs &&
      prefs.enabled === true &&
      (prefs.watchlist_alerts === undefined || prefs.watchlist_alerts === true) &&
      hasValidSubscriptions
    );
  });
  
  console.log(`Found ${eligibleUsers.length} eligible users for notifications`);
  return eligibleUsers;
}

/**
 * Generates notification message based on number of subscribed watchlists
 * @param subscribedWatchlists - Array of watchlist types user is subscribed to
 */
function generateNotificationMessage(subscribedWatchlists: string[]): { title: string; body: string } {
  if (subscribedWatchlists.length === 0) {
    return { title: "Watchlist Update", body: "Check out the latest market data" };
  }
  
  if (subscribedWatchlists.length === 1) {
    const watchlistName = WATCHLIST_LABELS[subscribedWatchlists[0]] || subscribedWatchlists[0];
    return {
      title: `New ${watchlistName} Available`,
      body: `Fresh ${watchlistName.toLowerCase()} data is now available`,
    };
  }
  
  return {
    title: "New Watchlist Alert",
    body: `Updates available for ${subscribedWatchlists.length} watchlists`,
  };
}

/**
 * Sends push notification to a user via Expo Push API
 * @param user - User profile with push token
 * @returns Success status and any error messages
 */
async function sendPushNotification(user: UserProfile): Promise<{ success: boolean; error?: string }> {
  if (!user.expo_push_token || !user.watchlist_subscriptions || user.watchlist_subscriptions.length === 0) {
    return { success: false, error: "Invalid user data" };
  }
  
  // Generate personalized message
  const { title, body } = generateNotificationMessage(user.watchlist_subscriptions);
  
  // Get the first subscribed watchlist for redirect
  const firstWatchlist = user.watchlist_subscriptions[0];
  
  // Construct push notification payload
  const message: ExpoPushMessage = {
    to: user.expo_push_token,
    sound: "default",
    title,
    body,
    data: {
      screen: "watchlists", // Route to watchlists screen
      watchlistType: firstWatchlist,
      subscribedWatchlists: user.watchlist_subscriptions,
    },
    badge: 1,
    priority: "high",
    channelId: "watchlist-updates",
  };
  
  try {
    const response = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Accept-Encoding": "gzip, deflate",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(message),
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Failed to send notification to user ${user.id}:`, errorText);
      return { success: false, error: errorText };
    }
    
    const receipt: ExpoPushReceipt = await response.json();
    
    if (receipt.error) {
      console.error(`Expo returned error for user ${user.id}:`, receipt.error);
      return { success: false, error: receipt.error };
    }
    
    console.log(`Successfully sent notification to user ${user.id}`);
    return { success: true };
    
  } catch (error) {
    console.error(`Exception sending notification to user ${user.id}:`, error);
    return { success: false, error: String(error) };
  }
}

/**
 * Sends notifications to all eligible users in batches
 * @param users - Array of eligible users
 */
async function sendBatchNotifications(users: UserProfile[]): Promise<{
  total: number;
  successful: number;
  failed: number;
  errors: string[];
}> {
  console.log(`Sending notifications to ${users.length} users...`);
  
  const results = {
    total: users.length,
    successful: 0,
    failed: 0,
    errors: [] as string[],
  };
  
  // Process in batches of 100 (Expo's recommended batch size)
  const BATCH_SIZE = 100;
  
  for (let i = 0; i < users.length; i += BATCH_SIZE) {
    const batch = users.slice(i, i + BATCH_SIZE);
    
    // Send notifications in parallel for each batch
    const batchResults = await Promise.allSettled(
      batch.map(user => sendPushNotification(user))
    );
    
    // Process results
    batchResults.forEach((result, index) => {
      if (result.status === "fulfilled" && result.value.success) {
        results.successful++;
      } else {
        results.failed++;
        const error = result.status === "fulfilled" 
          ? result.value.error 
          : String(result.reason);
        results.errors.push(`User ${batch[index].id}: ${error}`);
      }
    });
    
    // Small delay between batches to avoid rate limiting
    if (i + BATCH_SIZE < users.length) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  
  console.log(`Batch notifications complete. Success: ${results.successful}, Failed: ${results.failed}`);
  return results;
}

// ========================================
// MAIN HANDLER
// ========================================

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  
  const startTime = Date.now();
  console.log("=== Watchlist Cron Job Started ===");
  console.log(`Timestamp: ${new Date().toISOString()}`);
  
  try {
    // Initialize Supabase client
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseClient = createClient(supabaseUrl, supabaseServiceKey);
    
    // Step 1: Fetch latest watchlist data
    const watchlistData = await fetchWatchlistData();
    
    // Step 2: Get eligible users
    const eligibleUsers = await getEligibleUsers(supabaseClient);
    
    if (eligibleUsers.length === 0) {
      console.log("No eligible users found. Exiting.");
      return new Response(
        JSON.stringify({
          success: true,
          message: "No eligible users to notify",
          timestamp: Date.now(),
          duration: Date.now() - startTime,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }
    
    // Step 3: Send notifications
    const notificationResults = await sendBatchNotifications(eligibleUsers);
    
    // Step 4: Return summary
    const duration = Date.now() - startTime;
    console.log(`=== Watchlist Cron Job Completed in ${duration}ms ===`);
    
    return new Response(
      JSON.stringify({
        success: true,
        message: "Watchlist notifications sent",
        timestamp: Date.now(),
        duration,
        watchlistDataTimestamp: watchlistData.timestamp,
        notifications: notificationResults,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
    
  } catch (error) {
    console.error("Fatal error in cron job:", error);
    
    return new Response(
      JSON.stringify({
        success: false,
        error: String(error),
        timestamp: Date.now(),
        duration: Date.now() - startTime,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});

/* 
===========================================
DEPLOYMENT & TESTING
===========================================

1. Deploy the function:
   supabase functions deploy cron-watchlist

2. Test locally:
   supabase functions serve cron-watchlist --env-file .env.local
   
   curl -i --location --request POST 'http://127.0.0.1:54321/functions/v1/cron-watchlist' \
     --header 'Authorization: Bearer YOUR_ANON_KEY' \
     --header 'Content-Type: application/json'

3. Set up cron schedule in Supabase Dashboard:
   - Navigate to Database > Functions > cron-watchlist
   - Add cron expression: "0 7,19 * * *" (7 AM and 7 PM daily)
   - Or use pg_cron SQL:

   SELECT cron.schedule(
     'watchlist-notifications-morning',
     '0 7 * * *',
     $$
     SELECT net.http_post(
       url := 'YOUR_SUPABASE_URL/functions/v1/cron-watchlist',
       headers := '{"Content-Type": "application/json", "Authorization": "Bearer YOUR_SERVICE_KEY"}'::jsonb
     );
     $$
   );
   
   SELECT cron.schedule(
     'watchlist-notifications-evening',
     '0 19 * * *',
     $$
     SELECT net.http_post(
       url := 'YOUR_SUPABASE_URL/functions/v1/cron-watchlist',
       headers := '{"Content-Type": "application/json", "Authorization": "Bearer YOUR_SERVICE_KEY"}'::jsonb
     );
     $$
   );

===========================================
MONITORING & MAINTENANCE
===========================================

- Monitor function logs in Supabase Dashboard
- Check notification delivery rates
- Add alerting for failed batches (> 10% failure rate)
- Consider adding retry logic for failed notifications
- Implement exponential backoff for API rate limits

===========================================
*/

/**
 * Cron Job: Ticker Updates Generation
 * 
 * Runs daily at 9 AM to generate ticker updates for all stocks in user_stock_follows.
 * 
 * Flow:
 * 1. Query all unique tickers from user_stock_follows table
 * 2. For each ticker, call the generate_ticker_update API endpoint
 * 3. Process updates in batches to avoid rate limiting
 * 4. Log results and handle errors gracefully
 * 
 * @version 1.0.0
 * @cron 0 9 * * * (9 AM daily)
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

// ========================================
// TYPE DEFINITIONS
// ========================================

interface UserStockFollow {
  user_id: string;
  ticker: string;
  orb_enabled: boolean;
  notification_enabled: boolean;
  created_at: string;
  updated_at: string;
}

interface TickerUpdateResponse {
  success: boolean;
  content?: string;
  tags?: string[];
  character_count?: number;
  ticker?: string;
  ticker_update_id?: string;
  saved?: boolean;
  error?: string;
}

interface TickerUpdateResult {
  ticker: string;
  success: boolean;
  update_id?: string;
  error?: string;
}

interface BatchResult {
  total: number;
  successful: number;
  failed: number;
  results: TickerUpdateResult[];
}

interface UserProfile {
  id: string;
  expo_push_token: string;
  notification_preferences: {
    enabled: boolean;
    ticker_updates?: boolean;
  };
}

interface ExpoPushMessage {
  to: string;
  sound: string;
  title: string;
  body: string;
  data: {
    screen: string;
    type: string;
    tickersUpdated?: number;
    successfulUpdates?: number;
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

interface SaveNotificationResponse {
  id: string;
  success: boolean;
  error?: string;
  userId?: string;
}

// ========================================
// CONSTANTS
// ========================================

const FLASK_API_BASE_URL = "https://alethia-test-eng.up.railway.app";
const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const BATCH_SIZE = 10; // Process 10 tickers at a time to avoid rate limiting
const BATCH_DELAY_MS = 1000; // 1 second delay between batches
const NOTIFICATION_BATCH_SIZE = 100; // Process notifications in batches

// ========================================
// HELPER FUNCTIONS
// ========================================

/**
 * Retrieves all unique tickers from user_stock_follows table
 * @param supabaseClient - Initialized Supabase client
 * @returns Array of unique ticker symbols
 */
async function getAllFollowedTickers(
  supabaseClient: any
): Promise<string[]> {
  console.log("Querying all unique tickers from user_stock_follows...");

  try {
    // Query all records to get unique tickers
    const { data, error } = await supabaseClient
      .from("user_stock_follows")
      .select("ticker")
      .not("ticker", "is", null);

    if (error) {
      console.error("Error querying user_stock_follows:", error);
      throw error;
    }

    if (!data || data.length === 0) {
      console.log("No tickers found in user_stock_follows");
      return [];
    }

    // Extract unique tickers
    const uniqueTickers: string[] = Array.from(
      new Set(data.map((record: UserStockFollow) => record.ticker.toUpperCase()))
    ) as string[];

    console.log(`Found ${uniqueTickers.length} unique tickers: ${uniqueTickers.join(", ")}`);
    return uniqueTickers;
  } catch (error) {
    console.error("Exception retrieving tickers:", error);
    throw error;
  }
}

/**
 * Generates a ticker update by calling the Flask API
 * @param ticker - Stock ticker symbol
 * @returns Result of the update generation
 */
async function generateTickerUpdate(
  ticker: string
): Promise<TickerUpdateResult> {
  try {
    console.log(`Generating ticker update for ${ticker}...`);

    const url = `${FLASK_API_BASE_URL}/generate_ticker_update/${ticker}`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        target_length: 500, // Default target length
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage = errorText;
      try {
        const errorJson = JSON.parse(errorText);
        errorMessage = errorJson.error || errorText;
      } catch {
        // If parsing fails, use the raw error text
      }

      console.error(`Failed to generate update for ${ticker}: ${errorMessage}`);
      return {
        ticker,
        success: false,
        error: errorMessage,
      };
    }

    const data: TickerUpdateResponse = await response.json();

    if (!data.success) {
      console.error(`Update generation failed for ${ticker}: ${data.error || "Unknown error"}`);
      return {
        ticker,
        success: false,
        error: data.error || "Unknown error",
      };
    }

    console.log(`Successfully generated update for ${ticker} (ID: ${data.ticker_update_id || "N/A"})`);
    return {
      ticker,
      success: true,
      update_id: data.ticker_update_id,
    };
  } catch (error) {
    console.error(`Exception generating update for ${ticker}:`, error);
    return {
      ticker,
      success: false,
      error: String(error),
    };
  }
}

/**
 * Processes ticker updates in batches to avoid rate limiting
 * @param tickers - Array of ticker symbols to process
 * @returns Batch result with success/failure counts
 */
async function processTickerUpdatesInBatches(
  tickers: string[]
): Promise<BatchResult> {
  console.log(`Processing ${tickers.length} tickers in batches of ${BATCH_SIZE}...`);

  const results: TickerUpdateResult[] = [];
  let successful = 0;
  let failed = 0;

  // Process in batches
  for (let i = 0; i < tickers.length; i += BATCH_SIZE) {
    const batch = tickers.slice(i, i + BATCH_SIZE);
    console.log(`Processing batch ${Math.floor(i / BATCH_SIZE) + 1}: ${batch.join(", ")}`);

    // Process batch in parallel
    const batchResults = await Promise.allSettled(
      batch.map((ticker) => generateTickerUpdate(ticker))
    );

    // Process results
    batchResults.forEach((result, index) => {
      if (result.status === "fulfilled") {
        const updateResult = result.value;
        results.push(updateResult);
        if (updateResult.success) {
          successful++;
        } else {
          failed++;
        }
      } else {
        const ticker = batch[index];
        console.error(`Promise rejected for ${ticker}:`, result.reason);
        results.push({
          ticker,
          success: false,
          error: String(result.reason),
        });
        failed++;
      }
    });

    // Add delay between batches to avoid rate limiting
    if (i + BATCH_SIZE < tickers.length) {
      console.log(`Waiting ${BATCH_DELAY_MS}ms before next batch...`);
      await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS));
    }
  }

  return {
    total: tickers.length,
    successful,
    failed,
    results,
  };
}

/**
 * Retrieves all users who follow stocks and have notifications enabled
 * @param supabaseClient - Initialized Supabase client
 * @returns Array of eligible user profiles
 */
async function getEligibleUsers(
  supabaseClient: any
): Promise<UserProfile[]> {
  console.log("Querying eligible users for ticker update notifications...");

  try {
    // Get unique user IDs from user_stock_follows
    const { data: followsData, error: followsError } = await supabaseClient
      .from("user_stock_follows")
      .select("user_id")

    if (followsError) {
      console.error("Error querying user_stock_follows:", followsError);
      throw followsError;
    }

    if (!followsData || followsData.length === 0) {
      console.log("No users found following stocks");
      return [];
    }

    // Get unique user IDs
    const userIds: string[] = Array.from(
      new Set(followsData.map((record: { user_id: string }) => record.user_id as string))
    ) as string[];

    if (userIds.length === 0) {
      return [];
    }

    // Query user profiles with notification preferences
    const { data: profilesData, error: profilesError } = await supabaseClient
      .from("user_profiles")
      .select("id, expo_push_token, notification_preferences")
      .in("id", userIds)

    if (profilesError) {
      console.error("Error querying user_profiles:", profilesError);
      throw profilesError;
    }

    // Filter users with notifications enabled
    const eligibleUsers = (profilesData || []).filter((user: UserProfile) => {
      const prefs = user.notification_preferences;
      return (
        prefs &&
        prefs.enabled === true 
      );
    });

    console.log(`Found ${eligibleUsers.length} eligible users for notifications`);
    return eligibleUsers;
  } catch (error) {
    console.error("Exception retrieving eligible users:", error);
    throw error;
  }
}

/**
 * Generates notification message based on batch results
 * @param batchResults - Results from ticker update generation
 * @returns Notification title and body
 */
function generateNotificationMessage(
  batchResults: BatchResult
): { title: string; body: string } {
  const { successful, total } = batchResults;

  if (successful === 0) {
    return {
      title: "Ticker Updates",
      body: "No updates were generated. Please try again later.",
    };
  }

  if (successful === total) {
    return {
      title: "Ticker Updates Complete",
      body: `Successfully generated updates for ${successful} stock${successful > 1 ? "s" : ""}. Check your feed!`,
    };
  }

  return {
    title: "Ticker Updates Generated",
    body: `Generated updates for ${successful} of ${total} stocks. Check your feed for the latest updates!`,
  };
}

/**
 * Sends push notification to a user via Expo Push API
 * @param user - User profile with push token
 * @param batchResults - Results from ticker update generation
 * @param supabaseClient - Initialized Supabase client
 * @returns Success status and any error messages
 */
async function sendPushNotification(
  user: UserProfile,
  batchResults: BatchResult,
  supabaseClient: any
): Promise<{ success: boolean; error?: string }> {
  if (!user.expo_push_token) {
    return { success: false, error: "No push token" };
  }

  // Generate personalized message
  const { title, body } = generateNotificationMessage(batchResults);

  // Construct push notification payload
  const message: ExpoPushMessage = {
    to: user.expo_push_token,
    sound: "default",
    title,
    body,
    data: {
      screen: "feed", // Route to feed screen
      type: "ticker_updates",
      tickersUpdated: batchResults.total,
      successfulUpdates: batchResults.successful,
    },
    badge: 1,
    priority: "high",
    channelId: "ticker-updates",
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

    // Save notification to database after successful send
    await saveNotification(message, user, supabaseClient);

    console.log(`Successfully sent notification to user ${user.id}`);
    return { success: true };
  } catch (error) {
    console.error(`Exception sending notification to user ${user.id}:`, error);
    return { success: false, error: String(error) };
  }
}

/**
 * Saves the notification to the database for UI display
 * @param message - The Expo push message sent
 * @param user - The user profile
 * @param supabaseClient - Initialized Supabase client
 */
async function saveNotification(
  message: ExpoPushMessage,
  user: UserProfile,
  supabaseClient: any
): Promise<SaveNotificationResponse> {
  try {
    const { data, error } = await supabaseClient
      .from("notifications")
      .insert({
        user_id: user.id,
        title: message.title,
        body: message.body,
        type: "ticker_updates",
        data: {
          screen: message.data.screen,
          type: message.data.type,
          tickersUpdated: message.data.tickersUpdated,
          successfulUpdates: message.data.successfulUpdates,
          sentAt: new Date().toISOString(),
        },
        // Optional: Set expiration (e.g., 30 days)
        expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      })
      .select()
      .single();

    if (error) {
      console.error(`Failed to save notification for user ${user.id}:`, error);
      return {
        id: "",
        success: false,
        error: error.message,
      };
    }

    return {
      id: data.id,
      success: true,
      userId: user.id,
    };
  } catch (error) {
    console.error(`Exception saving notification for user ${user.id}:`, error);
    return {
      id: "",
      success: false,
      error: String(error),
    };
  }
}

/**
 * Sends notifications to all eligible users in batches
 * @param users - Array of eligible users
 * @param batchResults - Results from ticker update generation
 * @param supabaseClient - Initialized Supabase client
 * @returns Notification results
 */
async function sendBatchNotifications(
  users: UserProfile[],
  batchResults: BatchResult,
  supabaseClient: any
): Promise<{
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

  // Process in batches
  for (let i = 0; i < users.length; i += NOTIFICATION_BATCH_SIZE) {
    const batch = users.slice(i, i + NOTIFICATION_BATCH_SIZE);

    // Send notifications in parallel for each batch
    const batchResults = await Promise.allSettled(
      batch.map((user) => sendPushNotification(user, batchResults, supabaseClient))
    );

    // Process results
    batchResults.forEach((result, index) => {
      if (result.status === "fulfilled" && result.value.success) {
        results.successful++;
      } else {
        results.failed++;
        const error =
          result.status === "fulfilled"
            ? result.value.error
            : String(result.reason);
        results.errors.push(`User ${batch[index].id}: ${error}`);
      }
    });

    // Small delay between batches to avoid rate limiting
    if (i + NOTIFICATION_BATCH_SIZE < users.length) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  console.log(
    `Batch notifications complete. Success: ${results.successful}, Failed: ${results.failed}`
  );
  return results;
}

// ========================================
// MAIN HANDLER
// ========================================

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const startTime = Date.now();
  console.log("=== Ticker Updates Cron Job Started ===");
  console.log(`Timestamp: ${new Date().toISOString()}`);

  try {
    // Initialize Supabase client
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseClient = createClient(supabaseUrl, supabaseServiceKey);

    // Step 1: Get all unique tickers from user_stock_follows
    const tickers = await getAllFollowedTickers(supabaseClient);

    if (tickers.length === 0) {
      console.log("No tickers found. Exiting.");
      return new Response(
        JSON.stringify({
          success: true,
          message: "No tickers found in user_stock_follows",
          timestamp: Date.now(),
          duration: Date.now() - startTime,
          results: {
            total: 0,
            successful: 0,
            failed: 0,
            results: [],
          },
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Step 2: Generate updates for all tickers in batches
    const batchResults = await processTickerUpdatesInBatches(tickers);

    // Step 3: Get eligible users and send notifications
    let notificationResults: {
      total: number;
      successful: number;
      failed: number;
      errors: string[];
    } | null = null;
    try {
      const eligibleUsers = await getEligibleUsers(supabaseClient);
      
      if (eligibleUsers.length > 0) {
        console.log(`Sending notifications to ${eligibleUsers.length} users...`);
        notificationResults = await sendBatchNotifications(
          eligibleUsers,
          batchResults,
          supabaseClient
        );
        console.log(
          `Notifications sent. Success: ${notificationResults.successful}, Failed: ${notificationResults.failed}`
        );
      } else {
        console.log("No eligible users found for notifications");
      }
    } catch (notificationError) {
      // Log error but don't fail the entire job
      console.error("Error sending notifications:", notificationError);
      notificationResults = {
        total: 0,
        successful: 0,
        failed: 0,
        errors: [String(notificationError)],
      };
    }

    // Step 4: Return summary
    const duration = Date.now() - startTime;
    console.log(`=== Ticker Updates Cron Job Completed in ${duration}ms ===`);
    console.log(`Success: ${batchResults.successful}, Failed: ${batchResults.failed}`);

    return new Response(
      JSON.stringify({
        success: true,
        message: "Ticker updates generation completed",
        timestamp: Date.now(),
        duration,
        tickers_processed: tickers.length,
        results: batchResults,
        notifications: notificationResults,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Fatal error in ticker updates cron job:", error);

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
   supabase functions deploy cron-ticker-updates

2. Test locally:
   supabase functions serve cron-ticker-updates --env-file .env.local
   
   curl -i --location --request POST 'http://127.0.0.1:54321/functions/v1/cron-ticker-updates' \
     --header 'Authorization: Bearer YOUR_ANON_KEY' \
     --header 'Content-Type: application/json'

3. Set up cron schedule in Supabase Dashboard:
   - Navigate to Database > Functions > cron-ticker-updates
   - Add cron expression: "0 9 * * *" (9 AM daily)
   - Or use pg_cron SQL:

   SELECT cron.schedule(
     'ticker-updates-daily',
     '0 9 * * *',
     $$
     SELECT net.http_post(
       url := 'YOUR_SUPABASE_URL/functions/v1/cron-ticker-updates',
       headers := '{"Content-Type": "application/json", "Authorization": "Bearer YOUR_SERVICE_KEY"}'::jsonb
     );
     $$
   );

===========================================
MONITORING & MAINTENANCE
===========================================

- Monitor function logs in Supabase Dashboard
- Check success/failure rates for ticker updates
- Add alerting for high failure rates (> 20% failure rate)
- Consider adding retry logic for failed updates
- Monitor API rate limits and adjust BATCH_SIZE/BATCH_DELAY_MS if needed
- Track which tickers consistently fail and investigate

===========================================
*/


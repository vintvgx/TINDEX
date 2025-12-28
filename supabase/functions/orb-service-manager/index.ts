// supabase/functions/orb-service-manager/index.ts

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

// ========================================
// CONSTANTS
// ========================================

// TODO Change this to production after merging @coderabbitai (remind me of this)
const FLASK_API_BASE_URL = "https://alethia-test-eng.up.railway.app";

// ========================================
// TYPE DEFINITIONS
// ========================================

interface ServiceResponse {
  success: boolean;
  message: string;
  timestamp: number;
  action?: "start" | "stop" | "status";
  service_status?: {
    running: boolean;
    calculation_phase?: boolean;
    active_tickers?: string[];
    orb_ranges_count?: number;
  };
}

// ========================================
// HELPER FUNCTIONS
// ========================================

/**
 * Checks if current time is within market hours (ET)
 */
function isMarketHours(): boolean {
  const now = new Date();
  const etTime = new Date(
    now.toLocaleString("en-US", { timeZone: "America/New_York" })
  );

  const day = etTime.getDay();
  const hours = etTime.getHours();
  const minutes = etTime.getMinutes();

  // Skip weekends (0 = Sunday, 6 = Saturday)
  if (day === 0 || day === 6) {
    return false;
  }

  // Market hours: 9:30 AM - 4:00 PM ET
  const currentMinutes = hours * 60 + minutes;
  const marketOpen = 9 * 60 + 30; // 9:30 AM
  const marketClose = 16 * 60; // 4:00 PM

  return currentMinutes >= marketOpen && currentMinutes <= marketClose;
}

/**
 * Determines if we should start or stop the service
 */
function determineAction(): "start" | "stop" | "none" {
  const now = new Date();
  const etTime = new Date(
    now.toLocaleString("en-US", { timeZone: "America/New_York" })
  );

  const day = etTime.getDay();
  const hours = etTime.getHours();
  const minutes = etTime.getMinutes();
  const currentMinutes = hours * 60 + minutes;

  // Skip weekends
  if (day === 0 || day === 6) {
    return "none";
  }

  // Start at 9:15 AM ET (15 minutes before market open)
  const serviceStart = 9 * 60 + 15; // 9:15 AM
  const serviceStop = 16 * 60 + 15; // 4:15 PM (15 minutes after market close)

  // If we're at the start time (within a 2-minute window for cron timing variance)
  if (currentMinutes >= serviceStart && currentMinutes <= serviceStart + 2) {
    return "start";
  }

  // If we're at the stop time (within a 2-minute window)
  if (currentMinutes >= serviceStop && currentMinutes <= serviceStop + 2) {
    return "stop";
  }

  return "none";
}

/**
 * Calls the Flask API to start the ORB monitoring service
 */
async function startORBService(): Promise<ServiceResponse> {
  try {
    console.log("Calling Flask API to start ORB service...");

    const response = await fetch(`${FLASK_API_BASE_URL}/tindex/orb/start`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        triggered_by: "supabase_cron",
        timestamp: new Date().toISOString(),
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Failed to start ORB service: ${errorText}`);
      return {
        success: false,
        message: `Failed to start service: ${errorText}`,
        timestamp: Date.now(),
      };
    }

    const data = await response.json();
    console.log("ORB service started successfully:", data);

    return {
      success: true,
      message: "ORB monitoring service started",
      timestamp: Date.now(),
      action: "start",
    };
  } catch (error) {
    console.error("Exception starting ORB service:", error);
    return {
      success: false,
      message: `Exception starting service: ${String(error)}`,
      timestamp: Date.now(),
    };
  }
}

/**
 * Calls the Flask API to stop the ORB monitoring service
 */
async function stopORBService(): Promise<ServiceResponse> {
  try {
    console.log("Calling Flask API to stop ORB service...");

    const response = await fetch(`${FLASK_API_BASE_URL}/tindex/orb/stop`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        triggered_by: "supabase_cron",
        timestamp: new Date().toISOString(),
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Failed to stop ORB service: ${errorText}`);
      return {
        success: false,
        message: `Failed to stop service: ${errorText}`,
        timestamp: Date.now(),
      };
    }

    const data = await response.json();
    console.log("ORB service stopped successfully", data);

    return {
      success: true,
      message: "ORB monitoring service stopped",
      timestamp: Date.now(),
      action: "stop",
    };
  } catch (error) {
    console.error("Exception stopping ORB service:", error);
    return {
      success: false,
      message: `Exception stopping service: ${String(error)}`,
      timestamp: Date.now(),
    };
  }
}

/**
 * Gets the current status of the ORB service
 */
async function getORBServiceStatus(): Promise<ServiceResponse> {
  try {
    const response = await fetch(`${FLASK_API_BASE_URL}/tindex/orb/status`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      return {
        success: false,
        message: "Failed to get service status",
        timestamp: Date.now(),
      };
    }

    const data = await response.json();

    return {
      success: true,
      message: "Service status retrieved",
      timestamp: Date.now(),
      action: "status",
      service_status: data,
    };
  } catch (error) {
    console.error("Exception getting service status:", error);
    return {
      success: false,
      message: `Exception getting status: ${String(error)}`,
      timestamp: Date.now(),
    };
  }
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
  console.log("=== ORB Service Manager Triggered ===");
  console.log(`Timestamp: ${new Date().toISOString()}`);

  try {
    // Check if this is a manual trigger or scheduled
    const url = new URL(req.url);
    const forceAction = url.searchParams.get("action"); // "start", "stop", or "status"

    let result: ServiceResponse;

    if (forceAction) {
      // Manual trigger with specific action
      console.log(`Manual action requested: ${forceAction}`);

      switch (forceAction) {
        case "start":
          result = await startORBService();
          break;
        case "stop":
          result = await stopORBService();
          break;
        case "status":
          result = await getORBServiceStatus();
          break;
        default:
          result = {
            success: false,
            message: `Invalid action: ${forceAction}`,
            timestamp: Date.now(),
          };
      }
    } else {
      // Automatic determination based on time
      const action = determineAction();

      console.log(`Determined action based on time: ${action}`);
      console.log(`Market hours check: ${isMarketHours()}`);

      switch (action) {
        case "start":
          result = await startORBService();
          break;
        case "stop":
          result = await stopORBService();
          break;
        case "none": {
          // Get status to verify current state
          const status = await getORBServiceStatus();
          result = {
            success: true,
            message: "No action needed at this time",
            timestamp: Date.now(),
            service_status: status.service_status,
          };
          break;
        }
        default:
          result = {
            success: true,
            message: "No action determined",
            timestamp: Date.now(),
          };
      }
    }

    const duration = Date.now() - startTime;
    console.log(`=== ORB Service Manager Completed in ${duration}ms ===`);

    return new Response(
      JSON.stringify({
        ...result,
        duration,
        market_hours: isMarketHours(),
        et_time: new Date().toLocaleString("en-US", {
          timeZone: "America/New_York",
        }),
      }),
      {
        status: result.success ? 200 : 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Fatal error in ORB service manager:", error);

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

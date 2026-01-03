// supabase/functions/orb-service-manager/index.ts

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

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

function isMarketHours(): boolean {
  const now = new Date();
  const etTime = new Date(
    now.toLocaleString("en-US", { timeZone: "America/New_York" })
  );

  const day = etTime.getDay();
  const hours = etTime.getHours();
  const minutes = etTime.getMinutes();

  if (day === 0 || day === 6) return false;

  const currentMinutes = hours * 60 + minutes;
  const marketOpen = 9 * 60 + 30;
  const marketClose = 16 * 60;

  return currentMinutes >= marketOpen && currentMinutes <= marketClose;
}

function determineAction(): "start" | "stop" | "none" {
  const now = new Date();
  const etTime = new Date(
    now.toLocaleString("en-US", { timeZone: "America/New_York" })
  );

  const day = etTime.getDay();
  const hours = etTime.getHours();
  const minutes = etTime.getMinutes();
  const currentMinutes = hours * 60 + minutes;

  if (day === 0 || day === 6) return "none";

  const serviceStart = 9 * 60 + 15;
  const serviceStop = 16 * 60 + 15;

  if (currentMinutes >= serviceStart && currentMinutes <= serviceStart + 2) {
    return "start";
  }

  if (currentMinutes >= serviceStop && currentMinutes <= serviceStop + 2) {
    return "stop";
  }

  return "none";
}

async function startORBService(): Promise<ServiceResponse> {
  console.log("[startORBService] Invoked");
  try {
    const response = await fetch(`${FLASK_API_BASE_URL}/tindex/orb/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        triggered_by: "supabase_cron",
        timestamp: new Date().toISOString(),
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.log("[startORBService] FAILED:", errorText);
      return {
        success: false,
        message: `Failed to start service: ${errorText}`,
        timestamp: Date.now(),
      };
    }

    console.log("[startORBService] SUCCESS");
    return {
      success: true,
      message: "ORB monitoring service started",
      timestamp: Date.now(),
      action: "start",
    };
  } catch (error) {
    console.log("[startORBService] EXCEPTION:", String(error));
    return {
      success: false,
      message: `Exception starting service: ${String(error)}`,
      timestamp: Date.now(),
    };
  }
}

async function stopORBService(): Promise<ServiceResponse> {
  console.log("[stopORBService] Invoked");
  try {
    const response = await fetch(`${FLASK_API_BASE_URL}/tindex/orb/stop`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        triggered_by: "supabase_cron",
        timestamp: new Date().toISOString(),
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.log("[stopORBService] FAILED:", errorText);
      return {
        success: false,
        message: `Failed to stop service: ${errorText}`,
        timestamp: Date.now(),
      };
    }

    console.log("[stopORBService] SUCCESS");
    return {
      success: true,
      message: "ORB monitoring service stopped",
      timestamp: Date.now(),
      action: "stop",
    };
  } catch (error) {
    console.log("[stopORBService] EXCEPTION:", String(error));
    return {
      success: false,
      message: `Exception stopping service: ${String(error)}`,
      timestamp: Date.now(),
    };
  }
}

async function getORBServiceStatus(): Promise<ServiceResponse> {
  console.log("[getORBServiceStatus] Invoked");
  try {
    const response = await fetch(`${FLASK_API_BASE_URL}/tindex/orb/status`, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });

    if (!response.ok) {
      console.log("[getORBServiceStatus] FAILED");
      return {
        success: false,
        message: "Failed to get service status",
        timestamp: Date.now(),
      };
    }

    const data = await response.json();
    console.log("[getORBServiceStatus] SUCCESS");
    return {
      success: true,
      message: "Service status retrieved",
      timestamp: Date.now(),
      action: "status",
      service_status: data,
    };
  } catch (error) {
    console.log("[getORBServiceStatus] EXCEPTION:", String(error));
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
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const startTime = Date.now();
  console.log("[MAIN] ORB Service Manager triggered");

  try {
    const url = new URL(req.url);
    const forceAction = url.searchParams.get("action");

    let result: ServiceResponse;

    if (forceAction) {
      console.log(`[MAIN] Manual action: ${forceAction}`);
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
      const action = determineAction();
      console.log(`[MAIN] Auto action: ${action}`);

      switch (action) {
        case "start":
          result = await startORBService();
          break;
        case "stop":
          result = await stopORBService();
          break;
        case "none": {
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
    console.log(`[MAIN] Completed in ${duration}ms - Success: ${result.success}`);

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
    console.log("[MAIN] FATAL ERROR:", String(error));
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
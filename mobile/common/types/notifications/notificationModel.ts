export interface Notification {
  id: string;
  user_id: string;
  title: string;
  body: string;
  type: string;
  data: {
    screen: string;
    watchlistType?: string;
    subscribedWatchlists?: string[];
    sentAt: string;
    ticker?: string;
    // ORB breakout notification data
    type?: "orb_breakout" | "orb_breakout_confirmed" | "orb_breakout_invalidated";
    breakout_type?: "above" | "below";
    price?: number;
    timestamp?: string;
    breakout_analysis?: {
      signal: "BULLISH" | "BEARISH";
      score: number;
      confidence: "HIGH" | "MEDIUM" | "LOW";
      reasons: string[];
      rvol: number;
      vwap_aligned: boolean;
      entry_price: number;
      stop_loss: number;
      risk_per_share: number;
    };
    orb_high?: number;
    orb_low?: number;
    confidence?: "HIGH" | "MEDIUM" | "LOW";
    score?: number;
    reasons?: string[];
    entry_price?: number;
    stop_loss?: number;
    risk_per_share?: number;
    rvol?: number;
    vwap_aligned?: boolean;
    // Gap & prior-day trend context (ORB notification payload)
    gap_percent?: number | null;
    gap_points?: number | null;
    gap_direction?: "up" | "down" | "flat" | null;
    prior_day_trend?: "bullish" | "bearish" | "flat" | null;
    trend_continuation?: boolean | null;
    breakout_aligns_gap?: boolean | null;
  };
  is_read: boolean;
  read_at: string | null;
  created_at: string;
  expires_at: string | null;
}
export type NotificationRecord = Notification;
export interface NotificationPreferences {
  enabled: boolean;
  sound: boolean;
  badge: boolean;
  feed_updates: boolean;
  messages: boolean;
  mentions: boolean;
  orb_alerts: boolean
//   market_news: boolean;
//   price_alerts: boolean;
//   daily_summary: boolean;
//   portfolio_updates: boolean;
}

export interface NotificationData {
  title: string;
  body: string;
  data?: Record<string, any>;
  sound?: boolean;
  badge?: number;
}

export interface ScheduledNotificationOptions extends NotificationData {
  triggerDate?: Date;
  seconds?: number;
  repeats?: boolean;
}



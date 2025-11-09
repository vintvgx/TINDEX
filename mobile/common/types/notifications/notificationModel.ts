export interface Notification {
  id: string;
  user_id: string;
  title: string;
  body: string;
  type: string;
  data: {
    screen: string;
    watchlistType: string;
    subscribedWatchlists: string[];
    sentAt: string;
    ticker?: string;
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




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

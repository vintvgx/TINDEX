
export interface FollowTickerORB {
    id: string;
    user_id: string;
    ticker: string;
    orb_enabled: boolean;
    notification_enabled: boolean;
    /** Per-type push toggles — gate BREAKOUT CONFIRMED / REVERSAL DETECTED independently per followed ticker. */
    notify_confirmed_breakout: boolean;
    notify_reversal: boolean;
    created_at: string;
    updated_at: string;
}

-- Tracks which expiry-approaching reminder milestones ("week", "two_day",
-- "one_day") have already been pushed for an open trade, so the daily
-- expiry-reminder check (scheduler.check_expiry_reminders) never re-sends
-- the same milestone on a later run. Relevant to swing/LEAPS holds now that
-- immediate trades can target any expiration, not just 0DTE.
ALTER TABLE orb_trades
  ADD COLUMN IF NOT EXISTS expiry_reminders_sent JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Migration: Add price monitoring columns to tracked_options_contracts
-- Run in Supabase Dashboard → SQL Editor, or via `supabase db push`

BEGIN;

ALTER TABLE public.tracked_options_contracts
  ADD COLUMN IF NOT EXISTS tracked_entry_price  NUMERIC(10, 4),
  ADD COLUMN IF NOT EXISTS current_price        NUMERIC(10, 4),
  ADD COLUMN IF NOT EXISTS price_change_pct     NUMERIC(8, 4),
  ADD COLUMN IF NOT EXISTS last_price_check_at  TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS notified_gain_25     BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS notified_loss_25     BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS notified_gain_50     BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS notified_loss_50     BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS notified_gain_100    BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS notified_loss_100    BOOLEAN NOT NULL DEFAULT FALSE;

-- Index to quickly find contracts due for a price check
CREATE INDEX IF NOT EXISTS idx_tracked_options_active_monitor
  ON public.tracked_options_contracts (status, tracked_entry_price)
  WHERE status = 'tracking' AND tracked_entry_price IS NOT NULL;

COMMIT;

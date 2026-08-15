-- Migration: Configurable price alerts for ENTERED (open position) contracts
-- Run in Supabase Dashboard → SQL Editor, or via `supabase db push`
--
-- Existing tracking-status alerts (notified_gain_25 etc., added in
-- 20250503_tracked_options_price_monitoring.sql) are untouched — they keep
-- using the global hardcoded THRESHOLDS constant. This adds a parallel,
-- per-contract-configurable set for entered (open position) contracts, with
-- its own latch flags so the two lifecycle phases can't suppress each
-- other's notifications, plus separate copy so the two are never confused
-- for one another.

BEGIN;

ALTER TABLE public.tracked_options_contracts
  -- Null = use the default (25 / 50 / 100). Non-null overrides that tier's
  -- magnitude. Sign is implied by the column (gain columns are positive,
  -- loss columns negative) — same convention as the existing THRESHOLDS list.
  ADD COLUMN IF NOT EXISTS alert_gain_25             NUMERIC(6, 2),
  ADD COLUMN IF NOT EXISTS alert_gain_50             NUMERIC(6, 2),
  ADD COLUMN IF NOT EXISTS alert_gain_100            NUMERIC(6, 2),
  ADD COLUMN IF NOT EXISTS alert_loss_25             NUMERIC(6, 2),
  ADD COLUMN IF NOT EXISTS alert_loss_50             NUMERIC(6, 2),
  ADD COLUMN IF NOT EXISTS alert_loss_100            NUMERIC(6, 2),
  -- Separate latch flags from notified_gain_25/etc so entering a contract
  -- that was already latched while merely "tracking" doesn't suppress its
  -- first entered-phase alert, and vice versa.
  ADD COLUMN IF NOT EXISTS notified_entered_gain_25  BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS notified_entered_loss_25  BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS notified_entered_gain_50  BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS notified_entered_loss_50  BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS notified_entered_gain_100 BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS notified_entered_loss_100 BOOLEAN NOT NULL DEFAULT FALSE;

-- Index to quickly find entered contracts due for a price check, mirroring
-- idx_tracked_options_active_monitor for the 'tracking' status.
CREATE INDEX IF NOT EXISTS idx_tracked_options_entered_monitor
  ON public.tracked_options_contracts (status, entry_price)
  WHERE status = 'entered' AND entry_price IS NOT NULL;

COMMIT;

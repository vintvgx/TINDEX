-- Migration: Add gap and prior-day trend columns to orb_ranges and orb_breakouts
-- Description: Enriches ORB breakout notifications with gap size and trend continuation context.
-- See: TDX-72 repeated reversal notification / gap and trend indicators.

BEGIN;

-- orb_ranges: store gap and prior-day trend alongside each day's ORB range
ALTER TABLE orb_ranges
  ADD COLUMN IF NOT EXISTS prior_close        DECIMAL(10, 2),
  ADD COLUMN IF NOT EXISTS today_open         DECIMAL(10, 2),
  ADD COLUMN IF NOT EXISTS gap_points         DECIMAL(10, 2),
  ADD COLUMN IF NOT EXISTS gap_percent        DECIMAL(6, 3),
  ADD COLUMN IF NOT EXISTS gap_direction      VARCHAR(10)
    CHECK (gap_direction IS NULL OR gap_direction IN ('up', 'down', 'flat')),
  ADD COLUMN IF NOT EXISTS prior_day_open    DECIMAL(10, 2),
  ADD COLUMN IF NOT EXISTS prior_day_trend    VARCHAR(10)
    CHECK (prior_day_trend IS NULL OR prior_day_trend IN ('bullish', 'bearish', 'flat')),
  ADD COLUMN IF NOT EXISTS trend_continuation BOOLEAN;

-- orb_breakouts: store context on breakout event for notification payload
ALTER TABLE orb_breakouts
  ADD COLUMN IF NOT EXISTS gap_percent        DECIMAL(6, 3),
  ADD COLUMN IF NOT EXISTS gap_direction      VARCHAR(10),
  ADD COLUMN IF NOT EXISTS prior_day_trend    VARCHAR(10),
  ADD COLUMN IF NOT EXISTS trend_continuation BOOLEAN,
  ADD COLUMN IF NOT EXISTS breakout_aligns_gap BOOLEAN;

COMMIT;

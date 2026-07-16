-- Captures what's needed to fully reconstruct exit-management state for an
-- open position after a process restart (see
-- docs/incidents/2026-07-14-position-lost-on-restart.md).
--
-- Previously only `profile` (a named profile key) was stored — enough to
-- rebuild a position's stop/TP levels for the *default* thresholds of that
-- profile, but not for a trade entered with a custom/manual override
-- (e.g. a hand-picked stop-loss %). Storing the exact computed levels at
-- entry time means recovery is exact regardless of how they were derived.
ALTER TABLE orb_trades
  ADD COLUMN IF NOT EXISTS exit_overrides   JSONB,
  ADD COLUMN IF NOT EXISTS hard_stop_price  NUMERIC(10, 4),
  ADD COLUMN IF NOT EXISTS tp1_price        NUMERIC(10, 4),
  ADD COLUMN IF NOT EXISTS tp2_price        NUMERIC(10, 4);

-- Fast lookup for "what's currently open" — the exact query position recovery
-- runs at every boot.
CREATE INDEX IF NOT EXISTS idx_orb_trades_open
  ON orb_trades (ticker, paper_mode)
  WHERE exit_time IS NULL;

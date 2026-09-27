-- Explicitly links a paper strategy config with its live counterpart (or
-- vice versa) — e.g. two separate "IWM Trend Rider" configs, one per_mode.
-- Symmetric: both rows point at each other (kept in sync by the mobile-
-- facing update route, not a DB trigger). Used by ORBEngine._find_ticker_conflict
-- to recognize that a paper/live pair entering "the same" signal is
-- intentional mirroring, not accidental duplicate exposure — previously this
-- forced an unnecessary confirmation-pause on whichever leg signaled second,
-- and the delay before the user approved it is exactly what let price drift
-- against the live fill (2026-07-27 IWM TREND_RIDER incident).
--
-- ON DELETE SET NULL (not CASCADE, not a blocking FK) — deleting one side of
-- a pair should just unlink it, never block the delete or cascade-delete the
-- sibling. Mirrors the existing FK-removal precedent in
-- 20260615_strategy_configs_missing_columns.sql, which stripped inbound FKs
-- from other tables for the same reason (delete-blocking).
ALTER TABLE strategy_configs
    ADD COLUMN IF NOT EXISTS paired_strategy_id uuid REFERENCES strategy_configs(id) ON DELETE SET NULL;

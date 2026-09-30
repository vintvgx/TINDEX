-- Migration: watched_price_levels.zone_type ('trade' | 'investment')
-- Description: A level is either a short-term TRADE setup (the original
-- behavior: on confirmation, score short-dated contracts and push "Key Level
-- Confirmed") or a long-term INVESTMENT buy zone (on confirmation, score
-- long-dated LEAPS-style calls and push "investment buy zone" instead) —
-- see api/services/strategy/key_level_watcher.py. Existing rows default to
-- 'trade', which is how they already behave.

BEGIN;

ALTER TABLE watched_price_levels
  ADD COLUMN IF NOT EXISTS zone_type TEXT NOT NULL DEFAULT 'trade';

ALTER TABLE watched_price_levels DROP CONSTRAINT IF EXISTS watched_price_levels_zone_type_check;
ALTER TABLE watched_price_levels ADD CONSTRAINT watched_price_levels_zone_type_check
  CHECK (zone_type IN ('trade', 'investment'));

COMMIT;

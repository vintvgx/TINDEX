-- Migration: allow watched_price_levels.direction = 'either'
-- Description: A level drawn from a two-sided technical setup (e.g. "holds
-- $350 = bullish to $380/$400, breaks $350 = bearish to the gap fills below")
-- previously had to be forced into a single bullish/bearish watch, missing
-- whichever side didn't get picked. 'either' watches BOTH sides — a bar close
-- above level_high OR below level_low confirms it, whichever happens first —
-- see api/services/strategy/key_level_watcher.py. Once confirmed, the row's
-- `direction` is overwritten with whichever side actually triggered
-- ('bullish' or 'bearish'), so a confirmed row is never left as 'either'.

BEGIN;

ALTER TABLE watched_price_levels DROP CONSTRAINT IF EXISTS watched_price_levels_direction_check;
ALTER TABLE watched_price_levels ADD CONSTRAINT watched_price_levels_direction_check
  CHECK (direction IN ('bullish', 'bearish', 'either'));

COMMIT;

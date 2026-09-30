-- Migration: per-strategy technicals gate
-- Description: Which pre-entry technicals (trend / trend_intraday / rsi /
-- vwap / orb / sector) must ALL match before an automated ORB strategy
-- enters — e.g. Trend Rider requiring trend + rsi + vwap + orb, Reversal
-- only vwap. Shape:
--   {"enabled": true, "required": ["vwap"]}
-- NULL = no gate (the pre-existing behavior). Evaluated in
-- ORBEngine._check_technicals_gate via entry_check_service.evaluate_gate.

ALTER TABLE strategy_configs
  ADD COLUMN IF NOT EXISTS technicals_gate JSONB;

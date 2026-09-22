-- Migration: Create contract_price_alerts table
-- Description: User-defined "notify me when THIS CONTRACT's price hits $X"
-- alerts, set from an open position's PositionInfoModal. Deliberately
-- separate from watched_price_levels (which watches the UNDERLYING ticker's
-- 1-minute bars via KeyLevelWatcher) — a contract's price doesn't flow
-- through that feed. Instead these are checked live, tick-by-tick, against
-- the same current_option_price ExitManager already evaluates SL/TP against
-- for an open position — see ExitManager.check_price_alerts() and
-- ORBEngine._process_tick(). strategy_id is TEXT, not a FK: it's either a
-- saved strategy's UUID or an ad-hoc immediate-trade engine's synthetic
-- "TICKER-paper"/"TICKER-live" id (see strategy_routes.py's _resolve_any_engine).

BEGIN;

CREATE TABLE IF NOT EXISTS contract_price_alerts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  strategy_id TEXT NOT NULL,
  ticker TEXT NOT NULL,
  contract_symbol TEXT NOT NULL,

  target_price DECIMAL(10, 2) NOT NULL CHECK (target_price > 0),
  -- Computed at creation time from the contract's live price at that
  -- moment: 'above' if target_price >= current price, else 'below' — same
  -- convention PositionInfoModal already used for the ticker-level version.
  direction TEXT NOT NULL CHECK (direction IN ('above', 'below')),

  status TEXT NOT NULL DEFAULT 'watching' CHECK (status IN (
    'watching',   -- price hasn't hit the target yet
    'triggered',  -- contract price crossed the target; notification sent
    'cancelled'   -- user removed it
  )),
  triggered_at TIMESTAMPTZ,
  triggered_price DECIMAL(10, 2),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contract_price_alerts_strategy_status ON contract_price_alerts(strategy_id, status);
CREATE INDEX IF NOT EXISTS idx_contract_price_alerts_user ON contract_price_alerts(user_id);

ALTER TABLE contract_price_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own contract price alerts" ON contract_price_alerts
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own contract price alerts" ON contract_price_alerts
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own contract price alerts" ON contract_price_alerts
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own contract price alerts" ON contract_price_alerts
  FOR DELETE USING (auth.uid() = user_id);

COMMIT;

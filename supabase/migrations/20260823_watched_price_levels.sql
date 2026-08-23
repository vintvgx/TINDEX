-- Migration: Create watched_price_levels table
-- Description: User-defined key price levels (self-identified or confirmed by a
-- Discord flow-alert admin) that get watched against live 1-minute bars. Once a
-- bar closes through the level, the level is "confirmed" and scored contract
-- suggestions are attached. Decoupled from the ORB opening-range-breakout
-- strategy, but reuses the same live-bar feed (OrbDataHub) — see
-- api/services/strategy/key_level_watcher.py.

BEGIN;

CREATE TABLE IF NOT EXISTS watched_price_levels (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  ticker TEXT NOT NULL,

  -- A single called-out price is level_low == level_high; a flow "zone"
  -- (e.g. $550-$557.50) uses both bounds. Direction confirms on a 1-minute
  -- bar closing above level_high (bullish) or below level_low (bearish).
  level_low DECIMAL(10, 2) NOT NULL,
  level_high DECIMAL(10, 2) NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('bullish', 'bearish')),

  source TEXT NOT NULL DEFAULT 'self' CHECK (source IN ('self', 'discord_admin')),
  notes TEXT,                              -- pasted flow-report text / context
  named_contracts JSONB NOT NULL DEFAULT '[]',  -- [{option_type, strike, expiration_date}]

  status TEXT NOT NULL DEFAULT 'watching' CHECK (status IN (
    'watching',   -- price hasn't confirmed the level yet
    'confirmed',  -- a bar closed through the level; suggestions attached
    'expired',    -- never confirmed, aged out
    'cancelled'   -- user removed it
  )),
  confirmed_at TIMESTAMPTZ,
  confirmed_price DECIMAL(10, 2),
  suggested_contracts JSONB,               -- [{contract, score, signal, reasoning, pinned}]

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT valid_level_range CHECK (level_high >= level_low)
);

CREATE INDEX IF NOT EXISTS idx_watched_price_levels_user_status ON watched_price_levels(user_id, status);
CREATE INDEX IF NOT EXISTS idx_watched_price_levels_ticker_status ON watched_price_levels(ticker, status);

ALTER TABLE watched_price_levels ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own price levels" ON watched_price_levels
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own price levels" ON watched_price_levels
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own price levels" ON watched_price_levels
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own price levels" ON watched_price_levels
  FOR DELETE USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION update_watched_price_levels_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_watched_price_levels_updated_at ON watched_price_levels;
CREATE TRIGGER update_watched_price_levels_updated_at
  BEFORE UPDATE ON watched_price_levels
  FOR EACH ROW
  EXECUTE FUNCTION update_watched_price_levels_updated_at();

COMMIT;

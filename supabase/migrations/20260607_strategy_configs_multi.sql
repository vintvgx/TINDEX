-- Multi-strategy support: replaces the single-row strategy_config table
-- with a multi-row strategy_configs table (one row per engine instance).

CREATE TABLE IF NOT EXISTS strategy_configs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_name  TEXT NOT NULL DEFAULT '',
  ticker         TEXT NOT NULL DEFAULT 'IWM',
  orb_minutes    INTEGER NOT NULL DEFAULT 10,
  paper_mode     BOOLEAN NOT NULL DEFAULT TRUE,
  active         BOOLEAN NOT NULL DEFAULT TRUE,
  profile        TEXT NOT NULL DEFAULT 'THUNDER_CAT',
  trade_days     INTEGER[] NOT NULL DEFAULT '{0,2,4}',
  capital_limit  FLOAT,          -- NULL = use full buying_power
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);

-- Migrate the existing single config row (if present) into the new table.
INSERT INTO strategy_configs (
  strategy_name, ticker, orb_minutes, paper_mode, active, profile, trade_days, created_at, updated_at
)
SELECT
  '' AS strategy_name,
  ticker,
  orb_minutes,
  paper_mode,
  active,
  profile,
  trade_days,
  NOW(),
  updated_at
FROM strategy_config
WHERE id = 1
ON CONFLICT DO NOTHING;

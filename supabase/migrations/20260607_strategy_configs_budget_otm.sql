-- Add Budget OTM Mode fields to strategy_configs
ALTER TABLE strategy_configs
  ADD COLUMN IF NOT EXISTS budget_otm_mode BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS otm_fib_level   TEXT    NOT NULL DEFAULT '1.0';

-- Add bypass_breakout_window flag and custom_thresholds JSONB to strategy_configs
ALTER TABLE strategy_configs
  ADD COLUMN IF NOT EXISTS bypass_breakout_window BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS custom_thresholds      JSONB;

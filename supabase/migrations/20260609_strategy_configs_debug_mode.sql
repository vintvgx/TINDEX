-- Add per-strategy debug_mode flag to strategy_configs.
-- When on, the engine emits a color-coded debug log (surfaced in the app's
-- Trade Log & Stats → Debug tab) covering all ORB strategy decision points.
ALTER TABLE strategy_configs
  ADD COLUMN IF NOT EXISTS debug_mode BOOLEAN NOT NULL DEFAULT FALSE;

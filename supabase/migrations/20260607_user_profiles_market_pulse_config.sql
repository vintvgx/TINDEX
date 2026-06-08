-- Add market_pulse_config to user_profiles so the Market Pulse strip
-- configuration is persisted per user account rather than device-local only.
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS market_pulse_config JSONB;

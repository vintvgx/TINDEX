-- Migration: Create tracked_options_contracts table
-- Description: Core table for storing user-tracked options contracts with full lifecycle tracking

BEGIN;

-- Create tracked_options_contracts table
CREATE TABLE IF NOT EXISTS tracked_options_contracts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Contract Identification (Unique per user+contract)
  ticker TEXT NOT NULL,
  contract_symbol TEXT NOT NULL,  -- e.g., "AAPL231215C00150000"
  option_type TEXT NOT NULL CHECK (option_type IN ('CALL', 'PUT')),
  strike DECIMAL(10, 2) NOT NULL,
  expiration_date DATE NOT NULL,
  
  -- Contract Snapshot (at tracking time)
  tracking_snapshot JSONB NOT NULL,  -- Full OptionsOpportunity object
  
  -- Lifecycle States
  status TEXT NOT NULL DEFAULT 'tracking' CHECK (status IN (
    'tracking',      -- User tracking but not entered
    'entered',       -- User entered the position
    'exited',        -- User exited the position
    'expired',       -- Contract expired without entry
    'cancelled'      -- User stopped tracking
  )),
  
  -- Entry/Exit Details
  entry_price DECIMAL(10, 4),       -- Price paid when entered
  entry_date TIMESTAMPTZ,           -- When user entered
  exit_price DECIMAL(10, 4),        -- Price received when exited
  exit_date TIMESTAMPTZ,            -- When user exited
  position_size INTEGER,            -- Number of contracts
  
  -- Performance Metrics (calculated)
  pnl DECIMAL(12, 2),               -- Profit/Loss in dollars
  pnl_percentage DECIMAL(8, 4),     -- PnL as percentage of entry cost
  max_profit DECIMAL(12, 2),        -- Maximum profit reached
  max_loss DECIMAL(12, 2),          -- Maximum loss reached
  held_duration_days INTEGER,       -- Days held if exited
  
  -- Context & Metadata
  tracked_from_source TEXT,         -- 'orb_breakout', 'manual', 'followed_stock'
  orb_breakout_id UUID,             -- Link to orb_monitoring_state if applicable
  initial_analysis_score DECIMAL(5, 2),  -- Score from OptionsAnalyzer
  tracking_reason TEXT,             -- User's reason for tracking (optional)
  
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Constraints
  UNIQUE(user_id, contract_symbol),
  CONSTRAINT valid_expiration CHECK (expiration_date > created_at::date)
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_tracked_options_user_status ON tracked_options_contracts(user_id, status);
CREATE INDEX IF NOT EXISTS idx_tracked_options_ticker ON tracked_options_contracts(ticker);
CREATE INDEX IF NOT EXISTS idx_tracked_options_expiration ON tracked_options_contracts(expiration_date);
CREATE INDEX IF NOT EXISTS idx_tracked_options_created ON tracked_options_contracts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tracked_options_orb_link ON tracked_options_contracts(orb_breakout_id) WHERE orb_breakout_id IS NOT NULL;

-- Enable Row Level Security
ALTER TABLE tracked_options_contracts ENABLE ROW LEVEL SECURITY;

-- RLS Policies (users can only see their own data)
CREATE POLICY "Users can view own contracts" ON tracked_options_contracts
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own contracts" ON tracked_options_contracts
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own contracts" ON tracked_options_contracts
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own contracts" ON tracked_options_contracts
  FOR DELETE USING (auth.uid() = user_id);

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_tracked_options_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to automatically update updated_at
DROP TRIGGER IF EXISTS update_tracked_options_updated_at ON tracked_options_contracts;
CREATE TRIGGER update_tracked_options_updated_at
  BEFORE UPDATE ON tracked_options_contracts
  FOR EACH ROW
  EXECUTE FUNCTION update_tracked_options_updated_at();

COMMIT;

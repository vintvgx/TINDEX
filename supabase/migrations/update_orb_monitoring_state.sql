-- Migration: Update orb_monitoring_state table to be a one-stop shop for ticker monitoring data
-- This consolidates data from orb_ranges and orb_breakouts into a single table for frontend display

-- Add new columns to orb_monitoring_state
ALTER TABLE orb_monitoring_state
ADD COLUMN IF NOT EXISTS opening_price NUMERIC(10, 2),
ADD COLUMN IF NOT EXISTS orb_high NUMERIC(10, 2),
ADD COLUMN IF NOT EXISTS orb_low NUMERIC(10, 2),
ADD COLUMN IF NOT EXISTS current_price NUMERIC(10, 2),
ADD COLUMN IF NOT EXISTS breakout_type TEXT DEFAULT 'none' CHECK (breakout_type IN ('none', 'invalidated', 'Bullish', 'Bearish', 'Confirmed Bullish', 'Confirmed Bearish')),
ADD COLUMN IF NOT EXISTS breakout_price NUMERIC(10, 2),
ADD COLUMN IF NOT EXISTS volume BIGINT,
ADD COLUMN IF NOT EXISTS tracking TEXT;

-- Rename last_price to current_price if it exists and current_price doesn't have data
-- This is a safe migration that preserves existing data
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'orb_monitoring_state' 
        AND column_name = 'last_price'
        AND NOT EXISTS (
            SELECT 1 
            FROM information_schema.columns 
            WHERE table_name = 'orb_monitoring_state' 
            AND column_name = 'current_price'
        )
    ) THEN
        ALTER TABLE orb_monitoring_state RENAME COLUMN last_price TO current_price;
    ELSIF EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'orb_monitoring_state' 
        AND column_name = 'last_price'
    ) THEN
        -- Copy last_price to current_price where current_price is NULL
        UPDATE orb_monitoring_state 
        SET current_price = last_price 
        WHERE current_price IS NULL AND last_price IS NOT NULL;
        
        -- Optionally drop last_price after migration (commented out for safety)
        -- ALTER TABLE orb_monitoring_state DROP COLUMN last_price;
    END IF;
END $$;

-- Create index for efficient queries by ticker and trade_date
CREATE INDEX IF NOT EXISTS idx_orb_monitoring_state_ticker_date 
ON orb_monitoring_state(ticker, trade_date);

-- Create index for breakout_type queries
CREATE INDEX IF NOT EXISTS idx_orb_monitoring_state_breakout_type 
ON orb_monitoring_state(breakout_type) 
WHERE breakout_type != 'none';

-- Update existing records to set default breakout_type if NULL
UPDATE orb_monitoring_state 
SET breakout_type = 'none' 
WHERE breakout_type IS NULL;

-- Set breakout_price to NULL where breakout_type is 'none'
UPDATE orb_monitoring_state 
SET breakout_price = NULL 
WHERE breakout_type = 'none';

-- Add comment to table for documentation
COMMENT ON TABLE orb_monitoring_state IS 'One-stop shop table for ORB ticker monitoring state. Contains all data needed for frontend display: opening price, ORB levels, current price, breakout status, volume, and tracking.';

-- Add comments to key columns
COMMENT ON COLUMN orb_monitoring_state.opening_price IS 'Opening price at market open (9:30 AM ET)';
COMMENT ON COLUMN orb_monitoring_state.orb_high IS 'ORB high level (calculated from 9:30-9:45 AM ET)';
COMMENT ON COLUMN orb_monitoring_state.orb_low IS 'ORB low level (calculated from 9:30-9:45 AM ET)';
COMMENT ON COLUMN orb_monitoring_state.current_price IS 'Current/last known price of the ticker';
COMMENT ON COLUMN orb_monitoring_state.breakout_type IS 'Breakout status: none, invalidated, Bullish, Bearish, Confirmed Bullish, or Confirmed Bearish';
COMMENT ON COLUMN orb_monitoring_state.breakout_price IS 'Price at which breakout occurred (NULL when breakout_type is none)';
COMMENT ON COLUMN orb_monitoring_state.volume IS 'Volume in the ORB range (9:30-9:45 AM ET)';
COMMENT ON COLUMN orb_monitoring_state.tracking IS 'Tracking status field for future use';


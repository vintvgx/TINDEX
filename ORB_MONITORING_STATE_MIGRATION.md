# ORB Monitoring State Table Migration

## Overview
This migration updates the `orb_monitoring_state` table to be a comprehensive one-stop shop for ticker monitoring data. The table now consolidates data from `orb_ranges` and `orb_breakouts` into a single source of truth for frontend display.

## SQL Migration

Run the following SQL in your Supabase SQL Editor:

```sql
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
COMMENT ON COLUMN orb_monitoring_state.breakout_type IS 'Breakout status: none, invalidated, Bullish, or Bearish';
COMMENT ON COLUMN orb_monitoring_state.breakout_price IS 'Price at which breakout occurred (NULL when breakout_type is none)';
COMMENT ON COLUMN orb_monitoring_state.volume IS 'Volume in the ORB range (9:30-9:45 AM ET)';
COMMENT ON COLUMN orb_monitoring_state.tracking IS 'Tracking status field for future use';
```

## Table Schema

The `orb_monitoring_state` table now includes the following fields for frontend display:

| Field | Type | Description | Default |
|-------|------|-------------|---------|
| `ticker` | TEXT | Stock ticker symbol | - |
| `trade_date` | DATE | Trading date | - |
| `opening_price` | NUMERIC(10, 2) | Opening price at market open (9:30 AM ET) | NULL |
| `orb_high` | NUMERIC(10, 2) | ORB high level (calculated from 9:30-9:45 AM ET) | NULL |
| `orb_low` | NUMERIC(10, 2) | ORB low level (calculated from 9:30-9:45 AM ET) | NULL |
| `current_price` | NUMERIC(10, 2) | Current/last known price of the ticker | NULL |
| `breakout_type` | TEXT | Breakout status: 'none', 'invalidated', 'Bullish', 'Bearish', 'Confirmed Bullish', or 'Confirmed Bearish' | 'none' |
| `breakout_price` | NUMERIC(10, 2) | Price at which breakout occurred (NULL when breakout_type is 'none') | NULL |
| `volume` | BIGINT | Volume in the ORB range (9:30-9:45 AM ET) | NULL |
| `tracking` | TEXT | Tracking status field for future use | NULL |
| `high_broken` | BOOLEAN | Whether the ORB high has been broken | FALSE |
| `low_broken` | BOOLEAN | Whether the ORB low has been broken | FALSE |
| `monitoring_active` | BOOLEAN | Whether monitoring is currently active | TRUE |

## Code Changes

### Python Service Updates

The following changes were made to `api/services/alpaca_service.py`:

1. **`save_orb_range()`** - Now populates all monitoring state fields when initializing:
   - `opening_price`, `orb_high`, `orb_low`, `volume` from ORB calculation
   - `current_price` initialized to `orb_high`
   - `breakout_type` set to `'none'`
   - `breakout_price` set to `NULL`

2. **`record_breakout()`** - Updates monitoring state with breakout information:
   - Sets `breakout_type` to `'Bullish'` (for "above") or `'Bearish'` (for "below")
   - Sets `breakout_price` to the breakout price
   - Updates `current_price` to the breakout price

3. **`_wait_for_confirmation()`** - Updates breakout status after confirmation timer:
   - If confirmed: Sets `breakout_type` to `'Confirmed Bullish'` or `'Confirmed Bearish'`, updates `current_price`
   - If invalidated: Sets `breakout_type` to `'invalidated'`, sets `breakout_price` to `NULL`, updates `current_price`

4. **`handle_bar()`** - Updates monitoring state in real-time:
   - **During calculation phase**: Updates `orb_high`, `orb_low`, `volume`, `opening_price`, and `current_price` with each bar
   - **During monitoring phase**: Updates `current_price` with each incoming bar's close price
   - This ensures real-time updates throughout all phases for frontend display

## Breakout Type Values

- **`'none'`**: No breakout has occurred yet
- **`'Bullish'`**: Breakout above ORB high detected (pending confirmation)
- **`'Bearish'`**: Breakout below ORB low detected (pending confirmation)
- **`'Confirmed Bullish'`**: Breakout above ORB high confirmed after 3-minute validation
- **`'Confirmed Bearish'`**: Breakout below ORB low confirmed after 3-minute validation
- **`'invalidated'`**: Breakout was detected but price returned inside ORB range

## Frontend Usage

The frontend can now query `orb_monitoring_state` to get all necessary data for displaying ticker monitoring status:

```sql
SELECT 
    ticker,
    opening_price,
    orb_high,
    orb_low,
    current_price,
    breakout_type,
    breakout_price,
    volume,
    tracking,
    trade_date,
    monitoring_active
FROM orb_monitoring_state
WHERE monitoring_active = true
    AND trade_date = CURRENT_DATE
ORDER BY ticker;
```

## Migration Notes

- The migration safely handles existing `last_price` columns by renaming or copying data
- Existing `orb_ranges` and `orb_breakouts` tables remain unchanged for backward compatibility
- All new columns are nullable to support existing data
- Indexes are created for efficient querying by ticker/date and breakout_type


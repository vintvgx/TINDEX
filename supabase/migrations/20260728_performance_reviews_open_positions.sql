-- Snapshot of still-open (swing/weekly) positions as of generation time,
-- alongside the existing trades_json snapshot of that day's closed trades.
-- Lets the mobile app show exactly what open positions a given day's review
-- assessed (and the live P&L/advice given for each) without re-deriving it.
ALTER TABLE performance_reviews
    ADD COLUMN IF NOT EXISTS open_positions_json jsonb;

-- Add paper_mode and trade_type columns to orb_trades so the Trade Log can
-- distinguish Live vs Paper trades and Strategy-auto vs Immediate-conviction trades.
ALTER TABLE orb_trades
  ADD COLUMN IF NOT EXISTS paper_mode  boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS trade_type  text    NOT NULL DEFAULT 'STRATEGY';

-- Index for Trade Log queries that filter by type or mode
CREATE INDEX IF NOT EXISTS orb_trades_trade_type_idx ON orb_trades (trade_type);
CREATE INDEX IF NOT EXISTS orb_trades_paper_mode_idx ON orb_trades (paper_mode);

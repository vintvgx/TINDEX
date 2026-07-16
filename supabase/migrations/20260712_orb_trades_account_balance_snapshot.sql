-- Snapshot the account's equity at trade entry and exit so the Trade Log can
-- show the real account-level impact of a trade, not just its own premium
-- math (pnl/pnl_pct). Nullable — only populated for trades logged going
-- forward; historical trades simply won't have this data.
ALTER TABLE orb_trades
  ADD COLUMN IF NOT EXISTS account_balance_before numeric,
  ADD COLUMN IF NOT EXISTS account_balance_after  numeric,
  ADD COLUMN IF NOT EXISTS account_balance_change  numeric;

-- Unified P&L (handoff spec 5, 2026-10-11) — cached realized P&L per
-- (mode, period), computed from orb_trades by services/strategy/pnl_summary.py.
-- Home's account card and the Trade Log both read GET
-- /strategy/accounts/pnl-summary, so they can't disagree. Unrealized P&L is
-- never stored here (always live). TradeLogger clears a mode's rows whenever a
-- trade (or a partial) closes; computed_at is a 5-minute TTL backstop.

BEGIN;

CREATE TABLE IF NOT EXISTS account_pnl_summary (
    mode            text        NOT NULL CHECK (mode IN ('live', 'paper')),
    period          text        NOT NULL CHECK (period IN ('today', 'week', 'month', 'ytd', 'all_time')),
    realized_gross  numeric     NOT NULL DEFAULT 0,
    fees            numeric     NOT NULL DEFAULT 0,
    realized_net    numeric     NOT NULL DEFAULT 0,
    trades_closed   integer     NOT NULL DEFAULT 0,
    max_exit_time   timestamptz,
    computed_at     timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (mode, period)
);

-- Phase 2: the trade logger writes actual fees from fill data; the summary
-- prefers this over the $0.70/contract/side estimate when it's set.
ALTER TABLE orb_trades ADD COLUMN IF NOT EXISTS fees numeric;

COMMIT;

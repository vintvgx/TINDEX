-- Manual 0DTE position entries from the watchlist.
-- Users pick a contract, select a profile, set qty — this tracks the result.

CREATE TABLE IF NOT EXISTS zero_dte_positions (
    id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           uuid        NOT NULL,
    watchlist_ref_id  uuid        REFERENCES zero_dte_watchlist(id) ON DELETE SET NULL,
    ticker            text        NOT NULL,
    contract_type     text        NOT NULL CHECK (contract_type IN ('call', 'put')),
    strike            numeric     NOT NULL,
    expiry            text        NOT NULL,
    qty               integer     NOT NULL,
    qty_remaining     integer     NOT NULL,
    entry_price       numeric     NOT NULL,
    strategy_profile  text        NOT NULL CHECK (strategy_profile IN ('SCALP', 'MOMENTUM', 'AGGRESSIVE')),
    stop_pct          numeric,
    stop_price        numeric,
    tp_ladder         jsonb,
    mode              text        NOT NULL DEFAULT 'paper' CHECK (mode IN ('paper', 'live')),
    status            text        NOT NULL DEFAULT 'open'
                                  CHECK (status IN ('open', 'closed', 'partially_closed', 'expired')),
    realized_pnl      numeric,
    closed_at         timestamptz,
    created_at        timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_zero_dte_positions_user_status
    ON zero_dte_positions (user_id, status);

CREATE INDEX IF NOT EXISTS idx_zero_dte_positions_user_created
    ON zero_dte_positions (user_id, created_at DESC);

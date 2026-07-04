-- 0DTE intraday options watchlist
-- Stores results from each scan window throughout the trading day.
-- Rows are purged after 7 days to keep the table lean.

CREATE TABLE IF NOT EXISTS zero_dte_watchlist (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    scan_date         date        NOT NULL,
    scan_time         timestamptz NOT NULL,
    ticker            text        NOT NULL,
    contract_type     text        NOT NULL CHECK (contract_type IN ('call', 'put')),
    strike            numeric     NOT NULL,
    expiry            text        NOT NULL,
    composite_score   numeric     NOT NULL,
    tier              text        NOT NULL CHECK (tier IN ('FIRE', 'SET', 'WATCH')),
    flow_score        numeric,
    intraday_score    numeric,
    dollar_flow       numeric,
    vol_oi            numeric,
    is_sweep          boolean     DEFAULT false,
    is_floor          boolean     DEFAULT false,
    uw_score          numeric,
    current_price     numeric,
    vwap              numeric,
    above_vwap        boolean,
    iv_pct            numeric,
    otm_pct           numeric,
    premium           numeric,
    minutes_remaining integer,
    created_at        timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_zero_dte_watchlist_date_score
    ON zero_dte_watchlist (scan_date, composite_score DESC);

CREATE INDEX IF NOT EXISTS idx_zero_dte_watchlist_scan_time
    ON zero_dte_watchlist (scan_date, scan_time);

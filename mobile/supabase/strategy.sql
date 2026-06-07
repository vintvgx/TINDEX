-- ORB Strategy Tables
-- Run in Supabase SQL editor

-- Strategy configuration (single row per installation, id=1)
CREATE TABLE IF NOT EXISTS strategy_config (
    id          SERIAL PRIMARY KEY,
    ticker      TEXT    NOT NULL DEFAULT 'SPY',
    orb_minutes INTEGER          DEFAULT 5,
    paper_mode  BOOLEAN          DEFAULT TRUE,
    active      BOOLEAN          DEFAULT TRUE,
    profile     TEXT    NOT NULL DEFAULT 'THUNDER_CAT',
    trade_days  INTEGER[]        DEFAULT '{0,2,4}',
    updated_at  TIMESTAMPTZ      DEFAULT NOW()
);

INSERT INTO strategy_config (id, ticker, orb_minutes, paper_mode, active, profile, trade_days)
VALUES (1, 'SPY', 5, TRUE, TRUE, 'THUNDER_CAT', '{0,2,4}')
ON CONFLICT (id) DO NOTHING;

-- Trade log: one row per partial/full exit event
CREATE TABLE IF NOT EXISTS orb_trades (
    id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    trade_date      DATE         NOT NULL,
    ticker          TEXT         NOT NULL,
    profile         TEXT         NOT NULL,
    direction       TEXT,
    contract_symbol TEXT,
    strike          FLOAT,
    expiry          DATE,
    entry_premium   FLOAT,
    exit_premium    FLOAT,
    qty_entered     INTEGER,
    qty_exited      INTEGER      DEFAULT 0,
    pnl             FLOAT,
    pnl_pct         FLOAT,
    entry_time      TIMESTAMPTZ,
    exit_time       TIMESTAMPTZ,
    exit_reason     TEXT,
    orh             FLOAT,
    orl             FLOAT,
    vix_at_entry    FLOAT,
    fib_targets     JSONB,
    flow_confirmed  BOOLEAN      DEFAULT FALSE,
    created_at      TIMESTAMPTZ  DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orb_trades_date    ON orb_trades (trade_date DESC);
CREATE INDEX IF NOT EXISTS idx_orb_trades_profile ON orb_trades (profile);
CREATE INDEX IF NOT EXISTS idx_orb_trades_ticker  ON orb_trades (ticker);

-- Daily session metadata
CREATE TABLE IF NOT EXISTS orb_session (
    id           SERIAL      PRIMARY KEY,
    session_date DATE        NOT NULL,
    strategy_id  TEXT,
    ticker       TEXT,
    profile      TEXT,
    orh          FLOAT,
    orl          FLOAT,
    orb_range    FLOAT,
    vix          FLOAT,
    sentiment    TEXT,
    trade_taken  BOOLEAN     DEFAULT FALSE,
    skip_reason  TEXT,
    created_at   TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (session_date, strategy_id)
);

CREATE INDEX IF NOT EXISTS idx_orb_session_date ON orb_session (session_date DESC);

-- Profile performance stats (refresh nightly or on demand)
CREATE MATERIALIZED VIEW IF NOT EXISTS profile_stats AS
SELECT
    profile,
    COUNT(*)                                                      AS total_trades,
    COUNT(*) FILTER (WHERE pnl > 0)                               AS wins,
    ROUND(COUNT(*) FILTER (WHERE pnl > 0)::NUMERIC / NULLIF(COUNT(*), 0) * 100, 1) AS win_rate_pct,
    ROUND(SUM(pnl)::NUMERIC, 2)                                   AS total_pnl,
    ROUND(AVG(pnl) FILTER (WHERE pnl > 0)::NUMERIC, 2)            AS avg_winner,
    ROUND(AVG(pnl) FILTER (WHERE pnl < 0)::NUMERIC, 2)            AS avg_loser,
    ROUND(AVG(pnl_pct)::NUMERIC, 1)                               AS avg_return_pct
FROM orb_trades
GROUP BY profile;

-- Refresh command (run nightly or after each trade):
-- REFRESH MATERIALIZED VIEW profile_stats;

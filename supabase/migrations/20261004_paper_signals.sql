-- Paper-testing loop (TODO 8 part 3).
--
-- paper_signals: one row per signal —
--   path A  morning-brief play that triggered (id "A-<date>-<ticker>")
--   path B  ORB strategy breakout entry      (id "B-<orb_trades.id>")
-- carrying the metadata the weekly review groups by (zone score, setup
-- score, gate factors), the setup levels, the fill, and — after the 16:15
-- resolve job — the setup outcome and the trade's P&L.
--
-- brief_config: the brief's thresholds as one JSON row (id = 1), tuned from
-- the review instead of edited in code (see services/brief/config.py).

BEGIN;

CREATE TABLE IF NOT EXISTS paper_signals (
    id               text PRIMARY KEY,
    signal_path      text        NOT NULL CHECK (signal_path IN ('A', 'B')),
    signal_date      date        NOT NULL,
    ticker           text        NOT NULL,
    direction        text        NOT NULL CHECK (direction IN ('CALL', 'PUT')),
    signal_at        timestamptz,
    signal_price     numeric,
    setup_score      numeric,                 -- path A only
    zone_score       numeric,                 -- trigger zone (A) / zone at the OR edge (B)
    gate_decision    text,
    gate_agree       int,
    gate_total       int,
    trigger          numeric     NOT NULL,
    target           numeric     NOT NULL,
    invalidation     numeric     NOT NULL,
    -- pending | filled | cancelled | scratch | skipped | expired | stood_down | error
    fill_status      text        NOT NULL,
    trade_id         text,                    -- orb_trades.id
    contract_symbol  text,
    qty              int,
    profile          text,
    entry_premium    numeric,
    paper_mode       boolean     NOT NULL DEFAULT true,
    -- target_hit | stopped | expired (setup outcome from the underlying)
    outcome          text,
    resolved_at      timestamptz,
    mfe_pct          numeric,
    mae_pct          numeric,
    pnl              numeric,
    pnl_pct          numeric,
    exit_time        timestamptz,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS paper_signals_date_idx ON paper_signals (signal_date DESC);
CREATE INDEX IF NOT EXISTS paper_signals_trade_idx ON paper_signals (trade_id);

CREATE TABLE IF NOT EXISTS brief_config (
    id          int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    settings    jsonb       NOT NULL DEFAULT '{}'::jsonb,
    updated_at  timestamptz NOT NULL DEFAULT now()
);

COMMIT;

-- 16:15 ET mon-fri: resolve today's signals (DST-dual, same as the brief).
do $$ begin perform cron.unschedule('paper_signals_resolve_edt'); exception when others then null; end $$;
do $$ begin perform cron.unschedule('paper_signals_resolve_est'); exception when others then null; end $$;
select cron.schedule('paper_signals_resolve_edt', '15 20 * * 1-5',
  $$select cron_fire_et_scheduled_job('https://alethia-test-eng.up.railway.app/brief/review/resolve', 16, 15);$$);
select cron.schedule('paper_signals_resolve_est', '15 21 * * 1-5',
  $$select cron_fire_et_scheduled_job('https://alethia-test-eng.up.railway.app/brief/review/resolve', 16, 15);$$);

-- Gate block → wait-and-monitor (TODO 073d0d9f, 2026-10-27). When a
-- strategy's technicals gate blocks a breakout and technicals_gate.watch is
-- on, the engine keeps the signal as a watch and re-checks the gate on each
-- 1-min close (services/strategy/gate_watch.py). One row per watch, persisted
-- so a backend restart restores it (ORBEngine.restore_gate_watch, after
-- calculate_orb) instead of silently dropping it.
--
-- status: watching | confirmed | expired | cancelled

CREATE TABLE IF NOT EXISTS orb_gate_watches (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    strategy_id     uuid        REFERENCES strategy_configs(id) ON DELETE CASCADE,
    ticker          text        NOT NULL,
    direction       text        NOT NULL CHECK (direction IN ('CALL', 'PUT')),
    trigger_price   numeric     NOT NULL,    -- underlying price at the blocked signal
    level           numeric,                 -- ORH (CALL) / ORL (PUT): closing back through it ends the watch
    gate_mode       text        NOT NULL DEFAULT 'daily',
    failed_factors  jsonb       NOT NULL DEFAULT '[]'::jsonb,
    summary         text,
    status          text        NOT NULL DEFAULT 'watching'
                                 CHECK (status IN ('watching', 'confirmed', 'expired', 'cancelled')),
    reason          text,                    -- why it ended
    expires_at      timestamptz NOT NULL,
    expiry_reason   text,                    -- which deadline expires_at is (2h / breakout window / end of day)
    created_at      timestamptz NOT NULL DEFAULT now(),
    resolved_at     timestamptz
);

CREATE INDEX IF NOT EXISTS idx_orb_gate_watches_status
    ON orb_gate_watches (status, expires_at);

CREATE INDEX IF NOT EXISTS idx_orb_gate_watches_strategy
    ON orb_gate_watches (strategy_id, created_at DESC);

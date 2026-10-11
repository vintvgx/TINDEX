-- Invest tab + Generate Thesis (handoff spec 6, 2026-10-11).
--
-- ticker_fundamentals: cache behind GET /ticker/<sym>/fundamentals
--   (services/ticker_brief/fundamentals.py) — metrics refresh every 6h,
--   revenue actuals + analyst estimates weekly.
--
-- thesis_requests / ticker_theses: queue + storage ONLY. The app queues a
--   request (POST /api/agent/thesis); Bandit's own job reads pending rows
--   (GET /muse/thesis/requests) and publishes the thesis it writes
--   (POST /muse/thesis/publish), which stores it here and pushes "Your NVDA
--   thesis is ready". There is no thesis generator in this backend.

BEGIN;

CREATE TABLE IF NOT EXISTS ticker_fundamentals (
    ticker              text PRIMARY KEY,
    metrics             jsonb,
    metrics_fetched_at  timestamptz,
    revenue             jsonb,
    revenue_fetched_at  timestamptz
);

CREATE TABLE IF NOT EXISTS thesis_requests (
    id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    ticker                    text        NOT NULL,
    user_id                   uuid        NOT NULL,
    status                    text        NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending', 'complete', 'failed')),
    created_at                timestamptz NOT NULL DEFAULT now(),
    completed_at              timestamptz,
    -- Snapshot for the "your thesis may be stale" nudge.
    price_at_request          numeric,
    next_earnings_at_request  date,
    error                     text
);
CREATE INDEX IF NOT EXISTS thesis_requests_pending_idx
    ON thesis_requests (created_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS thesis_requests_user_ticker_idx
    ON thesis_requests (user_id, ticker, created_at DESC);

-- Latest thesis per (user, ticker); a re-generate overwrites it.
CREATE TABLE IF NOT EXISTS ticker_theses (
    ticker                       text        NOT NULL,
    user_id                      uuid        NOT NULL,
    thesis                       jsonb       NOT NULL,
    status                       text        NOT NULL DEFAULT 'complete',
    generated_at                 timestamptz NOT NULL DEFAULT now(),
    request_id                   uuid REFERENCES thesis_requests (id) ON DELETE SET NULL,
    price_at_generation          numeric,
    next_earnings_at_generation  date,
    PRIMARY KEY (user_id, ticker)
);

COMMIT;

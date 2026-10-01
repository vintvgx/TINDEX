-- Migration: Create zone_events table
-- Description: System-generated log of StructureTracker events (BOS, zone
-- approach/break/failed-break) against ZoneEngine's live zones — see
-- api/services/strategy/structure_tracker.py. Purely server-generated (the
-- tracker writes these off live 1-minute bars, no user action creates one),
-- so this follows market_digests/performance_reviews's plain no-RLS,
-- single-tenant shape rather than watched_price_levels/contract_price_alerts's
-- user_id + RLS shape (those are created directly by a client action and can
-- be read/written by the mobile app's own Supabase client; zone_events is
-- read only through the Flask API, same as market_digests).
--
-- zone_id is NOT a foreign key — zones aren't DB rows with a stable
-- cross-day identity (ZoneEngine recomputes them fresh from live market
-- data on every call); it's the per-snapshot id StructureTracker assigns
-- for one session's bookkeeping (e.g. "support_0"), kept here as a plain
-- text tag so a chart or review screen can group this session's events by
-- which zone they belonged to without implying a permanent identity.

CREATE TABLE IF NOT EXISTS zone_events (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    ticker        TEXT NOT NULL,
    session_date  DATE NOT NULL,
    event_type    TEXT NOT NULL CHECK (event_type IN (
        'bos',            -- break of structure: a close beyond the last confirmed swing high/low
        'zone_approach',  -- live price within 0.15% of a zone boundary
        'zone_break',     -- a close through a zone boundary, volume-confirmed
        'failed_break'    -- price closed back inside the zone within 3 bars of a zone_break (bull/bear trap)
    )),
    direction     TEXT CHECK (direction IN ('bullish', 'bearish')),
    zone_id       TEXT,              -- per-snapshot id (see StructureTracker._all_zones), null for a plain BOS event
    level         DECIMAL(10, 4),    -- the swing high/low a BOS broke through
    close         DECIMAL(10, 4),
    volume        BIGINT,
    bar_ts        TIMESTAMPTZ,       -- the aggregated bar's start time this event fired on

    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_zone_events_ticker_date ON zone_events (ticker, session_date DESC);
CREATE INDEX IF NOT EXISTS idx_zone_events_type ON zone_events (event_type);

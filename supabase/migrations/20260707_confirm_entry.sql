-- Per-strategy "confirm before entering" gate. When enabled, the engine pauses
-- at the trade-entry chokepoint (after contract selection + stream verification,
-- before order submission), persists the candidate trade here, pushes a
-- notification, and waits for the user to approve or skip via the app instead
-- of auto-submitting the order.

ALTER TABLE strategy_configs
    ADD COLUMN IF NOT EXISTS confirm_entry boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS orb_pending_confirmations (
    id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    strategy_id           uuid        REFERENCES strategy_configs(id) ON DELETE CASCADE,
    ticker                text        NOT NULL,
    profile               text        NOT NULL,
    direction             text        NOT NULL CHECK (direction IN ('CALL', 'PUT')),
    contract_symbol       text        NOT NULL,
    strike                numeric     NOT NULL,
    qty                   integer     NOT NULL,
    trigger_price         numeric     NOT NULL,    -- underlying price at breakout/reversal confirmation
    entry_estimate        numeric     NOT NULL,    -- contract ask at pause time, basis for the SL/TP preview
    confidence            numeric     NOT NULL,    -- 0-100, technicals-based (breakout distance + VWAP + volume)
    confidence_breakdown  jsonb,
    effective_profile     jsonb       NOT NULL,    -- resolved profile dict (post custom_thresholds merge) used on approve
    hard_stop             numeric     NOT NULL,    -- default preview; overwritten by user-edited value on approve
    tp1                   numeric     NOT NULL,
    tp2                   numeric,
    status                text        NOT NULL DEFAULT 'PENDING'
                                       CHECK (status IN ('PENDING', 'APPROVED', 'SKIPPED', 'EXPIRED')),
    expires_at            timestamptz NOT NULL,
    created_at            timestamptz NOT NULL DEFAULT now(),
    resolved_at           timestamptz
);

CREATE INDEX IF NOT EXISTS idx_orb_pending_confirmations_status
    ON orb_pending_confirmations (status, expires_at);

CREATE INDEX IF NOT EXISTS idx_orb_pending_confirmations_strategy
    ON orb_pending_confirmations (strategy_id, created_at DESC);

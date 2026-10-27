-- Reversal watch (2026-10-27): orb_gate_watches holds two kinds of watch —
-- 'breakout' (a blocked TREND_RIDER/BREAK breakout) and 'reversal' (a blocked
-- REVERSAL signal, re-checked against the reversal scorer). Existing rows are
-- breakouts. The engine only sends `kind` for reversal rows, so breakout
-- watches keep persisting even before this migration is applied.

ALTER TABLE orb_gate_watches
    ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'breakout'
        CHECK (kind IN ('breakout', 'reversal'));

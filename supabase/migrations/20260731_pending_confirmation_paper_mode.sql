-- The pending-confirmation row never recorded the REQUESTING strategy's own
-- account mode — only conflict_context.paper_mode existed, which describes
-- the OTHER (conflicting) position, not the strategy asking for confirmation.
-- The push notification's own [PAPER]/[LIVE] tag was always correct (derived
-- separately from the live engine, never persisted), but the Dashboard
-- confirmation card had nothing to show for the strategy's own mode — the
-- only Paper/Live text visible was the conflict description, easy to misread
-- as if it were describing the strategy itself (2026-07-30: a PAPER
-- strategy's card showed "(Live)" from a conflicting LIVE position with no
-- indication the strategy itself was Paper).
ALTER TABLE orb_pending_confirmations
    ADD COLUMN IF NOT EXISTS paper_mode boolean NOT NULL DEFAULT true;

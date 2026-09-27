-- Cross-engine same-ticker/same-direction conflict gate.
--
-- Previously each ORBEngine only checked its own trade_taken state before
-- entering — with multiple profiles watching the same ticker, one engine
-- could auto-enter a same-direction position while another already had one
-- open (2026-07-24: IWM REVERSAL held an open CALL from 15:15-16:02 while
-- a separate TREND_RIDER engine auto-entered its own IWM CALL at 15:29,
-- fully automatically, no coordination between the two).
--
-- Entries that are paused specifically because of this conflict (as opposed
-- to the existing opt-in confirm_entry gate) carry this context so the
-- mobile confirmation modal can explain what's already open. NULL for
-- every existing/ordinary confirm_entry-triggered pause.
ALTER TABLE orb_pending_confirmations
    ADD COLUMN IF NOT EXISTS conflict_context jsonb;

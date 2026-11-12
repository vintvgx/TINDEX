-- Re-armed confirmation watches (confirm-first auto-enter, PR #124, R9
-- option A): a watch created by _rearm_gate_watch after an unanswered
-- MODERATE expiry must stay eligible for rechecks even when
-- technicals_gate.watch is off. The flag is set in memory at re-arm time and
-- persisted here so a backend restart restores it (restore_gate_watch reads
-- it); without the column the persist logs an error and the in-memory watch
-- still runs, but restart-restore of re-armed watches is lost.

ALTER TABLE orb_gate_watches
    ADD COLUMN IF NOT EXISTS auto_enter boolean NOT NULL DEFAULT false;

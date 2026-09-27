-- Persists the 3-minute breakout-confirmation hold's deadline, which
-- previously only lived in orb_service.py's in-memory _retest_state — the
-- mobile Dashboard's candidate breakout card needs this to render a live
-- countdown instead of a plain "still watching" indicator with no ETA.
-- Set at the same BROKEN transition that sets the in-memory confirm_deadline
-- (orb_service.py's _process_breakout_side); cleared on any exit from BROKEN
-- (confirmed, invalidated, or retested back inside the ORB range).

alter table orb_monitoring_state
    add column if not exists confirm_deadline timestamptz;

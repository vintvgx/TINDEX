-- Remove the ORB hub watchdog (added 20260709_orb_hub_watchdog_cron.sql).
--
-- Decision (2026-07-14): the automated force-restart was actively causing
-- harm, not preventing it. The service has a fixed, known operating window
-- (9:30-16:00 ET) and the user has manual visibility (the new admin status
-- screen, push notifications, banners) — an unattended process that force-
-- restarts a live trading connection every 2 minutes is a worse failure mode
-- than a human noticing and restarting deliberately, especially once
-- restarts were shown to be able to drop an open position's exit-management
-- state (see docs/incidents/2026-07-14-position-lost-on-restart.md).

do $$ begin perform cron.unschedule('orb_hub_watchdog'); exception when others then null; end $$;

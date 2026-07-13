-- Watchdog for the ORB data hub (see api/app.py boot-time auto-start and
-- api/routes/monitoring_routes.py restart_orb_if_unhealthy()).
--
-- Root cause of the 2026-07-09 incident: OrbService started successfully via
-- the 9:20 AM cron (POST /tindex/orb/start), reported is_running=True, and
-- fired the "started" push — but the underlying stream went silent sometime
-- before 9:46 AM (most likely a Railway process restart unrelated to ORB
-- logic), and nothing re-triggered a start until the NEXT day's 9:20 cron.
-- Every strategy engine sat "armed" in the UI the whole session while
-- structurally blind to two clean, tradeable breakouts on IWM and SPY.
--
-- This job calls POST /tindex/orb/watchdog every 2 minutes. That endpoint
-- checks real bar-arrival liveness (not just the is_running flag, which is
-- exactly what looked healthy during the outage) and force-restarts the hub
-- if it's either not running or running with no bars in the last
-- STALE_FEED_THRESHOLD_SEC (180s, monitoring_routes.py) during market hours.
--
-- Same pg_cron+pg_net rationale as 20260707_scheduled_jobs_pg_cron.sql: an
-- in-process APScheduler job dies on every redeploy; pg_cron runs inside
-- Postgres itself, independent of the API process.

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

do $$ begin perform cron.unschedule('orb_hub_watchdog'); exception when others then null; end $$;

select cron.schedule(
  'orb_hub_watchdog',
  '*/2 * * * *',
  $$select net.http_post(
      url     := 'https://alethia-test-eng.up.railway.app/tindex/orb/watchdog',
      headers := '{"Content-Type": "application/json"}'::jsonb,
      body    := '{}'::jsonb
    );$$
);

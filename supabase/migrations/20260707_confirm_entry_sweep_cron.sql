-- Periodic expiry sweep for the confirm_entry pending-confirmation gate
-- (see 20260707_confirm_entry.sql). A pending confirmation left unanswered for
-- PENDING_CONFIRMATION_TTL_MIN (5 min, orb_engine.py) is stale — the 0DTE
-- contract/price shown to the user is no longer representative of the signal
-- that triggered it — so it must be swept even if the user never opens the app.
--
-- Runs every minute via pg_cron, same rationale as
-- 20260707_scheduled_jobs_pg_cron.sql: an in-process APScheduler job would be
-- wiped on every Railway restart/redeploy, silently leaving stale confirmations
-- around indefinitely. Unlike the daily-review/0DTE-scan jobs, this doesn't
-- need the ET-wall-clock-matching guard function — "every minute" is a plain
-- interval, not a fixed local time, so it needs no DST handling.
--
-- Target Railway deployment — ENGINEERING, matching 20260707_scheduled_jobs_pg_cron.sql.

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

do $$ begin perform cron.unschedule('confirm_entry_sweep'); exception when others then null; end $$;

select cron.schedule(
  'confirm_entry_sweep',
  '* * * * *',
  $$select net.http_post(
      url     := 'https://alethia-test-eng.up.railway.app/strategy/pending-confirmations/sweep',
      headers := '{"Content-Type": "application/json"}'::jsonb,
      body    := '{}'::jsonb
    );$$
);

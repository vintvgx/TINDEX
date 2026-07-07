-- Move the two *stateless* scheduled jobs (daily performance review, 0DTE
-- watchlist scans) off the in-process APScheduler running inside the Railway
-- Flask process and onto Supabase pg_cron + pg_net instead.
--
-- Why: the Railway jobs live in a BackgroundScheduler inside the API process.
-- Any restart/redeploy wipes them, and (for the daily review specifically)
-- they only ever got re-registered as a side effect of calling
-- POST /tindex/orb/start — so a restart after that call silently kills the
-- 4:15pm review job until someone manually hits that endpoint again.
-- pg_cron runs inside Postgres itself, independent of the API process, and
-- every firing is a real HTTP call you can inspect in net._http_response.
--
-- NOT included here: the per-strategy "orb_calc" (calculate opening range)
-- and "eod_reset" (hard-close open positions at 15:30 ET) jobs from
-- scheduler.py. Those operate on live in-memory ORBEngine objects
-- (engine.calculate_orb(), engine.trading_client.close_position(), etc.) —
-- there is no existing stateless HTTP endpoint that can perform those
-- actions given just a strategy_id, and immediate-trade engines aren't
-- persisted as rows Supabase could even discover. Moving those requires new
-- backend endpoints (and a design decision for immediate-trade engines)
-- before they can be driven from pg_cron — flagged as follow-up work.
--
-- DST note: pg_cron schedules are UTC-only. Rather than hand-adjust twice a
-- year, each job is scheduled at BOTH the EDT- and EST-equivalent UTC times;
-- the guard function only actually fires the HTTP call on whichever one
-- currently matches real America/New_York wall-clock time, so the other is
-- a harmless no-op. No manual DST maintenance required.

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

-- Target Railway deployment for these jobs — ENGINEERING, per instruction.
-- If you ever promote this to the production deployment, re-run this
-- migration with BASE_URL below swapped to the production host.
-- (https://alethia-production.up.railway.app)

create or replace function cron_fire_et_scheduled_job(
  target_url      text,
  target_hour     int,
  target_minute   int,
  request_body    jsonb default '{}'::jsonb
) returns void
language plpgsql
as $$
declare
  et_now timestamp := now() at time zone 'America/New_York';
begin
  -- Only actually call out if the current New York wall-clock time matches
  -- the intended fire time. The caller schedules this at both the EDT- and
  -- EST-equivalent UTC times; whichever one doesn't match right now is a
  -- deliberate no-op, so DST transitions never require manual adjustment.
  if extract(hour from et_now)::int = target_hour
     and extract(minute from et_now)::int = target_minute then
    perform net.http_post(
      url     := target_url,
      headers := '{"Content-Type": "application/json"}'::jsonb,
      body    := request_body
    );
  end if;
end;
$$;

-- ── Daily performance review — 4:15 PM ET, mon-fri ──────────────────────────
-- POST /strategy/review/generate (no body = defaults to today)

do $$ begin perform cron.unschedule('daily_review_edt'); exception when others then null; end $$;
do $$ begin perform cron.unschedule('daily_review_est'); exception when others then null; end $$;

select cron.schedule(
  'daily_review_edt', '15 20 * * 1-5',
  $$select cron_fire_et_scheduled_job('https://alethia-test-eng.up.railway.app/strategy/review/generate', 16, 15);$$
);
select cron.schedule(
  'daily_review_est', '15 21 * * 1-5',
  $$select cron_fire_et_scheduled_job('https://alethia-test-eng.up.railway.app/strategy/review/generate', 16, 15);$$
);

-- ── 0DTE watchlist scans — 9:45, 10:30, 11:30, 12:30, 13:30 ET, mon-fri ────
-- POST /zero-dte/scan (no body)

do $$
declare
  job_name text;
begin
  foreach job_name in array array[
    'zero_dte_scan_0945_edt', 'zero_dte_scan_0945_est',
    'zero_dte_scan_1030_edt', 'zero_dte_scan_1030_est',
    'zero_dte_scan_1130_edt', 'zero_dte_scan_1130_est',
    'zero_dte_scan_1230_edt', 'zero_dte_scan_1230_est',
    'zero_dte_scan_1330_edt', 'zero_dte_scan_1330_est'
  ]
  loop
    begin
      perform cron.unschedule(job_name);
    exception when others then null;
    end;
  end loop;
end $$;

select cron.schedule('zero_dte_scan_0945_edt', '45 13 * * 1-5',
  $$select cron_fire_et_scheduled_job('https://alethia-test-eng.up.railway.app/zero-dte/scan', 9, 45);$$);
select cron.schedule('zero_dte_scan_0945_est', '45 14 * * 1-5',
  $$select cron_fire_et_scheduled_job('https://alethia-test-eng.up.railway.app/zero-dte/scan', 9, 45);$$);

select cron.schedule('zero_dte_scan_1030_edt', '30 14 * * 1-5',
  $$select cron_fire_et_scheduled_job('https://alethia-test-eng.up.railway.app/zero-dte/scan', 10, 30);$$);
select cron.schedule('zero_dte_scan_1030_est', '30 15 * * 1-5',
  $$select cron_fire_et_scheduled_job('https://alethia-test-eng.up.railway.app/zero-dte/scan', 10, 30);$$);

select cron.schedule('zero_dte_scan_1130_edt', '30 15 * * 1-5',
  $$select cron_fire_et_scheduled_job('https://alethia-test-eng.up.railway.app/zero-dte/scan', 11, 30);$$);
select cron.schedule('zero_dte_scan_1130_est', '30 16 * * 1-5',
  $$select cron_fire_et_scheduled_job('https://alethia-test-eng.up.railway.app/zero-dte/scan', 11, 30);$$);

select cron.schedule('zero_dte_scan_1230_edt', '30 16 * * 1-5',
  $$select cron_fire_et_scheduled_job('https://alethia-test-eng.up.railway.app/zero-dte/scan', 12, 30);$$);
select cron.schedule('zero_dte_scan_1230_est', '30 17 * * 1-5',
  $$select cron_fire_et_scheduled_job('https://alethia-test-eng.up.railway.app/zero-dte/scan', 12, 30);$$);

select cron.schedule('zero_dte_scan_1330_edt', '30 17 * * 1-5',
  $$select cron_fire_et_scheduled_job('https://alethia-test-eng.up.railway.app/zero-dte/scan', 13, 30);$$);
select cron.schedule('zero_dte_scan_1330_est', '30 18 * * 1-5',
  $$select cron_fire_et_scheduled_job('https://alethia-test-eng.up.railway.app/zero-dte/scan', 13, 30);$$);

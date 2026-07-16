-- The 0DTE watchlist scanner (Unusual Whales-fed) is being retired — no ROI
-- expected, so its 10 intraday pg_cron jobs (5 scan windows x EDT/EST
-- variants) are unscheduled. The /zero-dte/scan endpoint and underlying
-- service are left in place (not deleted), just no longer called on a
-- schedule.
--
-- Note: the daily review's in-process APScheduler duplicate trigger (the
-- other half of the 2026-07-15 duplicate-notification fix) was removed in
-- application code (api/app.py), not here — the single Supabase pg_cron job
-- pair (daily_review_edt/daily_review_est, from
-- 20260707_scheduled_jobs_pg_cron.sql) was already correct as the sole
-- trigger and needs no change.

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

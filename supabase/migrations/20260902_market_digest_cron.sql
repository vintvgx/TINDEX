-- Pre-market Market Digest — 8:30 AM ET, mon-fri, via the same stateless
-- pg_cron + pg_net pattern as the 4:15 PM daily review
-- (see 20260707_scheduled_jobs_pg_cron.sql for cron_fire_et_scheduled_job
-- and the DST-dual-schedule rationale).
--
-- POST /market-digest/generate (no body = defaults to today)

do $$ begin perform cron.unschedule('market_digest_edt'); exception when others then null; end $$;
do $$ begin perform cron.unschedule('market_digest_est'); exception when others then null; end $$;

select cron.schedule(
  'market_digest_edt', '30 12 * * 1-5',
  $$select cron_fire_et_scheduled_job('https://alethia-test-eng.up.railway.app/market-digest/generate', 8, 30);$$
);
select cron.schedule(
  'market_digest_est', '30 13 * * 1-5',
  $$select cron_fire_et_scheduled_job('https://alethia-test-eng.up.railway.app/market-digest/generate', 8, 30);$$
);

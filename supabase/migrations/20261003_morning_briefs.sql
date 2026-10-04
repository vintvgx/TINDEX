-- Morning brief (TODO 8 part 1) — today's top-4 setups, their per-play mode
-- (confirm | auto), live status and order state. One row per trading day;
-- services/brief/brief_service.py owns the plays JSON.

BEGIN;

CREATE TABLE IF NOT EXISTS morning_briefs (
    brief_date         date PRIMARY KEY,
    phase              text        NOT NULL,          -- build | rescore | lock
    locked             boolean     NOT NULL DEFAULT false,
    generated_at       timestamptz,
    updated_at         timestamptz NOT NULL DEFAULT now(),
    correlation_label  text,
    blocked            jsonb       NOT NULL DEFAULT '[]'::jsonb,
    plays              jsonb       NOT NULL DEFAULT '[]'::jsonb
);

COMMIT;

-- Schedule: 9:00 build, 9:10 + 9:20 re-score, 9:28 lock (ET, mon-fri).
-- Same DST-dual pattern as the market digest: each job is scheduled at both
-- its EDT and EST UTC times and cron_fire_et_scheduled_job only fires the one
-- that matches New York wall-clock time.
do $$ begin perform cron.unschedule('morning_brief_build_edt');   exception when others then null; end $$;
do $$ begin perform cron.unschedule('morning_brief_build_est');   exception when others then null; end $$;
do $$ begin perform cron.unschedule('morning_brief_r1_edt');      exception when others then null; end $$;
do $$ begin perform cron.unschedule('morning_brief_r1_est');      exception when others then null; end $$;
do $$ begin perform cron.unschedule('morning_brief_r2_edt');      exception when others then null; end $$;
do $$ begin perform cron.unschedule('morning_brief_r2_est');      exception when others then null; end $$;
do $$ begin perform cron.unschedule('morning_brief_lock_edt');    exception when others then null; end $$;
do $$ begin perform cron.unschedule('morning_brief_lock_est');    exception when others then null; end $$;

select cron.schedule('morning_brief_build_edt', '0 13 * * 1-5',
  $$select cron_fire_et_scheduled_job('https://alethia-test-eng.up.railway.app/brief/generate', 9, 0, '{"phase":"build"}'::jsonb);$$);
select cron.schedule('morning_brief_build_est', '0 14 * * 1-5',
  $$select cron_fire_et_scheduled_job('https://alethia-test-eng.up.railway.app/brief/generate', 9, 0, '{"phase":"build"}'::jsonb);$$);
select cron.schedule('morning_brief_r1_edt', '10 13 * * 1-5',
  $$select cron_fire_et_scheduled_job('https://alethia-test-eng.up.railway.app/brief/generate', 9, 10, '{"phase":"rescore"}'::jsonb);$$);
select cron.schedule('morning_brief_r1_est', '10 14 * * 1-5',
  $$select cron_fire_et_scheduled_job('https://alethia-test-eng.up.railway.app/brief/generate', 9, 10, '{"phase":"rescore"}'::jsonb);$$);
select cron.schedule('morning_brief_r2_edt', '20 13 * * 1-5',
  $$select cron_fire_et_scheduled_job('https://alethia-test-eng.up.railway.app/brief/generate', 9, 20, '{"phase":"rescore"}'::jsonb);$$);
select cron.schedule('morning_brief_r2_est', '20 14 * * 1-5',
  $$select cron_fire_et_scheduled_job('https://alethia-test-eng.up.railway.app/brief/generate', 9, 20, '{"phase":"rescore"}'::jsonb);$$);
select cron.schedule('morning_brief_lock_edt', '28 13 * * 1-5',
  $$select cron_fire_et_scheduled_job('https://alethia-test-eng.up.railway.app/brief/generate', 9, 28, '{"phase":"lock"}'::jsonb);$$);
select cron.schedule('morning_brief_lock_est', '28 14 * * 1-5',
  $$select cron_fire_et_scheduled_job('https://alethia-test-eng.up.railway.app/brief/generate', 9, 28, '{"phase":"lock"}'::jsonb);$$);

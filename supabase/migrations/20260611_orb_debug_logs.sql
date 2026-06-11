-- Persisted ORB engine debug log. Replaces the ephemeral in-memory ring buffer:
-- every engine decision (saved strategies + immediate engines) is written here and
-- read by the frontend Debug tab. Debug logging is ALWAYS on (no toggle).
--
-- Backend inserts with the service-role key (bypasses RLS); the app reads with the
-- anon key, mirroring orb_monitoring_state — so RLS stays off and SELECT is granted.

CREATE TABLE IF NOT EXISTS public.orb_debug_logs (
  id            BIGSERIAL PRIMARY KEY,
  ts            TIMESTAMPTZ NOT NULL DEFAULT now(),
  trade_date    DATE        NOT NULL DEFAULT ((now() AT TIME ZONE 'America/New_York')::date),
  strategy_id   TEXT,
  ticker        TEXT,
  strategy_name TEXT,
  level         TEXT        NOT NULL,
  message       TEXT        NOT NULL,
  data          JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_orb_debug_logs_ts         ON public.orb_debug_logs (ts);
CREATE INDEX IF NOT EXISTS idx_orb_debug_logs_trade_date ON public.orb_debug_logs (trade_date);

ALTER TABLE public.orb_debug_logs DISABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.orb_debug_logs TO anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.orb_debug_logs_id_seq TO anon, authenticated;

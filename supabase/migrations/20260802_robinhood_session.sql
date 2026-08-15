-- Persists robin_stocks's Robinhood session (access/refresh token + device
-- token) across backend restarts. Root cause of "I have to sign in every
-- time": robin_stocks's login() (see the installed package's
-- robin_stocks/robinhood/authentication.py) pickles its session to
-- ~/.tokens/robinhood.pickle on the *container's local filesystem* — and
-- Railway's filesystem is not persistent (see monitoring_routes.py's
-- start_contracts_monitor_core docstring: "a mid-session Railway restart
-- (redeploy, platform restart, crash) wipes it"). Every restart wipes that
-- pickle, which means a brand new device_token gets generated on the next
-- login attempt (authentication.py's login() calls generate_device_token()
-- fresh unless a pickle is loaded) — Robinhood's server doesn't recognize
-- an unrecognized device_token, so it re-triggers the SMS verification
-- challenge on every single restart, not just once.
--
-- Fix: robinhood_service.py now round-trips that same pickle's bytes through
-- this table — writing the on-disk pickle file's bytes here right after a
-- successful login, and restoring them to disk from here before the first
-- login attempt of a fresh process. That keeps the same device_token (and
-- access/refresh tokens, while still valid) alive across restarts, so
-- Robinhood's server continues to recognize this "device" and skips SMS
-- unless the account itself forces a re-verification.
--
-- Single personal account, one row — no user_id, no RLS policy (this table
-- is only ever touched by the backend's service-role client, same as
-- watchlist_cache and other backend-only cache tables in this schema).
CREATE TABLE IF NOT EXISTS robinhood_sessions (
  id           INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),  -- singleton row
  pickle_b64   TEXT NOT NULL,     -- base64 of robin_stocks's raw pickle bytes
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- NOTE: this migration has not been applied automatically — apply it
-- manually against the Supabase project (see repo convention: migrations
-- under supabase/migrations/ are written here but run by hand).

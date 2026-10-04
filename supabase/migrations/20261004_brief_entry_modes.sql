-- Brief entry modes — per-ticker confirm/auto preference, set from the
-- Morning Brief digest (or the Brief tab) and honored by the 9:00 ET brief
-- build when seeding each play's mode. Default is 'confirm'.

BEGIN;

CREATE TABLE IF NOT EXISTS brief_entry_modes (
    ticker      text PRIMARY KEY,
    mode        text NOT NULL DEFAULT 'confirm'
                CHECK (mode IN ('confirm', 'auto')),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

COMMIT;

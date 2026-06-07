-- orb_session: replace UNIQUE(session_date) with composite UNIQUE(session_date, strategy_id)
-- so multiple strategies can each record their own session per day.

ALTER TABLE orb_session
    ADD COLUMN IF NOT EXISTS strategy_id TEXT;

ALTER TABLE orb_session
    DROP CONSTRAINT IF EXISTS orb_session_session_date_key;

ALTER TABLE orb_session
    ADD CONSTRAINT orb_session_session_date_strategy_id_key
        UNIQUE (session_date, strategy_id);

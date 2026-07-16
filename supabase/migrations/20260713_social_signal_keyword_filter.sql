-- Per-account "parse for" keyword filtering (see docs/features/social-signal-contracts.md §4)
-- plus a self-tracked X API usage ledger, since X exposes no public endpoint
-- for the actual dollar credit balance (only tweet-count usage, and only via
-- the Developer Console for the real $ figure) — see doc §"X balance display".

ALTER TABLE social_signal_accounts
  ADD COLUMN IF NOT EXISTS parse_keywords TEXT[] NOT NULL DEFAULT '{}';

ALTER TABLE social_signal_tweets DROP CONSTRAINT IF EXISTS social_signal_tweets_parse_status_check;
ALTER TABLE social_signal_tweets ADD CONSTRAINT social_signal_tweets_parse_status_check
  CHECK (parse_status IN ('pending', 'parsed', 'ambiguous', 'no_contract', 'filtered_out', 'error'));

CREATE TABLE IF NOT EXISTS x_api_usage_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_type TEXT NOT NULL CHECK (resource_type IN ('posts_read', 'user_read')),
  quantity      INTEGER NOT NULL,
  unit_cost_usd NUMERIC(10, 4) NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_x_api_usage_log_created ON x_api_usage_log (created_at DESC);

-- @OptionsBuffett's two confirmed verbatim entry-signal phrases (see doc §1) —
-- @FL0WG0D is left with no keywords (not yet followed; vision pipeline is a
-- later phase) and starts inactive so nothing tries to poll/parse it yet.
UPDATE social_signal_accounts
  SET parse_keywords = ARRAY['HIGH CONFIDENCE', '$1,000 To $100,000 Challenge']
  WHERE handle = 'OptionsBuffett';

UPDATE social_signal_accounts
  SET active = FALSE
  WHERE handle = 'FL0WG0D';

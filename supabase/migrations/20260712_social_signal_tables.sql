-- Social signal contract tracking: watch specific X/Twitter accounts for
-- options contract call-outs, parse them, and feed them into the existing
-- tracked_options_contracts / OptionsContractMonitorService pipeline.
-- See docs/features/social-signal-contracts.md for the full design.
--
-- Ingestion is via the official X API (paid, pay-as-you-go) — see the doc's
-- "Implementation notes" for the pricing analysis. last_seen_tweet_id doubles
-- as the since_id cursor for X API v2's user-timeline endpoint, which natively
-- supports "give me everything newer than this id" — no custom diffing needed.

CREATE TABLE IF NOT EXISTS social_signal_accounts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  handle            TEXT NOT NULL UNIQUE,       -- 'FL0WG0D' (no leading @)
  x_user_id         TEXT,                       -- numeric X user id, resolved+cached once
  label             TEXT,                       -- display name for the app UI
  active            BOOLEAN NOT NULL DEFAULT TRUE,
  last_seen_tweet_id TEXT,                      -- since_id cursor for the next poll
  last_polled_at    TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS social_signal_tweets (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id            UUID NOT NULL REFERENCES social_signal_accounts(id) ON DELETE CASCADE,
  tweet_id              TEXT NOT NULL UNIQUE,     -- X's own tweet id — the real dedup key
  tweet_text            TEXT NOT NULL,
  tweet_url             TEXT,
  posted_at             TIMESTAMPTZ,
  parse_status          TEXT NOT NULL DEFAULT 'pending'
                        CHECK (parse_status IN ('pending', 'parsed', 'ambiguous', 'no_contract', 'error')),
  parsed_contract       JSONB,                    -- {ticker, option_type, strike, expiry} when parsed
  parse_method          TEXT,                     -- 'regex' | 'claude'
  tracked_contract_id   UUID REFERENCES tracked_options_contracts(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_social_signal_tweets_account ON social_signal_tweets(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_social_signal_tweets_status  ON social_signal_tweets(parse_status);

INSERT INTO social_signal_accounts (handle, label, active) VALUES
  ('OptionsBuffett', 'OptionsBuffett', TRUE),
  ('FL0WG0D',        'FL0WG0D',        TRUE)
ON CONFLICT (handle) DO NOTHING;

-- tracked_options_contracts.valid_expiration required expiration_date to be
-- strictly after created_at::date, which rejects same-day (0DTE) contracts.
-- contract_parser.py deliberately resolves same-day tweets to
-- expiry = today.isoformat() (see contract_parser.py's "these accounts post
-- same-day 0DTE calls often enough" comment), so every 0DTE social-signal
-- tweet fails this constraint on insert and the follower never gets tracked
-- or notified. The app already supports 0DTE elsewhere (zero_dte_positions
-- has no such restriction), so allow expiration_date == created_at::date.
ALTER TABLE tracked_options_contracts
  DROP CONSTRAINT IF EXISTS valid_expiration,
  ADD CONSTRAINT valid_expiration CHECK (expiration_date >= created_at::date);

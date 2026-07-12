-- Decouple daily performance reviews by account: a live strategy's P&L and
-- AI narrative should never be blended with paper-account testing activity.
-- Going forward, one review row is generated per (review_date, paper_mode)
-- instead of one blended row per review_date.
--
-- Existing rows predate this split and mix paper+live trades in trades_json —
-- they're backfilled as paper_mode=true (the old default state trades were
-- logged under) rather than deleted, so historical reviews stay readable;
-- they just won't retroactively split into two.
ALTER TABLE performance_reviews
  ADD COLUMN IF NOT EXISTS paper_mode boolean NOT NULL DEFAULT true;

-- Drop the single-column uniqueness (implicit from the original `unique`
-- column constraint) and replace it with a composite key so both a paper and
-- a live review can exist for the same date.
ALTER TABLE performance_reviews
  DROP CONSTRAINT IF EXISTS performance_reviews_review_date_key;

ALTER TABLE performance_reviews
  ADD CONSTRAINT performance_reviews_review_date_paper_mode_key
  UNIQUE (review_date, paper_mode);

CREATE INDEX IF NOT EXISTS idx_performance_reviews_paper_mode ON performance_reviews (paper_mode);

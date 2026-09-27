-- social_signal_tweets.tracked_contract_id is a historical audit reference
-- to tracked_options_contracts ("which contract did this tweet lead to
-- tracking"), not an ownership relationship — deleting a tracked contract
-- (a bad row, a duplicate, or one from the year-off expiry parsing bug fixed
-- in contract_parser.py) must never be blocked by, or cascade-delete, the
-- tweet's own audit history.
--
-- The FK previously had no ON DELETE behavior, so Postgres defaulted to
-- NO ACTION — any tracked_options_contracts row still referenced by a tweet
-- (essentially all of them) could never be deleted at all:
--   "Unable to delete rows as one of them is currently referenced by a
--    foreign key constraint from the table social_signal_tweets ..."
ALTER TABLE social_signal_tweets
  DROP CONSTRAINT IF EXISTS social_signal_tweets_tracked_contract_id_fkey,
  ADD CONSTRAINT social_signal_tweets_tracked_contract_id_fkey
    FOREIGN KEY (tracked_contract_id)
    REFERENCES tracked_options_contracts (id)
    ON DELETE SET NULL;

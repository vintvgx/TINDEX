-- Makes following an X account genuinely per-user. social_signal_accounts stays
-- a single deduped registry of distinct handles (so the poll loop makes one
-- X API query per handle regardless of how many users follow it, not one per
-- user) — this join table is what actually ties a follow to a user, the same
-- way user_stock_follows ties an ORB follow to a user.
--
-- Before this, signal_ingest_service.py had no way to know "who follows this
-- account" at all, so every tracked_options_contracts row it created got
-- stamped with an arbitrary user_profiles row (whichever came back first from
-- an unfiltered `.limit(1)` query) instead of the actual follower(s).

create table if not exists user_social_signal_follows (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid not null references social_signal_accounts(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, account_id)
);

create index if not exists idx_user_social_signal_follows_user
  on user_social_signal_follows(user_id);
create index if not exists idx_user_social_signal_follows_account
  on user_social_signal_follows(account_id);

alter table user_social_signal_follows enable row level security;

drop policy if exists "Users can read own social signal follows" on user_social_signal_follows;
create policy "Users can read own social signal follows"
  on user_social_signal_follows for select using (auth.uid() = user_id);

drop policy if exists "Users can insert own social signal follows" on user_social_signal_follows;
create policy "Users can insert own social signal follows"
  on user_social_signal_follows for insert with check (auth.uid() = user_id);

drop policy if exists "Users can delete own social signal follows" on user_social_signal_follows;
create policy "Users can delete own social signal follows"
  on user_social_signal_follows for delete using (auth.uid() = user_id);

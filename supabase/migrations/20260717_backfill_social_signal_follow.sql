-- One-time backfill: user_social_signal_follows didn't exist until the
-- per-user redesign, so the account you're actually using (OptionsBuffett)
-- currently has zero followers — which would make _load_active_accounts()
-- stop polling it on the next cycle. This ties your existing follow back
-- together so polling doesn't just silently drop.
--
-- FL0WG0D is NOT backfilled here — it's already inactive with no x_user_id
-- resolved, so it isn't being polled either way. Follow it through the app
-- if/when you want it live; that path now correctly creates this row itself.

insert into user_social_signal_follows (user_id, account_id)
select
  '262c8cc2-4ded-449b-a8be-0bab40d06ef4',  -- your user_id, confirmed against tracked_options_contracts.user_id
  'c105d3b2-2a4e-4145-aa55-71338386cf4c'   -- OptionsBuffett
where exists (select 1 from auth.users where id = '262c8cc2-4ded-449b-a8be-0bab40d06ef4')
  and exists (select 1 from social_signal_accounts where id = 'c105d3b2-2a4e-4145-aa55-71338386cf4c')
on conflict (user_id, account_id) do nothing;

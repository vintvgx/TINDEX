-- Allow the 'pending' and 'failed' statuses that swing_routes.py writes
-- (pending pre-insert before the broker call; failed if the broker order errors).

alter table swing_positions
  drop constraint if exists swing_positions_status_check;

alter table swing_positions
  add constraint swing_positions_status_check
  check (status in ('pending', 'open', 'partially_closed', 'closed', 'expired', 'failed'));

-- Per-ticker notification-type toggles for followed ORB tickers. Lets a user
-- keep BREAKOUT CONFIRMED and/or REVERSAL DETECTED pushes on for some
-- followed tickers and off for others, instead of the all-or-nothing
-- notification_enabled switch that already exists on this table.
--
-- Both default true so existing follows keep receiving both notification
-- types until a user explicitly turns one off (matches current behavior).

alter table user_stock_follows
  add column if not exists notify_confirmed_breakout boolean not null default true,
  add column if not exists notify_reversal boolean not null default true;

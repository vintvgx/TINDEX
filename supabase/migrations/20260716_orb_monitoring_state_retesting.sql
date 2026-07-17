-- Allow the 'Retesting Bullish' / 'Retesting Bearish' breakout_type values that
-- orb_service.py now writes when a broken ORH/ORL level is invalidated and
-- re-armed for a capped retest, instead of firing a push notification per
-- state transition (BROKEN/INVALIDATED/RETESTING now surface only via the
-- ORB card reading this table's realtime feed).

alter table orb_monitoring_state
  drop constraint if exists orb_monitoring_state_breakout_type_check;

alter table orb_monitoring_state
  add constraint orb_monitoring_state_breakout_type_check
  check (breakout_type = ANY (ARRAY[
    'none'::text,
    'invalidated'::text,
    'Bullish'::text,
    'Bearish'::text,
    'Retesting Bullish'::text,
    'Retesting Bearish'::text,
    'Confirmed Bullish'::text,
    'Confirmed Bearish'::text,
    'reversal'::text
  ]));

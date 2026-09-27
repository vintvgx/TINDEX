-- Companion to 20260714_orb_trades_recovery_fields.sql's hard_stop_price/
-- tp1_price/tp2_price: persists a mid-trade runner_mode/cascade_enabled
-- override (see exit_manager.py's apply_overrides()) so a Railway restart's
-- recover_position() can restore it too, instead of silently reverting to
-- the profile's default (2026-08-04 — a user-set "No Trail" override wasn't
-- surviving a redeploy, same root cause as the stop/TP-reverting bug this
-- whole recovery-fields family exists to prevent).

alter table orb_trades
    add column if not exists runner_mode     text,
    add column if not exists cascade_enabled boolean;

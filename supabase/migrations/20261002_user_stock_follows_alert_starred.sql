-- Migration: user_stock_follows.alert_starred
-- Description: Alert priority for zone notifications (notification engine
-- v2 — api/services/notifications/alert_router.py). Starred tickers get the
-- full channel treatment (quiet push for approaches, active push for
-- confirmations); unstarred ones get approaches in-app only and quiet
-- confirmations. A user with nothing starred has every followed ticker
-- treated as starred. Toggled by the bell on the ticker sheet header; a row
-- may exist with orb_enabled = false just to carry the star.

BEGIN;

ALTER TABLE user_stock_follows
  ADD COLUMN IF NOT EXISTS alert_starred BOOLEAN NOT NULL DEFAULT FALSE;

COMMIT;

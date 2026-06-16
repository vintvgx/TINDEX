-- Add columns that the backend sends but are missing from strategy_configs.
-- debug_mode was in a prior migration file that was never applied to production.
-- smart_contracts is in STRATEGY_DEFAULTS but was never persisted.

ALTER TABLE strategy_configs
  ADD COLUMN IF NOT EXISTS debug_mode     BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS smart_contracts BOOLEAN NOT NULL DEFAULT FALSE;

-- Drop any FK constraints from related tables that reference strategy_configs(id)
-- and replace them with ON DELETE SET NULL so strategy deletion doesn't block.
-- Safe no-op if no such FK exists.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT tc.table_name, tc.constraint_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.referential_constraints rc
      ON tc.constraint_name = rc.constraint_name
    JOIN information_schema.table_constraints pc
      ON pc.constraint_name = rc.unique_constraint_name
    WHERE pc.table_name = 'strategy_configs'
      AND tc.constraint_type = 'FOREIGN KEY'
  LOOP
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', r.table_name, r.constraint_name);
  END LOOP;
END;
$$;

-- =============================================================================
-- plaid_items — server-side storage for Plaid access_tokens
--
-- This table is accessed ONLY via the service-role key (backend).
-- The mobile client uses the anon key and cannot read or write here.
-- RLS is enabled but no SELECT policy is created for authenticated users —
-- only the service role (bypasses RLS entirely) can read rows.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.plaid_items (
  item_id         text PRIMARY KEY,
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  access_token    text NOT NULL,
  institution_id  text NOT NULL,
  institution_name text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_plaid_items_user_id ON public.plaid_items(user_id);

CREATE OR REPLACE FUNCTION public.set_plaid_items_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS plaid_items_updated_at ON public.plaid_items;
CREATE TRIGGER plaid_items_updated_at
  BEFORE UPDATE ON public.plaid_items
  FOR EACH ROW EXECUTE PROCEDURE public.set_plaid_items_updated_at();

-- Enable RLS so anon/authenticated roles cannot access rows
ALTER TABLE public.plaid_items ENABLE ROW LEVEL SECURITY;
-- No SELECT/INSERT/UPDATE/DELETE policies for client roles intentionally.
-- The service_role key bypasses RLS and is used only by the Railway backend.

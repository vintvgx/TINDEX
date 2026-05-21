-- =============================================================================
-- Plaid: linked brokerage account metadata per user
--
-- NOTE: Plaid access_tokens are NEVER stored in Supabase.
-- They live server-side in the Railway backend (environment variables or a
-- secrets store). Only the item_id and display metadata are kept here so the
-- app can list / disconnect accounts without hitting the backend.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.plaid_accounts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  item_id          text NOT NULL,
  institution_id   text NOT NULL,
  institution_name text NOT NULL,
  account_id       text NOT NULL,
  account_name     text NOT NULL,
  account_type     text NOT NULL,
  account_subtype  text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, account_id)
);

CREATE INDEX IF NOT EXISTS idx_plaid_accounts_user_id
  ON public.plaid_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_plaid_accounts_item_id
  ON public.plaid_accounts(user_id, item_id);

CREATE OR REPLACE FUNCTION public.set_plaid_accounts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS plaid_accounts_updated_at ON public.plaid_accounts;
CREATE TRIGGER plaid_accounts_updated_at
  BEFORE UPDATE ON public.plaid_accounts
  FOR EACH ROW EXECUTE PROCEDURE public.set_plaid_accounts_updated_at();

ALTER TABLE public.plaid_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own plaid accounts"   ON public.plaid_accounts;
DROP POLICY IF EXISTS "Users can insert own plaid accounts" ON public.plaid_accounts;
DROP POLICY IF EXISTS "Users can update own plaid accounts" ON public.plaid_accounts;
DROP POLICY IF EXISTS "Users can delete own plaid accounts" ON public.plaid_accounts;

CREATE POLICY "Users can read own plaid accounts"
  ON public.plaid_accounts FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own plaid accounts"
  ON public.plaid_accounts FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own plaid accounts"
  ON public.plaid_accounts FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own plaid accounts"
  ON public.plaid_accounts FOR DELETE USING (auth.uid() = user_id);

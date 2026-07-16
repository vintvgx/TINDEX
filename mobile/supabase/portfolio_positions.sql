-- =============================================================================
-- Portfolio: positions table + summary table (compiles totals, P&L, performance)
-- Run this in the Supabase SQL Editor (Dashboard → SQL Editor → New query).
-- Positions from the calendar (New Trade) and from the Portfolio modal both
-- go into portfolio_positions; the summary table is updated automatically.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. portfolio_positions — individual positions (calendar + portfolio modal)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.portfolio_positions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ticker         text NOT NULL,
  shares         numeric(20, 6) NOT NULL CHECK (shares > 0),
  average_cost   numeric(20, 4) NOT NULL CHECK (average_cost >= 0),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),

  position_type  text NOT NULL DEFAULT 'long' CHECK (position_type IN ('long', 'short')),
  status         text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'partial')),
  opened_at      timestamptz NOT NULL DEFAULT now(),
  closed_at      timestamptz NULL,
  realized_pnl   numeric(20, 4) NULL,
  strategy       text NOT NULL DEFAULT 'scalp' CHECK (strategy IN ('ORB', 'scalp')),

  UNIQUE(user_id, ticker)
);

CREATE INDEX IF NOT EXISTS idx_portfolio_positions_user_id
  ON public.portfolio_positions(user_id);
CREATE INDEX IF NOT EXISTS idx_portfolio_positions_status
  ON public.portfolio_positions(user_id, status);

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS portfolio_positions_updated_at ON public.portfolio_positions;
CREATE TRIGGER portfolio_positions_updated_at
  BEFORE UPDATE ON public.portfolio_positions
  FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

ALTER TABLE public.portfolio_positions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own portfolio positions" ON public.portfolio_positions;
CREATE POLICY "Users can read own portfolio positions"
  ON public.portfolio_positions FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can insert own portfolio positions" ON public.portfolio_positions;
CREATE POLICY "Users can insert own portfolio positions"
  ON public.portfolio_positions FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can update own portfolio positions" ON public.portfolio_positions;
CREATE POLICY "Users can update own portfolio positions"
  ON public.portfolio_positions FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can delete own portfolio positions" ON public.portfolio_positions;
CREATE POLICY "Users can delete own portfolio positions"
  ON public.portfolio_positions FOR DELETE USING (auth.uid() = user_id);

-- -----------------------------------------------------------------------------
-- 2. portfolio — one row per user: totals, performance, P&L (from portfolio_positions)
-- -----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS refresh_portfolio_after_positions ON public.portfolio_positions;
DROP TABLE IF EXISTS public.portfolio;

CREATE TABLE public.portfolio (
  user_id             uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  total_cost_basis    numeric(20, 4) NOT NULL DEFAULT 0,
  total_current_value numeric(20, 4) NULL,
  total_realized_pnl   numeric(20, 4) NOT NULL DEFAULT 0,
  total_unrealized_pnl numeric(20, 4) NULL,
  performance_pct      numeric(10, 4) NULL,
  positions_count     int NOT NULL DEFAULT 0,
  updated_at          timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.portfolio ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own portfolio" ON public.portfolio;
CREATE POLICY "Users can read own portfolio"
  ON public.portfolio FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can insert own portfolio" ON public.portfolio;
CREATE POLICY "Users can insert own portfolio"
  ON public.portfolio FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can update own portfolio" ON public.portfolio;
CREATE POLICY "Users can update own portfolio"
  ON public.portfolio FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- -----------------------------------------------------------------------------
-- 3. Trigger: refresh portfolio summary when portfolio_positions changes
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.refresh_portfolio_summary()
RETURNS TRIGGER AS $$
DECLARE
  uid uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    uid := OLD.user_id;
  ELSE
    uid := NEW.user_id;
  END IF;

  INSERT INTO public.portfolio (
    user_id,
    total_cost_basis,
    total_realized_pnl,
    positions_count,
    updated_at
  )
  SELECT
    uid,
    COALESCE((SELECT SUM(CASE WHEN status = 'open' THEN shares * average_cost ELSE 0 END) FROM public.portfolio_positions WHERE user_id = uid), 0),
    COALESCE((SELECT SUM(realized_pnl) FROM public.portfolio_positions WHERE user_id = uid), 0),
    COALESCE((SELECT COUNT(*)::int FROM public.portfolio_positions WHERE user_id = uid), 0),
    now()
  ON CONFLICT (user_id) DO UPDATE SET
    total_cost_basis = EXCLUDED.total_cost_basis,
    total_realized_pnl = EXCLUDED.total_realized_pnl,
    positions_count = EXCLUDED.positions_count,
    updated_at = now();

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS refresh_portfolio_after_positions ON public.portfolio_positions;
CREATE TRIGGER refresh_portfolio_after_positions
  AFTER INSERT OR UPDATE OR DELETE ON public.portfolio_positions
  FOR EACH ROW EXECUTE PROCEDURE public.refresh_portfolio_summary();

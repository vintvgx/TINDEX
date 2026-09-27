-- Migration: Kill-switch bookkeeping for strategy_configs
-- Run in Supabase Dashboard → SQL Editor, or via `supabase db push`
--
-- Marks configs that a bulk "pause all [paper|live|both]" action turned off,
-- so "resume" only reactivates the ones the kill-switch itself paused —
-- not strategies that were already individually disabled beforehand for
-- unrelated reasons. See POST /strategy/configs/pause-all.

BEGIN;

ALTER TABLE public.strategy_configs
  ADD COLUMN IF NOT EXISTS paused_by_kill_switch BOOLEAN NOT NULL DEFAULT FALSE;

COMMIT;

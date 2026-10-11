-- Limit sell ladder (2026-10-12): resting DAY limit SELL orders placed from
-- the app's sell sheet. One row per Alpaca order. Persisted so a backend
-- restart can reconcile them against Alpaca instead of orphaning them or
-- double-counting their fills (see LimitOrderTracker.recover_begin).
--
-- status: working | partially_filled | filled | canceled | expired | rejected
create table if not exists public.working_limit_orders (
  order_id          text primary key,              -- Alpaca order id
  strategy_id       text not null,
  trade_id          text,                           -- orb_trades.id of the position
  contract_symbol   text not null,
  paper             boolean not null default true,
  qty               integer not null check (qty >= 1),
  limit_price       numeric(10, 2) not null check (limit_price > 0),
  filled_qty        integer not null default 0,
  filled_avg_price  numeric(10, 4),
  status            text not null default 'working',
  placed_at         timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists working_limit_orders_trade_idx
  on public.working_limit_orders (trade_id, status);
create index if not exists working_limit_orders_strategy_idx
  on public.working_limit_orders (strategy_id, status);

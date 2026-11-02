// Trade Logging v2 (trade-logging-cascade-v2 brief §4) — the optional
// `log_v2` record the backend will attach to an orb_trades row. Every field
// is optional and nullable: rows logged before v2 have none of it, and a
// partially-written record must still render (absent → MISSING, never guessed).

export type Provenance =
  | 'VERIFIED'    // broker/API fill, or engine log written at decision time
  | 'ENGINE'      // computed by the system at decision time from live inputs
  | 'INFERRED'    // reconstructed after the fact — basis required, never a fill
  | 'MANUAL'      // entered/overridden by a person (who/when/via)
  | 'UNVERIFIED'  // present but not checked
  | 'STALE'       // present but known stale (e.g. volume/OI reading 0)
  | 'MISSING'     // not logged — shown as a gap
  | 'ESTIMATE';   // derived (e.g. intrinsic from underlying), not a quote

export const PROVENANCE_ORDER: Provenance[] = [
  'VERIFIED', 'ENGINE', 'INFERRED', 'MANUAL', 'UNVERIFIED', 'STALE', 'MISSING', 'ESTIMATE',
];

/** One displayed value plus where it came from. */
export interface PField<T = string | number | boolean> {
  v: T | null;
  p: Provenance;
  basis?: string | null;
}

export interface V2Bar {
  t?: string | null;          // bar start, ISO
  o?: number | null; h?: number | null; l?: number | null; c?: number | null;
  against?: boolean | null;
  recovering?: boolean | null;
}

export interface V2Technicals {
  composite_total?: number | null;
  tier?: string | null;
  vwap?: string | null;
  orb?: string | null;
  ema_5m?: string | null;
  rsi_5m?: number | null;
  structure?: string | null;
}

/** One decision event — exits AND non-exits (cascade candidate/blocked, watch, ...). */
export interface V2Event {
  t?: string | null;                 // ISO
  code?: string | null;              // TP1, CASCADE_CANDIDATE, CASCADE_FIRE, CASCADE_BLOCKED, TP2, ...
  p?: Provenance | null;
  basis?: string | null;
  qty_before?: number | null;
  qty_closed?: number | null;
  qty_after?: number | null;
  premium?: number | null;
  premium_source?: string | null;    // fill / bid / mid / ...
  underlying?: number | null;
  leg_pnl?: number | null;
  cum_pnl?: number | null;
  armed?: Record<string, number | null> | null;
  technicals?: V2Technicals | null;
  evidence?: {
    peak?: number | null;
    trigger?: number | null;
    deadline?: string | null;
    bars?: V2Bar[] | null;
    note?: string | null;
  } | null;
  blocked_reason?: string | null;
  manual?: { who?: string | null; via?: string | null } | null;
}

export interface TradeLogV2 {
  schema?: string | null;
  strategy_name?: string | null;
  config_hash?: string | null;
  frozen_config?: Record<string, PField<string | number | boolean> | null> | null;
  overrides?: { field?: string; old?: unknown; new?: unknown; who?: string; when?: string; via?: string }[] | null;
  reentry?: {
    prev_trade_id?: string | null;
    prev_exit_reason?: string | null;
    prev_exit_time?: string | null;
    minutes_since?: number | null;
    cooldown_min?: number | null;
    cooldown_ok?: boolean | null;
    gate_note?: string | null;
  } | null;
  entry?: Partial<Record<'signal' | 'trigger' | 'vwap' | 'gate' | 'flow' | 'market', PField | null>> | null;
  composite?: {
    total?: number | null;
    tier?: string | null;
    rows?: { factor?: string; value?: string | number | null; score?: number | null }[] | null;
  } | null;
  contract?: Partial<Record<'quote' | 'greeks' | 'vol_oi' | 'buying_power', PField | null>> | null;
  events?: V2Event[] | null;
  outcome?: Partial<Record<'mfe' | 'mae' | 't_tp1' | 't_tp2' | 't_be', PField | null>> | null;
  post_exit?: Partial<Record<'p15' | 'p30' | 'eod' | 'missed', PField | null>> | null;
  classification?: { question?: string; answer?: string }[] | null;
}

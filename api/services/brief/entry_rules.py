"""
Morning-brief entry rules — pure, no I/O (2026-10-03 agreed plan + the
"Morning Brief — Entry Updates" spec).

  trigger           1-minute close through the trigger level on ≥1.2× the
                    1m volume baseline (same feed — IEX — as the live bars)
  stale at open     price already > 0.3% through the trigger at 9:30 → stand down
  size tier         premium ≤ $1.00 → 3 × SCALP_30_100; ≤ $1.50 → 2 × SCALP_50;
                    ≤ $2.50 → 1 × SCALP_100; above → no trade
  contract pick     strike anchored near the TARGET zone (OTM at entry); delta
                    target ≈ TP1% × premium / expected move, clamped 0.20–0.60
  spread gate       ≤ 15% → limit at ask; 15–30% → limit at mid; > 30% → skip
  entry window      auto-entry only 9:30–10:00 ET
"""

from datetime import time

TRIGGER_VOLUME_MULT = 1.2
STALE_PCT = 0.003
DELTA_MIN, DELTA_MAX = 0.20, 0.60
SPREAD_ASK_MAX = 0.15
SPREAD_MID_MAX = 0.30
ENTRY_WINDOW = (time(9, 30), time(10, 0))

# (max premium per share, qty, profile key, TP1 fraction)
SIZE_TIERS = [
    (1.00, 3, "SCALP_30_100", 0.30),
    (1.50, 2, "SCALP_50", 0.50),
    (2.50, 1, "SCALP_100", 1.00),
]


def in_entry_window(t) -> bool:
    return ENTRY_WINDOW[0] <= t < ENTRY_WINDOW[1]


def trigger_hit(direction: str, trigger: float, close: float, volume: float,
                baseline_1m: "float | None", volume_mult: float = TRIGGER_VOLUME_MULT) -> bool:
    """1m close through the trigger with volume ≥ 1.2× the baseline. No
    baseline → no signal (a volume check can't be skipped on an entry)."""
    through = close > trigger if direction == "CALL" else close < trigger
    if not through or not baseline_1m or baseline_1m <= 0:
        return False
    return (volume or 0) >= volume_mult * baseline_1m


def stale_through(direction: str, trigger: float, price: float, pct: float = STALE_PCT) -> bool:
    """Price already more than `pct` past the trigger — don't chase."""
    if direction == "CALL":
        return price > trigger * (1 + pct)
    return price < trigger * (1 - pct)


def drifted(trigger: float, price: float, pct: float = STALE_PCT) -> bool:
    """Underlying moved more than `pct` from the trigger (either way) while a
    limit order was working — cancel it."""
    return abs(price - trigger) / trigger > pct


def size_tier(premium: float) -> "dict | None":
    for cap, qty, profile, tp1 in SIZE_TIERS:
        if premium <= cap:
            return {"qty": qty, "profile": profile, "tp1_pct": tp1, "budget_per_contract": cap * 100}
    return None


def spread_gate(bid: float, ask: float) -> dict:
    """{'action': 'ask'|'mid'|'skip', 'limit': price|None, 'spread_pct'}.
    Spread is measured against the midpoint."""
    if not ask or ask <= 0 or bid is None or bid < 0 or bid > ask:
        return {"action": "skip", "limit": None, "spread_pct": None}
    mid = (ask + bid) / 2
    spread = (ask - bid) / mid if mid > 0 else 1.0
    if spread <= SPREAD_ASK_MAX:
        return {"action": "ask", "limit": round(ask, 2), "spread_pct": round(spread * 100, 1)}
    if spread <= SPREAD_MID_MAX:
        return {"action": "mid", "limit": round(mid, 2), "spread_pct": round(spread * 100, 1)}
    return {"action": "skip", "limit": None, "spread_pct": round(spread * 100, 1)}


def pick_contract(rows: list, direction: str, trigger: float, target: float) -> "dict | None":
    """
    Zone-anchored contract choice from live chain rows
    ({symbol, strike, ask, bid, delta|None}):
      - affordable: ask within the largest size tier ($2.50)
      - tradeable spread: ≤ 30% (the gate decides ask vs mid later)
      - delta in 0.20–0.60 when the feed provides it; without delta (the
        indicative feed often omits greeks) the strike must sit between the
        trigger and the target, so it's OTM but not a lottery ticket
      - best = strike nearest the target zone + delta nearest its target
        (TP1% × premium / expected move)
    Returns the row plus its size tier and the selection numbers.
    """
    move = abs(target - trigger)
    if move <= 0:
        return None
    long_ = direction == "CALL"
    best, best_cost = None, None
    for r in rows:
        ask, bid = r.get("ask") or 0, r.get("bid") or 0
        tier = size_tier(ask) if ask > 0 else None
        if not tier:
            continue
        gate = spread_gate(bid, ask)
        if gate["action"] == "skip":
            continue
        strike = r["strike"]
        delta = r.get("delta")
        delta_target = max(DELTA_MIN, min(DELTA_MAX, tier["tp1_pct"] * ask / move))
        if delta:
            delta = abs(delta)
            if not DELTA_MIN <= delta <= DELTA_MAX:
                continue
            delta_cost = abs(delta - delta_target) / 0.4
        else:
            lo, hi = (trigger, target) if long_ else (target, trigger)
            if not lo <= strike <= hi:
                continue
            delta_cost = 0.5   # unknown — neutral penalty
        strike_cost = abs(strike - target) / move
        cost = strike_cost + delta_cost
        if best_cost is None or cost < best_cost:
            best, best_cost = {**r, "tier": tier, "delta_target": round(delta_target, 2),
                               "gate": gate, "expected_move": round(move, 2)}, cost
    return best


def play_guard(play: dict, *, brief_losses_today: int, open_brief_trades: int,
               orb_position_open: bool, now_t, max_losses: int = 2,
               max_open: int = 2) -> "tuple[str, bool] | None":
    """
    (reason, retry) when this play can't enter right now, else None.
    retry=True means the block is temporary — the max-open slots are full —
    so the play stays armed and re-checks on its next trigger bar; every
    other guard stands the play down for the day.
    """
    if brief_losses_today >= max_losses:
        return f"daily kill switch — {brief_losses_today} brief losses today", False
    if orb_position_open:
        return "an ORB strategy has an open position in this ticker", False
    if not in_entry_window(now_t):
        return "outside the 9:30–10:00 entry window", False
    if open_brief_trades >= max_open:
        return f"{open_brief_trades} brief trades already open (max {max_open}) — re-checking on the next trigger bar", True
    return None

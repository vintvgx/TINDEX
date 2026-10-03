"""
Morning-brief setup scoring — pure, no I/O.

For each ticker in the universe, `score_ticker` builds the best long or
short setup from the zone engine's scored zones and scores it 0-100:

  zone quality   25  trigger zone's own zone-engine score
  proximity      15  how close price already is to the trigger (≤0.3% full,
                     ≥2% none)
  reward         15  expected move to the target vs risk to the invalidation
  trend          15  daily trend agrees with the setup
  RSI            10  daily RSI in the healthy band for the direction (CALL
                     50-70, PUT 30-50); exhausted scores nothing
  pre-market     10  overnight gap in the setup's direction + where price sits
                     in the pre-market range
  prior day      10  where yesterday closed in its own range

A setup is long when the trigger is a resistance zone's top edge (1m close
above it) and short when it's a support zone's bottom edge. The target is the
next zone beyond the trigger, the invalidation the nearest opposite zone.
`rank_plays` picks the top 4 and labels a crowded single thesis.
"""

EARNINGS_BLOCK_DAYS = 2
TOP_N = 4
PROMISING_SCORE = 80

W_ZONE, W_PROX, W_REWARD, W_TREND, W_RSI, W_PM, W_PRIOR = 25, 15, 15, 15, 10, 10, 10


def _clamp(x, lo, hi):
    return max(lo, min(hi, x))


def _setup(direction: str, price: float, zones_above: list, zones_below: list) -> "dict | None":
    """Trigger / target / invalidation for one direction, or None if the
    zones don't give a complete setup (no trigger zone or no target)."""
    if direction == "CALL":
        ahead = sorted(zones_above, key=lambda z: z["low"])
        if not ahead:
            return None
        trig_zone = ahead[0]
        trigger = trig_zone["high"]
        beyond = [z for z in ahead[1:] if z["low"] > trigger]
        if not beyond:
            return None
        tgt_zone = beyond[0]
        behind = sorted(zones_below, key=lambda z: -z["high"])
        invalidation = behind[0]["low"] if behind else trig_zone["low"]
    else:
        ahead = sorted(zones_below, key=lambda z: -z["high"])
        if not ahead:
            return None
        trig_zone = ahead[0]
        trigger = trig_zone["low"]
        beyond = [z for z in ahead[1:] if z["high"] < trigger]
        if not beyond:
            return None
        tgt_zone = beyond[0]
        behind = sorted(zones_above, key=lambda z: z["low"])
        invalidation = behind[0]["high"] if behind else trig_zone["high"]
    target = (tgt_zone["low"] + tgt_zone["high"]) / 2
    return {"trigger_zone": trig_zone, "target_zone": tgt_zone, "trigger": round(trigger, 2),
            "target": round(target, 2), "invalidation": round(invalidation, 2)}


def score_setup(direction: str, inp: dict) -> "dict | None":
    """Score one direction's setup. `inp`: price, zones (list of
    {low, high, score, type}), trend ('Bullish'|'Bearish'|'Chop'|None),
    rsi (float|None), gap_pct, pm_high, pm_low, prior_day {high, low, close}."""
    price = inp["price"]
    zones = inp.get("zones") or []
    above = [z for z in zones if z["low"] > price or (z["low"] <= price <= z["high"] and direction == "CALL")]
    below = [z for z in zones if z["high"] < price or (z["low"] <= price <= z["high"] and direction == "PUT")]
    st = _setup(direction, price, above, below)
    if not st:
        return None
    long_ = direction == "CALL"
    trigger, target, invalidation = st["trigger"], st["target"], st["invalidation"]

    comp = {}
    comp["zone"] = W_ZONE * _clamp((st["trigger_zone"].get("score") or 0) / 100, 0, 1)

    dist_pct = abs(trigger - price) / price
    comp["proximity"] = W_PROX * _clamp((0.02 - dist_pct) / (0.02 - 0.003), 0, 1)

    move = abs(target - trigger)
    risk = abs(trigger - invalidation) or 1e-9
    move_pct = move / trigger
    rr = move / risk
    comp["reward"] = 0.0 if move_pct < 0.0025 else W_REWARD * _clamp(rr / 2, 0, 1)

    trend = inp.get("trend")
    agree = (trend == "Bullish") if long_ else (trend == "Bearish")
    comp["trend"] = W_TREND if agree else (W_TREND * 0.45 if trend == "Chop" else 0.0)

    rsi = inp.get("rsi")
    if rsi is None:
        comp["rsi"] = W_RSI * 0.3
    elif long_:
        comp["rsi"] = W_RSI if 50 <= rsi <= 70 else W_RSI * 0.5 if 40 <= rsi < 50 else 0.0 if rsi > 70 else W_RSI * 0.2
    else:
        comp["rsi"] = W_RSI if 30 <= rsi <= 50 else W_RSI * 0.5 if 50 < rsi <= 60 else 0.0 if rsi < 30 else W_RSI * 0.2

    gap = inp.get("gap_pct") or 0.0
    gap_pts = 6 if (gap > 0.3 if long_ else gap < -0.3) else 3 if abs(gap) <= 0.3 else 0
    pm_hi, pm_lo = inp.get("pm_high"), inp.get("pm_low")
    pos_pts = 2
    if pm_hi and pm_lo and pm_hi > pm_lo:
        where = (price - pm_lo) / (pm_hi - pm_lo)
        pos_pts = 4 if (where >= 0.66 if long_ else where <= 0.34) else 2 if 0.34 < where < 0.66 else 0
    comp["premarket"] = float(gap_pts + pos_pts)

    pd = inp.get("prior_day") or {}
    if pd.get("high") and pd.get("low") and pd["high"] > pd["low"]:
        cpos = (pd["close"] - pd["low"]) / (pd["high"] - pd["low"])
        strong = cpos >= 0.7 if long_ else cpos <= 0.3
        mid = 0.4 <= cpos <= 0.6 if long_ else 0.4 <= cpos <= 0.6
        comp["prior_day"] = W_PRIOR if strong else W_PRIOR * 0.5 if mid else 0.0
    else:
        comp["prior_day"] = W_PRIOR * 0.3

    score = round(sum(comp.values()), 1)
    return {
        "direction": direction,
        "score": score,
        "components": {k: round(v, 1) for k, v in comp.items()},
        "trigger": trigger,
        "target": target,
        "invalidation": invalidation,
        "expected_move": round(move, 2),
        "trigger_zone": {k: st["trigger_zone"].get(k) for k in ("low", "high", "score")},
        "target_zone": {k: st["target_zone"].get(k) for k in ("low", "high", "score")},
        "distance_to_trigger_pct": round(dist_pct * 100, 2),
        "reward_risk": round(rr, 2),
    }


def score_ticker(ticker: str, inp: dict) -> "dict | None":
    """Best setup for `ticker` (long or short), with its technicals and
    blocking reasons attached; None when neither direction has a setup."""
    best = None
    for d in ("CALL", "PUT"):
        s = score_setup(d, inp)
        if s and (best is None or s["score"] > best["score"]):
            best = s
    if not best:
        return None
    days = inp.get("earnings_in_days")
    blocked = None
    if days is not None and 0 <= days <= EARNINGS_BLOCK_DAYS:
        blocked = f"earnings in {days} day{'s' if days != 1 else ''}"
    return {
        "ticker": ticker,
        **best,
        "price": round(inp["price"], 2),
        "technicals": {"trend": inp.get("trend"), "rsi": round(inp["rsi"], 1) if inp.get("rsi") is not None else None,
                       "sector": inp.get("sector")},
        "gap_pct": round(inp.get("gap_pct") or 0.0, 2),
        "pm_high": inp.get("pm_high"),
        "pm_low": inp.get("pm_low"),
        "blocked": blocked,
    }


def rank_plays(scored: list, top_n: int = TOP_N) -> dict:
    """Top `top_n` unblocked plays by score, plus a one-thesis label when 3+
    of them share direction and sector."""
    eligible = sorted((p for p in scored if p and not p.get("blocked")), key=lambda p: -p["score"])
    top = eligible[:top_n]
    label = None
    groups: dict = {}
    for p in top:
        key = (p["direction"], (p.get("technicals") or {}).get("sector") or "Unknown")
        groups.setdefault(key, []).append(p["ticker"])
    for (direction, sector), names in groups.items():
        if len(names) >= 3:
            side = "long" if direction == "CALL" else "short"
            label = f"{len(names)} of {len(top)} plays are {side} {sector} ({', '.join(names)}) — one thesis; size accordingly."
    return {"plays": top, "correlation_label": label,
            "blocked": [{"ticker": p["ticker"], "reason": p["blocked"]} for p in scored if p and p.get("blocked")]}

"""
Paper-testing loop (TODO 8 part 3) — pure functions, no I/O.

Signal paths:
  A  pre-market level break — a morning-brief play's 1m trigger
  B  ORB breakout — an ORB strategy entry

Every signal resolves to a SETUP outcome from the underlying's 1m bars after
the signal (independent of whether/how the option traded):
  target_hit   reached the target before the invalidation
  stopped      reached the invalidation first (both in one bar → stopped;
               the conservative read)
  expired      neither by the close
and, when it traded, a TRADE result joined from orb_trades (pnl, pnl_pct).

`aggregate` builds the weekly review: by path, by zone-score bucket × path,
and (path A) by setup-score bucket.
"""

ZONE_BUCKETS = [(0, 60, "<60"), (60, 70, "60–69"), (70, 80, "70–79"), (80, 90, "80–89"), (90, 101, "90+")]


def bucket(score) -> str:
    if score is None:
        return "no zone"
    for lo, hi, label in ZONE_BUCKETS:
        if lo <= score < hi:
            return label
    return "90+"


def resolve_outcome(bars: list, direction: str, target: float, invalidation: float) -> dict:
    """
    bars: chronological [(ts, high, low, close)] strictly AFTER the signal.
    Returns {outcome, resolved_at (ts|None), mfe_pct, mae_pct} where mfe/mae
    are the best / worst underlying excursion from the first bar's open
    proxy (first close) in the setup's direction, as a percent.
    """
    long_ = direction == "CALL"
    if not bars:
        return {"outcome": None, "resolved_at": None, "mfe_pct": None, "mae_pct": None}
    ref = bars[0][3]
    best = worst = 0.0
    for ts, high, low, close in bars:
        fav = (high - ref) / ref if long_ else (ref - low) / ref
        adv = (low - ref) / ref if long_ else (ref - high) / ref
        best, worst = max(best, fav), min(worst, adv)
        hit_inv = low <= invalidation if long_ else high >= invalidation
        hit_tgt = high >= target if long_ else low <= target
        if hit_inv:
            return {"outcome": "stopped", "resolved_at": ts, "mfe_pct": round(best * 100, 2), "mae_pct": round(worst * 100, 2)}
        if hit_tgt:
            return {"outcome": "target_hit", "resolved_at": ts, "mfe_pct": round(best * 100, 2), "mae_pct": round(worst * 100, 2)}
    return {"outcome": "expired", "resolved_at": None, "mfe_pct": round(best * 100, 2), "mae_pct": round(worst * 100, 2)}


def orb_levels(direction: str, orh: float, orl: float, zones: list) -> dict:
    """
    Path B's setup levels so it resolves the same way as path A:
      trigger       the broken OR edge (ORH for calls, ORL for puts)
      invalidation  the opposite OR edge
      target        centre of the next zone beyond the trigger; without one,
                    a 1× range extension
      zone_score    score of a zone within 0.3% of the trigger (the breakout
                    is zone-backed), else None
    """
    long_ = direction == "CALL"
    trigger, invalidation = (orh, orl) if long_ else (orl, orh)
    rng = abs(orh - orl)
    beyond = sorted((z for z in zones if (z["low"] > trigger if long_ else z["high"] < trigger)),
                    key=lambda z: z["low"] if long_ else -z["high"])
    if beyond:
        target = (beyond[0]["low"] + beyond[0]["high"]) / 2
    else:
        target = trigger + rng if long_ else trigger - rng
    band = trigger * 0.003
    near = [z for z in zones if z["low"] - band <= trigger <= z["high"] + band]
    zone_score = max((z.get("score") or 0) for z in near) if near else None
    return {"trigger": round(trigger, 2), "invalidation": round(invalidation, 2),
            "target": round(target, 2), "zone_score": zone_score}


def _stats(rows: list) -> dict:
    traded = [r for r in rows if r.get("fill_status") == "filled" and r.get("pnl") is not None]
    resolved = [r for r in rows if r.get("outcome")]
    wins = [r for r in traded if r["pnl"] > 0]
    returns = [r["pnl_pct"] for r in traded if r.get("pnl_pct") is not None]

    def rate(n, d):
        return round(n / d * 100, 1) if d else None

    return {
        "signals": len(rows),
        "traded": len(traded),
        "fill_rate": rate(sum(1 for r in rows if r.get("fill_status") == "filled"),
                          sum(1 for r in rows if r.get("fill_status") in ("filled", "cancelled", "scratch"))),
        "win_rate": rate(len(wins), len(traded)),
        "avg_return_pct": round(sum(returns) / len(returns), 1) if returns else None,
        "total_pnl": round(sum(r["pnl"] for r in traded), 2),
        "target_hit_rate": rate(sum(1 for r in resolved if r["outcome"] == "target_hit"), len(resolved)),
        "stopped_rate": rate(sum(1 for r in resolved if r["outcome"] == "stopped"), len(resolved)),
        "expired_rate": rate(sum(1 for r in resolved if r["outcome"] == "expired"), len(resolved)),
    }


def aggregate(rows: list) -> dict:
    by_path = {p: _stats([r for r in rows if r.get("signal_path") == p]) for p in ("A", "B")}
    zone_order = [b[2] for b in ZONE_BUCKETS] + ["no zone"]
    by_zone = []
    for label in zone_order:
        for p in ("A", "B"):
            sub = [r for r in rows if r.get("signal_path") == p and bucket(r.get("zone_score")) == label]
            if sub:
                by_zone.append({"bucket": label, "path": p, **_stats(sub)})
    by_setup = []
    for label in zone_order[:-1]:
        sub = [r for r in rows if r.get("signal_path") == "A" and r.get("setup_score") is not None
               and bucket(r["setup_score"]) == label]
        if sub:
            by_setup.append({"bucket": label, **_stats(sub)})
    return {"overall": _stats(rows), "by_path": by_path, "by_zone_score": by_zone, "by_setup_score": by_setup}

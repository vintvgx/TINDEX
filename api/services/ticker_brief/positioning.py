"""
Options positioning as CONFLUENCE — never a trigger, never a veto.

The chain behind this is free and ~15 minutes delayed, IV is estimated, and
open interest can't reveal intent (every contract has a buyer and a seller).
So positioning only produces a modifier — +1 tailwind, 0 neutral, −1
headwind — plus display flags, and it never touches the Technicals Gate's
ENTER / WAIT / DON'T ENTER decision or its factor count. Stale inputs
(> 30 min old) fail OPEN: modifier 0 with a "positioning stale" note.

`positioning_inputs` is the spec's input table; `positioning_modifier` is
pure (no I/O) and direction-aware — every rule flips for puts.

Components (weight 0DTE / swing):
  walls vs target   HIGH / MEDIUM   target beyond the nearest wall in the
                                    trade's direction → −1 (and, on 0DTE, the
                                    `target_beyond_wall` flag); the opposite-
                                    side wall within 1% of a zone on the
                                    trade's protective side → +1
  max pain          HIGH / LOW      expiry day only: max pain ≥0.5% in the
                                    trade's direction → +1, against it → −1
  P/C volume        LOW / LOW       < 0.5 on a long → "call-crowded" caution
                                    flag only, never a modifier on its own
  P/C OI            MEDIUM / MEDIUM-HIGH   < 0.5 → −1 for new longs;
                                    > 1.0 → −1 for new shorts
  unusual ≥7 DTE    LOW / HIGH      unusual (vol/OI ≥ 1.2, vol ≥ 100) flow
                                    with ≥60% of its volume on the trade's
                                    side → +1, on the opposite side → −1
  IV estimate       info only       front-expiry IV > 80% → "expensive
                                    premium" note, not a modifier
Net = weighted sum of the component scores; +1 at ≥ 0.5, −1 at ≤ −0.5,
else 0 (so a LOW-weight component alone never moves it).
"""

import time
from datetime import date, datetime

import pytz

from services.ticker_brief.sections import (
    TTL_FLOW, _num, atm_iv, chain_contracts, max_pain, oi_walls,
)

ET = pytz.timezone("America/New_York")

STALE_SECONDS = 30 * 60
UNUSUAL_RATIO = 1.2
UNUSUAL_MIN_VOLUME = 100     # same floor as the positioning panel — filters 1-lot noise
UNUSUAL_MIN_DTE = 7
UNUSUAL_DOMINANCE = 0.6      # share of unusual ≥7 DTE volume one side needs to count
WALL_ZONE_PCT = 0.01
MAX_PAIN_PULL_PCT = 0.005
EXPENSIVE_IV_PCT = 80.0
CROWDED_PC_VOL = 0.5

HIGH, MED_HIGH, MEDIUM, LOW = 1.0, 0.8, 0.6, 0.3
WEIGHTS = {
    #               0DTE    swing
    "walls":      (HIGH,   MEDIUM),
    "max_pain":   (HIGH,   LOW),
    "pc_oi":      (MEDIUM, MED_HIGH),
    "unusual":    (LOW,    HIGH),
}


def positioning_inputs(symbol: str) -> tuple:
    """(inputs, fetched_at). inputs: pc_vol (front expiry), pc_oi (all
    fetched expiries), iv_est, max_pain, call_walls / put_walls (front 2
    expiries, same as the positioning panel), unusual (vol/OI ≥ 1.2)."""
    chain, fetched_at = chain_contracts(symbol)
    expiries, spot, contracts = chain["expiries"], chain["spot"], chain["contracts"]
    front = [c for c in contracts if c["expiry"] == expiries[0]]
    front2 = [c for c in contracts if c["expiry"] in expiries[:2]]

    def _ratio(rows, field):
        puts = sum((_num(c.get(field)) or 0) for c in rows if c["type"] == "put")
        calls = sum((_num(c.get(field)) or 0) for c in rows if c["type"] == "call")
        return round(puts / calls, 2) if calls > 0 else None

    # No usable OI at all (e.g. Yahoo's overnight zero-fill): a volume/OI
    # ratio is meaningless, so the unusual component stays out rather than
    # firing a bogus "unusual flow" tailwind/headwind on missing data.
    oi_available = any((_num(c.get("openInterest")) or 0) for c in contracts)
    unusual = []
    for c in contracts:
        vol = _num(c.get("volume")) or 0
        oi = _num(c.get("openInterest")) or 0
        if vol < UNUSUAL_MIN_VOLUME:
            continue
        if not oi_available:
            continue
        ratio = vol / max(oi, 1)
        if ratio >= UNUSUAL_RATIO:
            unusual.append({"strike": c["strike"], "type": c["type"], "expiry": c["expiry"],
                            "volume": int(vol), "open_interest": int(oi), "ratio": round(ratio, 2)})
    unusual.sort(key=lambda u: u["ratio"], reverse=True)

    walls = oi_walls(front2)
    return {
        "spot": spot,
        "front_expiry": expiries[0],
        "expiries": expiries,
        "pc_vol": _ratio(front, "volume"),
        "pc_oi": _ratio(contracts, "openInterest"),
        "iv_est": atm_iv(front, spot) if spot else None,
        "max_pain": max_pain(front),
        "call_walls": walls["call_wall"],
        "put_walls": walls["put_wall"],
        "unusual": unusual[:20],
    }, fetched_at


def _dte(expiry: str, today: date) -> int:
    return (date.fromisoformat(expiry) - today).days


def _fmt_day(expiry: str) -> str:
    d = date.fromisoformat(expiry)
    return d.strftime("%b ") + str(d.day)


def positioning_modifier(inputs: dict, direction: str, target: "float | None", zones: list,
                         is_0dte: bool, fetched_at: float, now: float = None,
                         today: date = None) -> dict:
    """
    Pure. `direction` CALL (long) / PUT (short). `target`: the trade's
    underlying target (the next zone in the trade's direction), or None.
    `zones`: zone-engine zones [{low, high, type}] for the wall/zone check.
    """
    now = now if now is not None else time.time()
    today = today or datetime.now(ET).date()
    long_ = direction.upper() == "CALL"
    flags = {"target_beyond_wall": False, "crowded_caution": False,
             "expensive_premium": False, "stale": False}
    notes = []

    iv = inputs.get("iv_est")
    if iv is not None and iv > EXPENSIVE_IV_PCT:
        flags["expensive_premium"] = True
        notes.append(f"Expensive premium — front-expiry IV ≈ {iv:.0f}%")

    if now - fetched_at > STALE_SECONDS:
        flags["stale"] = True
        return _result(0, 0.0, [], flags, notes, "Neutral — positioning stale (chain data over 30 min old)")

    spot = inputs.get("spot") or 0
    w_idx = 0 if is_0dte else 1
    parts = []   # (component, score, reason)

    # Walls vs target.
    wall_side = inputs.get("call_walls" if long_ else "put_walls") or []
    wall_label = "call wall" if long_ else "put wall"
    ahead = [w["strike"] for w in wall_side if (w["strike"] > spot if long_ else w["strike"] < spot)]
    nearest_wall = (min(ahead) if long_ else max(ahead)) if ahead else None
    if target is not None and nearest_wall is not None and (target > nearest_wall if long_ else target < nearest_wall):
        parts.append(("walls", -1, f"target ${target:.2f} beyond ${nearest_wall:.2f} {wall_label}"))
        if is_0dte:
            flags["target_beyond_wall"] = True
    else:
        guard_walls = inputs.get("put_walls" if long_ else "call_walls") or []
        guard_kind = "support" if long_ else "resistance"
        for w in guard_walls:
            k = w["strike"]
            if not (k < spot if long_ else k > spot):
                continue
            hit = next((z for z in zones if z.get("type") == guard_kind
                        and z["low"] * (1 - WALL_ZONE_PCT) <= k <= z["high"] * (1 + WALL_ZONE_PCT)), None)
            if hit:
                parts.append(("walls", +1, f"${k:.2f} {'put' if long_ else 'call'} wall lines up with "
                                           f"${hit['low']:.2f}–${hit['high']:.2f} {guard_kind}"))
                break

    # Max pain — expiry day only.
    mp = inputs.get("max_pain")
    if mp and spot and inputs.get("front_expiry") == today.isoformat():
        pull = (mp - spot) / spot
        if abs(pull) >= MAX_PAIN_PULL_PCT:
            toward = pull > 0 if long_ else pull < 0
            parts.append(("max_pain", +1 if toward else -1,
                          f"expiry-day max pain ${mp:.2f} {'in' if toward else 'against'} the trade's direction"))

    # P/C volume — caution flag only.
    pc_vol = inputs.get("pc_vol")
    if long_ and pc_vol is not None and pc_vol < CROWDED_PC_VOL:
        flags["crowded_caution"] = True
        notes.append(f"Caution — P/C vol {pc_vol:.2f}, call-crowded")

    # P/C OI.
    pc_oi = inputs.get("pc_oi")
    if pc_oi is not None:
        if long_ and pc_oi < 0.5:
            parts.append(("pc_oi", -1, f"P/C OI {pc_oi:.2f}, call-crowded — chasing"))
        elif not long_ and pc_oi > 1.0:
            parts.append(("pc_oi", -1, f"P/C OI {pc_oi:.2f}, put-crowded — chasing"))

    # Unusual flow, ≥ 7 DTE.
    # Decided by total unusual volume per side, not the single highest
    # ratio — a brand-new far-OTM strike (OI ≈ 0) would otherwise swing it.
    longer = [u for u in inputs.get("unusual") or [] if _dte(u["expiry"], today) >= UNUSUAL_MIN_DTE]
    call_vol = sum(u["volume"] for u in longer if u["type"] == "call")
    put_vol = sum(u["volume"] for u in longer if u["type"] == "put")
    total = call_vol + put_vol
    if total > 0 and max(call_vol, put_vol) / total >= UNUSUAL_DOMINANCE:
        side = "call" if call_vol > put_vol else "put"
        top = max((u for u in longer if u["type"] == side), key=lambda u: u["volume"])
        aligned = (side == "call") == long_
        parts.append(("unusual", +1 if aligned else -1,
                      f"unusual {side} flow ${top['strike']:g}{side[0].upper()} "
                      f"{_fmt_day(top['expiry'])} ({top['ratio']:.1f}×)"))

    weighted = sum(WEIGHTS[c][w_idx] * score for c, score, _ in parts)
    modifier = 1 if weighted >= 0.5 else -1 if weighted <= -0.5 else 0
    reasons = [{"component": c, "score": score, "weight": WEIGHTS[c][w_idx], "text": text}
               for c, score, text in parts]

    if modifier != 0:
        lead = max((r for r in reasons if r["score"] == modifier), key=lambda r: r["weight"])
        headline = f"{'Tailwind' if modifier > 0 else 'Headwind'} — {lead['text']}"
    elif flags["crowded_caution"]:
        headline = f"Caution — P/C vol {pc_vol:.2f}, call-crowded"
    else:
        headline = "Neutral — no positioning edge"
    return _result(modifier, weighted, reasons, flags, notes, headline)


def _result(modifier, weighted, reasons, flags, notes, headline):
    return {"modifier": modifier, "weighted_score": round(weighted, 2), "headline": headline,
            "reasons": reasons, "flags": flags, "notes": notes}


def trade_target(zones: list, spot: float, direction: str) -> "float | None":
    """The trade's underlying target: the next zone in its direction —
    nearest resistance above for a long (its lower edge), nearest support
    below for a short (its upper edge)."""
    if direction.upper() == "CALL":
        above = [z["low"] for z in zones if z["low"] > spot]
        return min(above) if above else None
    below = [z["high"] for z in zones if z["high"] < spot]
    return max(below) if below else None


def build_positioning(symbol: str, direction: str, expiry: "str | None", target: "float | None" = None):
    """Inputs + modifier for one trade context. `expiry` decides 0DTE vs
    swing weighting; `target` overrides the zone-derived one (tests)."""
    inputs, fetched_at = positioning_inputs(symbol)
    zones = []
    try:
        from services.strategy.zone_engine import zones as _zones
        snap = _zones(symbol)
        if not snap.get("error"):
            zones = snap.get("support", []) + snap.get("resistance", [])
    except Exception:
        pass
    today = datetime.now(ET).date()
    is_0dte = (expiry or "")[:10] == today.isoformat()
    spot = inputs.get("spot") or 0
    tgt = target if target is not None else (trade_target(zones, spot, direction) if spot else None)
    mod = positioning_modifier(inputs, direction, tgt, zones, is_0dte, fetched_at, today=today)
    data = {
        "direction": direction.upper(),
        "expiry": expiry,
        "is_0dte": is_0dte,
        "target": tgt,
        "inputs": inputs,
        **mod,
        "chain_as_of": datetime.fromtimestamp(fetched_at, tz=pytz.utc).isoformat(),
    }
    return data, TTL_FLOW, fetched_at

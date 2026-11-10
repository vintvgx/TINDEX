"""
Composite technicals score (TODO a3e2a3d9, quant review 2026-10-26).

The binary gate reads each indicator as pass/fail (RSI 47 = fail, same as
RSI 20). This scores seven indicators -2..+2 instead and sums them:

    Intraday RSI (5-min)   Daily RSI          MACD (5-min 12/26/9)
    Intraday trend (5-min EMA-20/50)          Daily trend (EMA-20/50)
    VWAP position          ORB position

Scores are computed bullish-positive, then sign-flipped for a PUT, so a
higher total always means "more in favour of THIS trade". Max |total| = 14.

Tiers (Muse's starting thresholds, not yet backtested — tune in TIERS):
    >= +6 STRONG · +4..+5 MODERATE (enter via confirm-first)
    +2..+3 WATCH · < +2 NO_TRADE

Turning signals are informational only — they never add to the total, so
the number on the card is always the plain sum of the seven rows.

Pure functions over pandas Series; entry_check_service fetches the data.
Every band below is a single table/constant so it can be tuned once the
backtest is in.
"""

from typing import Optional

import pandas as pd

# RSI bands (bullish-signed): value >= lo → score. First match wins.
RSI_BANDS = ((60, 2), (55, 1), (45, 0), (40, -1))      # below 40 → -2
RSI_OVERBOUGHT, RSI_OVERSOLD = 70, 30

# VWAP / ORB: beyond the level by this much (%) = ±2 instead of ±1.
STRONG_DISTANCE_PCT = 0.5

# 5-min bars needed: EMA-50 (trend) / 26+9 (MACD) / 15 (RSI-14).
MIN_BARS_TREND, MIN_BARS_MACD, MIN_BARS_RSI = 50, 35, 15

# Turning-signal lookbacks, in 5-min bars.
MACD_TURN_BARS = 3
EMA_CROSS_BARS = 6

TIERS = ((6, "STRONG"), (4, "MODERATE"), (2, "WATCH"))  # below → NO_TRADE
MAX_SCORE = 14

ORDER = ("rsi_intraday", "rsi_daily", "macd", "trend_intraday", "trend_daily", "vwap", "orb")
LABELS = {
    "rsi_intraday":   "Intraday RSI",
    "rsi_daily":      "Daily RSI",
    "macd":           "MACD",
    "trend_intraday": "Intraday Trend",
    "trend_daily":    "Daily Trend",
    "vwap":           "VWAP",
    "orb":            "ORB",
}


# ── Series math ────────────────────────────────────────────────────────────────

def wilder_rsi(closes: pd.Series, period: int = 14) -> pd.Series:
    """Wilder's RSI — same smoothing as entry_check_service._trend_and_rsi."""
    delta = closes.diff()
    gain = delta.clip(lower=0).ewm(alpha=1 / period, adjust=False, min_periods=period).mean()
    loss = (-delta.clip(upper=0)).ewm(alpha=1 / period, adjust=False, min_periods=period).mean()
    rs = gain / loss.replace(0, float("nan"))
    rsi = 100 - 100 / (1 + rs)
    # No losses in the window → RSI 100 (or 50 when flat), like the gate.
    return rsi.where(~rs.isna(), (gain > 0).map({True: 100.0, False: 50.0}))


def ema(closes: pd.Series, span: int) -> pd.Series:
    return closes.ewm(span=span, adjust=False).mean()


def trend_label(price: float, ema20: float, ema50: Optional[float]) -> str:
    """Same rule as the gate's daily trend: aligned EMAs AND price on that side."""
    if ema50 is None:
        return "Chop"
    if ema20 > ema50 and price > ema20:
        return "Bullish"
    if ema20 < ema50 and price < ema20:
        return "Bearish"
    return "Chop"


def intraday_trend_rsi(closes_5m: Optional[pd.Series], price: float) -> tuple[Optional[dict], Optional[dict]]:
    """
    (trend_row, rsi_row) on 5-min closes, shaped like the daily rows so
    compute_verdict's pass rules apply unchanged. None when there aren't
    enough bars for that indicator.
    """
    if closes_5m is None or len(closes_5m) < MIN_BARS_RSI:
        return None, None
    s = _with_price(closes_5m, price)
    rsi_v = float(wilder_rsi(s).iloc[-1])
    rsi_row = {
        "value": round(rsi_v, 1),
        "zone": "Overbought" if rsi_v > RSI_OVERBOUGHT else "Oversold" if rsi_v < RSI_OVERSOLD else "Neutral",
        "timeframe": "5m",
    }
    trend_row = None
    if len(s) >= MIN_BARS_TREND:
        e20, e50 = float(ema(s, 20).iloc[-1]), float(ema(s, 50).iloc[-1])
        trend_row = {"label": trend_label(price, e20, e50), "price": round(price, 2),
                     "ema20": round(e20, 2), "ema50": round(e50, 2), "ema200": None, "timeframe": "5m"}
    return trend_row, rsi_row


def _daily_with_price(closes: pd.Series, price: float) -> pd.Series:
    """Daily closes with the live price as today's bar: replaces today's
    partial bar when Yahoo already has one, else appends — so iloc[-2] is
    always yesterday's close (same handling as the gate's _trend_and_rsi)."""
    from datetime import datetime
    import pytz
    d = closes.dropna().astype(float).copy()
    last_idx = d.index[-1]
    last_date = last_idx.date() if hasattr(last_idx, "date") else None
    values = list(d.values)
    if last_date == datetime.now(pytz.timezone("America/New_York")).date():
        values[-1] = price
    else:
        values.append(price)
    return pd.Series(values, dtype=float)


def _with_price(closes: pd.Series, price: float) -> pd.Series:
    s = closes.dropna().astype(float).reset_index(drop=True).copy()
    if len(s):
        s.iloc[-1] = price
    return s


# ── Per-indicator scores (bullish-signed) ──────────────────────────────────────

def _rsi_score(v: float) -> int:
    for lo, score in RSI_BANDS:
        if v >= lo:
            return score
    return -2


def _rsi_desc(v: float) -> str:
    if v > RSI_OVERBOUGHT:
        return "Overbought"
    if v >= 60:
        return "Strong momentum"
    if v >= 55:
        return "Bullish lean"
    if v > 45:
        return "Neutral"
    if v > 40:
        return "Bearish lean"
    if v >= RSI_OVERSOLD:
        return "Weak momentum"
    return "Oversold"


def _trend_score(label: str) -> int:
    return {"Bullish": 2, "Bearish": -2}.get(label, 0)


def _distance_score(position_sign: int, distance_pct: Optional[float]) -> int:
    if position_sign == 0:
        return 0
    strong = distance_pct is not None and abs(distance_pct) >= STRONG_DISTANCE_PCT
    return position_sign * (2 if strong else 1)


def _row(key: str, score: Optional[int], value: str, detail: str) -> dict:
    return {"key": key, "label": LABELS[key], "score": score, "value": value, "detail": detail,
            "available": score is not None}


def _tier(total: int) -> str:
    for lo, name in TIERS:
        if total >= lo:
            return name
    return "NO_TRADE"


# ── Entry point ────────────────────────────────────────────────────────────────

def compute_composite(direction: str, price: float,
                      daily_closes: Optional[pd.Series] = None,
                      closes_5m: Optional[pd.Series] = None,
                      vwap: Optional[float] = None,
                      orh: Optional[float] = None, orl: Optional[float] = None,
                      orb_forming: bool = False) -> dict:
    """
    daily_closes: daily closes, today's bar either absent or stale — the
    live price is applied here (same as the gate). closes_5m: 5-min closes,
    oldest first, may span several sessions (EMA-50 needs ~4h of bars).
    Missing inputs score 0 and are listed in `missing` (never guessed).
    """
    is_call = direction.upper() == "CALL"
    sign = 1 if is_call else -1
    rows: dict[str, dict] = {}
    turning: list[dict] = []

    # ── Daily RSI + trend ───────────────────────────────────────────────────
    d_rsi = d_rsi_prev = None
    d_trend = None
    if daily_closes is not None and len(daily_closes) >= 22:
        d = _daily_with_price(daily_closes, price)
        rsi_s = wilder_rsi(d)
        d_rsi, d_rsi_prev = float(rsi_s.iloc[-1]), float(rsi_s.iloc[-2])
        e20 = float(ema(d, 20).iloc[-1])
        e50 = float(ema(d, 50).iloc[-1]) if len(d) >= 50 else None
        d_trend = {"label": trend_label(price, e20, e50), "ema20": e20, "ema50": e50}

    if d_rsi is not None:
        arrow = " ↗" if d_rsi > d_rsi_prev + 0.5 else " ↘" if d_rsi < d_rsi_prev - 0.5 else ""
        rows["rsi_daily"] = _row("rsi_daily", _rsi_score(d_rsi), f"{d_rsi:.0f}{arrow}",
                                 f"{d_rsi:.0f} — {_rsi_desc(d_rsi)}"
                                 + (", but rising ↗" if arrow == " ↗" and d_rsi < 55
                                    else ", but falling ↘" if arrow == " ↘" and d_rsi > 45 else ""))
    else:
        rows["rsi_daily"] = _row("rsi_daily", None, "—", "Not enough daily bars")

    if d_trend:
        lbl = d_trend["label"]
        rel = "above" if price > d_trend["ema20"] else "below"
        detail = (f"EMA-20 {'above' if d_trend['ema50'] and d_trend['ema20'] > d_trend['ema50'] else 'below'} "
                  f"EMA-50, price {rel} EMA-20" if lbl != "Chop"
                  else f"Chop — price {rel} daily EMA-20 (${d_trend['ema20']:.2f})")
        rows["trend_daily"] = _row("trend_daily", _trend_score(lbl), lbl, detail)
    else:
        rows["trend_daily"] = _row("trend_daily", None, "—", "Not enough daily bars")

    # ── 5-min RSI / trend / MACD ────────────────────────────────────────────
    s5 = _with_price(closes_5m, price) if closes_5m is not None and len(closes_5m) else None
    n5 = len(s5) if s5 is not None else 0

    if n5 >= MIN_BARS_RSI:
        i_rsi = float(wilder_rsi(s5).iloc[-1])
        rows["rsi_intraday"] = _row("rsi_intraday", _rsi_score(i_rsi), f"{i_rsi:.0f}",
                                    f"{i_rsi:.0f} — {_rsi_desc(i_rsi)}")
    else:
        i_rsi = None
        rows["rsi_intraday"] = _row("rsi_intraday", None, "—", f"Not enough 5-min bars ({n5}/{MIN_BARS_RSI})")

    e20_5 = e50_5 = None
    if n5 >= MIN_BARS_TREND:
        e20_s, e50_s = ema(s5, 20), ema(s5, 50)
        e20_5, e50_5 = float(e20_s.iloc[-1]), float(e50_s.iloc[-1])
        lbl = trend_label(price, e20_5, e50_5)
        if lbl == "Chop":
            detail = f"Chop — EMA-20 {'above' if e20_5 > e50_5 else 'below'} EMA-50, price {'above' if price > e20_5 else 'below'} EMA-20"
        else:
            side = "above" if lbl == "Bullish" else "below"
            detail = f"EMA-20 {side} EMA-50, price {side} both"
        rows["trend_intraday"] = _row("trend_intraday", _trend_score(lbl), lbl, detail)
        # Turning: EMA-20 crossed EMA-50 toward this trade in the last few bars.
        diff = (e20_s - e50_s).iloc[-(EMA_CROSS_BARS + 1):]
        crossed_up = (diff.iloc[0] <= 0 < diff.iloc[-1])
        crossed_dn = (diff.iloc[0] >= 0 > diff.iloc[-1])
        if (crossed_up and is_call) or (crossed_dn and not is_call):
            turning.append({"kind": "turning", "title": "5-min trend just flipped",
                            "text": f"EMA-20 crossed {'above' if is_call else 'below'} EMA-50 in the last "
                                    f"{EMA_CROSS_BARS * 5} minutes."})
    else:
        rows["trend_intraday"] = _row("trend_intraday", None, "—", f"Not enough 5-min bars ({n5}/{MIN_BARS_TREND})")

    if n5 >= MIN_BARS_MACD:
        macd = ema(s5, 12) - ema(s5, 26)
        sig = ema(macd, 9)
        hist = macd - sig
        m, sg, h = float(macd.iloc[-1]), float(sig.iloc[-1]), float(hist.iloc[-1])
        h_prev = float(hist.iloc[-2])
        if m > sg:
            score = 2 if m > 0 else 1
        elif m < sg:
            score = -2 if m < 0 else -1
        else:
            score = 0
        rising = h > h_prev
        value = "Bullish" if score > 0 else "Bearish" if score < 0 else "Flat"
        detail = (f"{'Above' if m > sg else 'Below' if m < sg else 'On'} signal"
                  f"{', above zero' if m > 0 and score == 2 else ', below zero' if m < 0 and score == -2 else ''}"
                  f", histogram {'rising' if rising else 'falling'}")
        rows["macd"] = _row("macd", score, value, detail)
        recent = hist.iloc[-(MACD_TURN_BARS + 1):]
        turned_pos = recent.iloc[0] <= 0 < recent.iloc[-1]
        turned_neg = recent.iloc[0] >= 0 > recent.iloc[-1]
        if (turned_pos and is_call) or (turned_neg and not is_call):
            turning.append({"kind": "turning",
                            "title": f"MACD histogram turning {'positive' if is_call else 'negative'}",
                            "text": f"momentum is accelerating {'upward' if is_call else 'downward'} on the 5-min."})
    else:
        rows["macd"] = _row("macd", None, "—", f"Not enough 5-min bars ({n5}/{MIN_BARS_MACD})")

    # ── VWAP / ORB ──────────────────────────────────────────────────────────
    if vwap:
        dist = (price - vwap) / vwap * 100
        pos = 1 if price > vwap else -1 if price < vwap else 0
        rows["vwap"] = _row("vwap", _distance_score(pos, dist),
                            "Above" if pos > 0 else "Below" if pos < 0 else "At",
                            f"Price ${price:.2f} {'above' if pos > 0 else 'below' if pos < 0 else 'at'} VWAP ${vwap:.2f}")
    else:
        rows["vwap"] = _row("vwap", None, "—", "No session VWAP yet")

    if orb_forming:
        rows["orb"] = _row("orb", None, "Forming", "Opening range still forming (locks 9:45 ET)")
    elif orh is not None and orl is not None:
        if price > orh:
            rows["orb"] = _row("orb", _distance_score(1, (price - orh) / orh * 100), "Above high",
                               f"Price above ORB high ${orh:.2f}")
        elif price < orl:
            rows["orb"] = _row("orb", _distance_score(-1, (price - orl) / orl * 100), "Below low",
                               f"Price below ORB low ${orl:.2f}")
        else:
            rows["orb"] = _row("orb", 0, "Inside", f"Inside the range ${orl:.2f}–${orh:.2f}")
    else:
        rows["orb"] = _row("orb", None, "—", "No opening range yet")

    # ── Direction sign + total ──────────────────────────────────────────────
    for r in rows.values():
        if r["score"] is not None:
            r["score"] = r["score"] * sign
    total = sum(r["score"] for r in rows.values() if r["score"] is not None)
    tier = _tier(total)

    # ── Turning signals / caveats that need the final numbers ───────────────
    if d_rsi is not None and d_rsi_prev is not None:
        if is_call and d_rsi < 50 and d_rsi > d_rsi_prev + 0.5:
            turning.insert(0, {"kind": "turning", "title": "Daily RSI recovering",
                               "text": f"rose from {d_rsi_prev:.0f} → {d_rsi:.0f} since yesterday's close. "
                                       f"Still below 50, but daily momentum is turning, not deteriorating."})
        elif not is_call and d_rsi > 50 and d_rsi < d_rsi_prev - 0.5:
            turning.insert(0, {"kind": "turning", "title": "Daily RSI rolling over",
                               "text": f"fell from {d_rsi_prev:.0f} → {d_rsi:.0f} since yesterday's close. "
                                       f"Still above 50, but daily momentum is turning down."})
    if d_trend and rows["trend_daily"]["score"] is not None and rows["trend_daily"]["score"] <= 0 and total >= 4:
        rel = "below" if price < d_trend["ema20"] else "above"
        turning.append({"kind": "caveat", "title": f"Daily trend {'still chop' if d_trend['label'] == 'Chop' else 'against you'}",
                        "text": f"price (${price:.2f}) is {rel} daily EMA-20 (${d_trend['ema20']:.2f}). "
                                f"The daily trend hasn't confirmed — this is a turning setup, not a confirmed daily trend."})
    for rsi_v, name in ((i_rsi, "Intraday RSI"), (d_rsi, "Daily RSI")):
        if rsi_v is None:
            continue
        if is_call and rsi_v > RSI_OVERBOUGHT:
            turning.append({"kind": "caveat", "title": f"{name} overbought",
                            "text": f"{rsi_v:.0f} — buying calls here is chasing; a pullback entry is safer."})
        elif not is_call and rsi_v < RSI_OVERSOLD:
            turning.append({"kind": "caveat", "title": f"{name} oversold",
                            "text": f"{rsi_v:.0f} — buying puts here is chasing the drop."})

    return {
        "direction": "CALL" if is_call else "PUT",
        "total": total,
        "max": MAX_SCORE,
        "tier": tier,
        "indicators": [rows[k] for k in ORDER],
        "turning": turning,
        "missing": [rows[k]["label"] for k in ORDER if rows[k]["score"] is None],
    }

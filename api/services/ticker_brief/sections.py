"""
Ticker Brief sections — one builder per section of the app's ticker sheet.

Each `build_<section>(symbol)` returns `(data, ttl_seconds, fetched_at)` and
raises on upstream failure; routes/ticker_brief_routes.py wraps every one in
the same envelope and turns a failure into an inline "unavailable" (never a
500). Anything a source didn't provide comes back as None — the app renders
None as "unavailable" rather than guessing.

The options-positioning math (`chain_stats` and helpers) is pure and works
on plain contract dicts so it can be unit-tested without yfinance. It's an
open-interest-based estimate from the free, delayed chain — not a live
flow feed.
"""

import math
import time
from datetime import date, datetime

import pytz

from services.ticker_brief.fetch import cached, yf_info, yf_ticker

ET = pytz.timezone("America/New_York")

TTL_PRICE = 60
TTL_SUMMARY = 30 * 86400
TTL_LEVELS = 90
TTL_FLOW = 15 * 60
TTL_ANALYSTS = 86400
TTL_INSTITUTIONAL = 7 * 86400
TTL_MOMENTUM = 86400

UNUSUAL_MIN_VOLUME = 100
UNUSUAL_TOP_N = 5
ATM_BAND_PCT = 0.05
WALLS_TOP_N = 3


def _num(v):
    """float, or None for missing/NaN/inf."""
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) else None


def _round(v, nd=2):
    f = _num(v)
    return round(f, nd) if f is not None else None


# ── Snapshot ────────────────────────────────────────────────────────────────

def build_snapshot(symbol: str):
    def _price():
        fi = yf_ticker(symbol).fast_info
        last = _num(fi.last_price)
        if last is None:
            raise RuntimeError("no last price")
        prev = _num(fi.previous_close)
        return {
            "price": round(last, 2),
            "previous_close": _round(prev),
            "change": round(last - prev, 2) if prev else None,
            "change_pct": round((last - prev) / prev * 100, 2) if prev else None,
            "market_cap": _num(getattr(fi, "market_cap", None)),
        }
    price, fetched_at = cached(f"price:{symbol}", TTL_PRICE, _price)

    # Name/summary/sector change rarely — 30-day cache. A failure here
    # degrades those fields to None instead of failing the whole snapshot.
    try:
        info = yf_info(symbol, TTL_SUMMARY)
    except Exception:
        info = {}
    data = {
        **price,
        "name": info.get("longName") or info.get("shortName"),
        "summary": info.get("longBusinessSummary"),
        "sector": info.get("sector"),
        "industry": info.get("industry"),
    }
    if data["market_cap"] is None:
        data["market_cap"] = _num(info.get("marketCap"))
    return data, TTL_PRICE, fetched_at


# ── Trade levels (zone engine) ──────────────────────────────────────────────

def nearest_zones(zone_list: list, price: float) -> dict:
    """Nearest zone above and below `price` with distance %, from the zone
    engine's top zones. A zone containing price counts as both 'inside'."""
    above = [z for z in zone_list if z["low"] > price]
    below = [z for z in zone_list if z["high"] < price]
    inside = [z for z in zone_list if z["low"] <= price <= z["high"]]

    def _fmt(z, dist):
        return {**_zone_row(z), "distance_pct": round(dist / price * 100, 2)} if z else None

    up = min(above, key=lambda z: z["low"] - price, default=None)
    dn = max(below, key=lambda z: z["high"], default=None)
    return {
        "above": _fmt(up, up["low"] - price) if up else None,
        "below": _fmt(dn, price - dn["high"]) if dn else None,
        "inside": _zone_row(inside[0]) if inside else None,
    }


def _zone_row(z: dict) -> dict:
    return {"low": z["low"], "high": z["high"], "score": z["score"], "touches": z["touches"],
            "type": z["type"], "sources": z.get("sources", [])}


def build_levels(symbol: str):
    from services.strategy.zone_engine import zones as _zones
    snap = _zones(symbol)
    if snap.get("error"):
        raise RuntimeError(snap["error"])
    price = snap["current_price"]
    support = [_zone_row(z) for z in snap.get("support", [])]
    resistance = [_zone_row(z) for z in snap.get("resistance", [])]
    data = {
        "price": price,
        "support": support,          # top 3 by score
        "resistance": resistance,    # top 3 by score
        **nearest_zones(snap.get("support", []) + snap.get("resistance", []), price),
        "zone_stale": bool(snap.get("stale")),
    }
    return data, TTL_LEVELS, time.time()


# ── Options positioning (OI-based estimate) ─────────────────────────────────

def pc_ratios(contracts: list) -> dict:
    def _sum(kind, field):
        return sum((_num(c.get(field)) or 0) for c in contracts if c["type"] == kind)
    call_vol, put_vol = _sum("call", "volume"), _sum("put", "volume")
    call_oi, put_oi = _sum("call", "openInterest"), _sum("put", "openInterest")
    return {
        "pc_volume": round(put_vol / call_vol, 2) if call_vol > 0 else None,
        "pc_oi": round(put_oi / call_oi, 2) if call_oi > 0 else None,
        "call_volume": int(call_vol), "put_volume": int(put_vol),
        "call_oi": int(call_oi), "put_oi": int(put_oi),
    }


def unusual_contracts(contracts: list, min_volume: int = UNUSUAL_MIN_VOLUME, top_n: int = UNUSUAL_TOP_N) -> list:
    """score = volume / max(OI, 1); volume >= min_volume; top N by score."""
    rows = []
    for c in contracts:
        vol = _num(c.get("volume")) or 0
        if vol < min_volume:
            continue
        oi = _num(c.get("openInterest")) or 0
        rows.append({
            "strike": c["strike"], "type": c["type"], "expiry": c["expiry"],
            "volume": int(vol), "open_interest": int(oi),
            "vol_oi": round(vol / max(oi, 1), 2),
        })
    rows.sort(key=lambda r: r["vol_oi"], reverse=True)
    return rows[:top_n]


def atm_iv(front: list, spot: float, band: float = ATM_BAND_PCT):
    """Mean implied volatility (%) of front-expiry contracts within ±band of
    spot; None when there are none with a usable IV."""
    ivs = [
        _num(c.get("impliedVolatility")) for c in front
        if abs(c["strike"] - spot) / spot <= band
    ]
    ivs = [v for v in ivs if v is not None and v > 0]
    return round(sum(ivs) / len(ivs) * 100, 1) if ivs else None


def max_pain(front: list):
    """S* = argmin over strikes of Σ_call OI·max(S−K,0) + Σ_put OI·max(K−S,0)."""
    strikes = sorted({c["strike"] for c in front})
    if not strikes:
        return None
    calls = [(c["strike"], _num(c.get("openInterest")) or 0) for c in front if c["type"] == "call"]
    puts = [(c["strike"], _num(c.get("openInterest")) or 0) for c in front if c["type"] == "put"]

    def pain(s):
        return (sum(oi * max(s - k, 0) for k, oi in calls)
                + sum(oi * max(k - s, 0) for k, oi in puts))
    return min(strikes, key=pain)


def oi_walls(contracts: list, top_n: int = WALLS_TOP_N) -> dict:
    """Top strikes by summed OI, separately for calls and puts."""
    def _top(kind):
        by_strike: dict = {}
        for c in contracts:
            if c["type"] == kind:
                by_strike[c["strike"]] = by_strike.get(c["strike"], 0) + (_num(c.get("openInterest")) or 0)
        top = sorted(by_strike.items(), key=lambda kv: kv[1], reverse=True)[:top_n]
        return [{"strike": k, "open_interest": int(v)} for k, v in top if v > 0]
    return {"call_wall": _top("call"), "put_wall": _top("put")}


def chain_stats(contracts: list, front_expiry: str, spot: float) -> dict:
    """Everything the positioning block shows. `contracts` covers the
    nearest 1-2 expiries; front-expiry-only stats use `front_expiry`."""
    front = [c for c in contracts if c["expiry"] == front_expiry]
    return {
        **pc_ratios(contracts),
        "unusual": unusual_contracts(contracts),
        "atm_iv_pct": atm_iv(front, spot) if spot else None,
        "max_pain": max_pain(front),
        **oi_walls(contracts),
    }


def build_flow(symbol: str):
    def _fetch():
        tk = yf_ticker(symbol)
        expiries = list(tk.options or [])[:2]
        if not expiries:
            raise RuntimeError("no listed options")
        spot = _num(tk.fast_info.last_price)
        contracts = []
        for exp in expiries:
            chain = tk.option_chain(exp)
            for kind, df in (("call", chain.calls), ("put", chain.puts)):
                for _, r in df.iterrows():
                    strike = _num(r.get("strike"))
                    if strike is None:
                        continue
                    contracts.append({
                        "type": kind, "expiry": exp, "strike": strike,
                        "volume": r.get("volume"), "openInterest": r.get("openInterest"),
                        "impliedVolatility": r.get("impliedVolatility"),
                    })
        return {
            "expiries": expiries,
            "spot": _round(spot),
            **chain_stats(contracts, expiries[0], spot or 0),
        }
    data, fetched_at = cached(f"flow:{symbol}", TTL_FLOW, _fetch)
    return data, TTL_FLOW, fetched_at


# ── Analysts ────────────────────────────────────────────────────────────────

_ACTION_LABELS = {"up": "Upgrade", "down": "Downgrade", "init": "Initiated",
                  "main": "Maintained", "reit": "Reiterated"}


def build_analysts(symbol: str):
    info = yf_info(symbol, TTL_ANALYSTS)

    def _changes():
        df = yf_ticker(symbol).upgrades_downgrades
        rows = []
        if df is None or df.empty:
            return rows
        df = df.sort_index(ascending=False).head(3)
        for ts, r in df.iterrows():
            action = str(r.get("Action") or "").lower()
            from_g, to_g = (r.get("FromGrade") or "").strip(), (r.get("ToGrade") or "").strip()
            rows.append({
                "date": ts.date().isoformat() if hasattr(ts, "date") else str(ts)[:10],
                "firm": r.get("Firm"),
                "action": _ACTION_LABELS.get(action, action.title() or None),
                "grade": f"{from_g} → {to_g}" if from_g and to_g and from_g != to_g else (to_g or None),
            })
        return rows
    try:
        changes, _ = cached(f"updowns:{symbol}", TTL_ANALYSTS, _changes)
    except Exception:
        changes = None

    rec = info.get("recommendationKey")
    data = {
        "recommendation": rec.replace("_", " ").title() if isinstance(rec, str) and rec != "none" else None,
        "target_mean": _round(info.get("targetMeanPrice")),
        "analyst_count": int(info["numberOfAnalystOpinions"]) if _num(info.get("numberOfAnalystOpinions")) else None,
        "recent_changes": changes,
    }
    return data, TTL_ANALYSTS, time.time()


# ── Institutional ───────────────────────────────────────────────────────────

def build_institutional(symbol: str):
    def _fetch():
        tk = yf_ticker(symbol)
        df = tk.institutional_holders
        if df is None or df.empty:
            raise RuntimeError("no institutional holders")
        top = []
        for _, r in df.head(3).iterrows():
            pct = _num(r.get("pctHeld"))
            top.append({"holder": r.get("Holder"), "pct_out": round(pct * 100, 2) if pct is not None else None,
                        "shares": int(r["Shares"]) if _num(r.get("Shares")) else None,
                        "reported": str(r.get("Date Reported"))[:10] if r.get("Date Reported") is not None else None})

        # Ownership trend: yfinance has no quarter-by-quarter institutional
        # total, but each top-10 holder row carries `pctChange` vs its prior
        # 13F. Combined top-10 shares now vs implied prior = an honest
        # "latest vs prior quarter" read for the largest holders.
        trend = None
        if "pctChange" in df.columns and "Shares" in df.columns:
            now_total = prior_total = 0.0
            for _, r in df.iterrows():
                shares, chg = _num(r.get("Shares")), _num(r.get("pctChange"))
                if shares is None or chg is None or chg <= -1:
                    continue
                now_total += shares
                prior_total += shares / (1 + chg)
            if prior_total > 0:
                trend = {"top_holders_change_pct": round((now_total / prior_total - 1) * 100, 2),
                         "holders_counted": int(len(df))}

        inst_pct = None
        try:
            mh = tk.major_holders
            if mh is not None and not mh.empty and "Value" in mh.columns and "institutionsPercentHeld" in mh.index:
                inst_pct = round(float(mh.loc["institutionsPercentHeld", "Value"]) * 100, 2)
        except Exception:
            pass
        return {"top_holders": top, "trend": trend, "institutions_pct_held": inst_pct}
    data, fetched_at = cached(f"inst:{symbol}", TTL_INSTITUTIONAL, _fetch)
    return data, TTL_INSTITUTIONAL, fetched_at


# ── Catalysts / momentum ────────────────────────────────────────────────────

def momentum_line(ret_20d, spy_20d, vol_5d, vol_20d) -> "str | None":
    """One templated line from computed numbers only."""
    parts = []
    if ret_20d is not None and spy_20d is not None:
        rel = ret_20d - spy_20d
        parts.append(f"20-day return {ret_20d:+.1f}% vs SPY {spy_20d:+.1f}% "
                     f"({'outperforming' if rel >= 0 else 'underperforming'} by {abs(rel):.1f} pts)")
    if vol_5d and vol_20d:
        ratio = vol_5d / vol_20d
        trend = "rising" if ratio >= 1.15 else "falling" if ratio <= 0.85 else "steady"
        parts.append(f"volume {trend} (5-day avg {ratio:.2f}x the 20-day)")
    if not parts:
        return None
    line = "; ".join(parts)
    return line[0].upper() + line[1:] + "."


def build_momentum(symbol: str):
    def _fetch():
        h = yf_ticker(symbol).history(period="2mo", interval="1d")
        spy = yf_ticker("SPY").history(period="2mo", interval="1d")
        if h is None or len(h) < 21:
            raise RuntimeError("not enough daily history")

        def _ret(df):
            if df is None or len(df) < 21:
                return None
            return (float(df["Close"].iloc[-1]) / float(df["Close"].iloc[-21]) - 1) * 100
        ret_20d, spy_20d = _ret(h), _ret(spy)
        vol_5d = float(h["Volume"].tail(5).mean())
        vol_20d = float(h["Volume"].tail(20).mean())
        return {
            "return_20d_pct": _round(ret_20d), "spy_return_20d_pct": _round(spy_20d),
            "volume_5d_vs_20d": round(vol_5d / vol_20d, 2) if vol_20d else None,
            "line": momentum_line(ret_20d, spy_20d, vol_5d, vol_20d),
        }
    data, fetched_at = cached(f"momentum:{symbol}", TTL_MOMENTUM, _fetch)
    return data, TTL_MOMENTUM, fetched_at


def next_earnings(symbol: str):
    """Next earnings date (ISO) from yfinance, or None."""
    def _fetch():
        tk = yf_ticker(symbol)
        today = datetime.now(ET).date()
        try:
            df = tk.get_earnings_dates(limit=8)
            if df is not None and not df.empty:
                upcoming = sorted(d.date() for d in df.index if d.date() >= today)
                if upcoming:
                    return upcoming[0].isoformat()
        except Exception:
            pass
        cal = tk.calendar or {}
        dates = cal.get("Earnings Date") if isinstance(cal, dict) else None
        if dates:
            upcoming = sorted(d for d in dates if isinstance(d, date) and d >= today)
            if upcoming:
                return upcoming[0].isoformat()
        return ""   # known: none scheduled (cached; distinct from a failure)
    value, _ = cached(f"earnings:{symbol}", TTL_ANALYSTS, _fetch)
    return value or None

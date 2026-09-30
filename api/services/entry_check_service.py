"""
Pre-entry technicals gate for the trade entry sheet (TradeContractSheet /
SignalEnterSheet): five rows — Trend, RSI-14, VWAP, ORB, Sector vs SPY — plus
an ENTER / WAIT / DON'T ENTER verdict for a CALL or PUT on the ticker.

Why this exists: the entry sheet used to go from "saw a contract" to a live
market buy in one tap with zero technical context, and the trade log showed
the cost of that (impulsive Discord-tip entries, overbought chase entries).
The verdict is deliberately opinionated and the mobile sheet gates the buy
button on it — see the rules in compute_verdict().

Data:
  - Daily bars (2y) for EMA-20/50/200 + RSI-14 — EMAs match
    technical_service.get_technicals(); RSI uses Wilder's smoothing (what
    TradingView/Robinhood show), unlike technical_service's simple-mean RSI.
    The latest close is REPLACED with the live price so RSI moves intraday. technical_service caches for 8h,
    which is fine for its chart-overlay callers but would leave a 15s-refresh
    gate showing a morning RSI all afternoon.
  - Today's 1-minute bars for session VWAP and the 09:30–09:45 opening range
    (same fixed window as OrbService.orb_end). OrbDataHub's live ORB is
    preferred when the ticker is ORB-followed; bars are the fallback so the
    gate works for any ticker.
  - Daily change of the ticker's sector SPDR ETF vs SPY.

Market data is cached per ticker (daily: per trading date, intraday: 15s,
sector lookup: process lifetime) — the verdict itself is recomputed per request since it
depends on direction.
"""

import logging
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, time as dtime
from typing import Optional

import pytz

logger = logging.getLogger(__name__)
ET = pytz.timezone("America/New_York")

ORB_START = dtime(9, 30)
ORB_END = dtime(9, 45)

# Daily bars are keyed by ET date, so one fetch (prewarmed at ORB calc)
# covers the whole session — the live price replaces today's close anyway.
_DAILY_TTL_S = 12 * 3600
_INTRADAY_TTL_S = 15

# Sector-vs-SPY thresholds, in percentage points of relative daily change.
SECTOR_LEAD_PCT = 0.3        # |relative| below this = "Inline"
SECTOR_STRONG_PCT = 1.0      # against the trade by this much = hard block

# How close price has to be to a ZoneEngine zone's boundary to count as
# "at" it for the zone gate factor — wider than StructureTracker's own
# live zone_approach (_APPROACH_PCT = 0.15%), which fires per-tick chart/
# alert events; this only needs to be right once per gate check.
ZONE_NEAR_PCT = 0.003

# A zone this strong, sitting against the trade, is a hard block rather
# than a normal +1/-1 factor — same tier SECTOR_STRONG_PCT gives sector.
ZONE_BLOCK_SCORE = 70.0

# Verdict thresholds
ENTER_MIN_SCORE = 3
RSI_OVERBOUGHT = 70
RSI_OVERSOLD = 30

# yfinance `info["sector"]` → SPDR sector ETF.
SECTOR_ETFS = {
    "Technology": "XLK",
    "Communication Services": "XLC",
    "Consumer Cyclical": "XLY",
    "Consumer Defensive": "XLP",
    "Energy": "XLE",
    "Financial Services": "XLF",
    "Healthcare": "XLV",
    "Industrials": "XLI",
    "Basic Materials": "XLB",
    "Real Estate": "XLRE",
    "Utilities": "XLU",
}

_lock = threading.Lock()
_daily_cache: dict[str, tuple[float, object]] = {}
_intraday_cache: dict[str, tuple[float, object]] = {}
_sector_cache: dict[str, Optional[str]] = {}


# ── Data fetch (cached) ─────────────────────────────────────────────────────────

def _cached(cache: dict, key: str, ttl: float, fetch):
    now = time.time()
    with _lock:
        hit = cache.get(key)
    if hit and now - hit[0] < ttl:
        return hit[1]
    value = fetch()
    with _lock:
        cache[key] = (now, value)
    return value


def _daily_closes(ticker: str):
    import yfinance as yf
    key = f"{ticker}:{datetime.now(ET).date().isoformat()}"
    return _cached(_daily_cache, key, _DAILY_TTL_S,
                   lambda: yf.Ticker(ticker).history(period="2y", interval="1d")["Close"])


def _intraday_bars(ticker: str):
    import yfinance as yf
    return _cached(_intraday_cache, ticker, _INTRADAY_TTL_S,
                   lambda: yf.Ticker(ticker).history(period="1d", interval="1m", prepost=False))


def _day_change_pct(symbol: str) -> Optional[float]:
    import yfinance as yf

    def fetch():
        fi = yf.Ticker(symbol).fast_info
        last, prev = fi.last_price, fi.previous_close
        if not last or not prev:
            return None
        return (float(last) - float(prev)) / float(prev) * 100

    return _cached(_intraday_cache, f"chg:{symbol}", _INTRADAY_TTL_S, fetch)


def _sector_of(ticker: str) -> Optional[str]:
    """yfinance .info is slow (~1s) and a company's sector doesn't change — cache forever."""
    with _lock:
        if ticker in _sector_cache:
            return _sector_cache[ticker]
    sector = None
    try:
        import yfinance as yf
        info = yf.Ticker(ticker).info or {}
        # ETFs (SPY, QQQ, sector funds) have no sector — the row reports n/a.
        if info.get("quoteType") == "EQUITY":
            sector = info.get("sector")
    except Exception as e:
        logger.warning("[entry_check] sector lookup failed for %s: %s", ticker, e)
        return None  # don't cache failures
    with _lock:
        _sector_cache[ticker] = sector
    return sector


# ── Row builders ────────────────────────────────────────────────────────────────

def _trend_and_rsi(closes, live_price: float) -> tuple[dict, dict]:
    import pandas as pd

    # Yahoo occasionally has a missing daily close (IWM 2024-09-25) — drop it
    # so a gap can never land in the latest bar the RSI/EMAs read.
    closes = closes.dropna().copy()
    today = datetime.now(ET).date()
    last_idx = closes.index[-1]
    last_date = last_idx.date() if hasattr(last_idx, "date") else None
    if last_date == today:
        closes.iloc[-1] = live_price
    else:
        closes = pd.concat([closes, pd.Series([live_price], index=[pd.Timestamp(today, tz=last_idx.tz)])])

    ema20 = float(closes.ewm(span=20, adjust=False).mean().iloc[-1])
    ema50 = float(closes.ewm(span=50, adjust=False).mean().iloc[-1]) if len(closes) >= 50 else None
    ema200 = float(closes.ewm(span=200, adjust=False).mean().iloc[-1]) if len(closes) >= 200 else None

    # Wilder's RSI-14 — the smoothing TradingView/Robinhood use, so the gate's
    # number matches the chart. (technical_service keeps its simple-mean RSI:
    # the swing pipeline's scores are calibrated against it.) An EMA with
    # alpha=1/14 IS Wilder's smoothing; over 2y of bars the seed difference
    # vs. the textbook SMA-seeded start has fully decayed.
    delta = closes.diff()
    gain = delta.clip(lower=0).ewm(alpha=1 / 14, adjust=False, min_periods=14).mean()
    loss = (-delta.clip(upper=0)).ewm(alpha=1 / 14, adjust=False, min_periods=14).mean()
    rs = gain / loss.replace(0, float("nan"))
    rs_val = float(rs.iloc[-1])
    if pd.isna(rs_val):
        rsi = 100.0 if float(gain.iloc[-1]) > 0 else 50.0
    else:
        rsi = 100 - 100 / (1 + rs_val)

    if ema50 is None:
        label = "Chop"
    elif ema20 > ema50 and live_price > ema20:
        label = "Bullish"
    elif ema20 < ema50 and live_price < ema20:
        label = "Bearish"
    else:
        label = "Chop"

    trend = {
        "label": label,
        "price": round(live_price, 2),
        "ema20": round(ema20, 2),
        "ema50": round(ema50, 2) if ema50 is not None else None,
        "ema200": round(ema200, 2) if ema200 is not None else None,
    }
    rsi_row = {
        "value": round(rsi, 1),
        "zone": "Overbought" if rsi > RSI_OVERBOUGHT else "Oversold" if rsi < RSI_OVERSOLD else "Neutral",
    }
    return trend, rsi_row


def _session_rows(ticker: str, bars) -> tuple[Optional[dict], Optional[dict], Optional[float], Optional[str]]:
    """(vwap_row, orb_row, last_price, session_date) from today's 1-minute bars."""
    if bars is None or bars.empty:
        return None, None, None, None

    idx = bars.index.tz_convert(ET) if bars.index.tz is not None else bars.index.tz_localize(ET)
    session_date = idx[-1].date()
    last = float(bars["Close"].iloc[-1])

    typical = (bars["High"] + bars["Low"] + bars["Close"]) / 3
    vol = bars["Volume"]
    vwap = float((typical * vol).sum() / vol.sum()) if float(vol.sum()) > 0 else None
    vwap_row = None
    if vwap:
        vwap_row = {
            "value": round(vwap, 2),
            "position": "Above" if last >= vwap else "Below",
            "distance_pct": round((last - vwap) / vwap * 100, 2),
        }

    times = [t.time() for t in idx]
    in_window = [i for i, t in enumerate(times) if ORB_START <= t < ORB_END]
    orb_row: Optional[dict] = None
    orh = orl = None
    source = "bars"

    # Prefer OrbService's live range when the ticker is ORB-followed.
    try:
        from services.utils.orb_data_hub import get_orb_data_hub
        status = get_orb_data_hub().get_status(ticker)
        if status and status.session_date == session_date and status.phase == "ready" and status.orh and status.orl:
            orh, orl, source = float(status.orh), float(status.orl), "live"
    except Exception:
        pass

    if orh is None and in_window:
        window_done = times[-1] >= ORB_END
        orh = float(bars["High"].iloc[in_window].max())
        orl = float(bars["Low"].iloc[in_window].min())
        if not window_done:
            orb_row = {"position": "Forming", "high": round(orh, 2), "low": round(orl, 2),
                       "distance_pct": None, "source": source}

    if orb_row is None and orh is not None:
        if last > orh:
            position, dist = "Above high", (last - orh) / orh * 100
        elif last < orl:
            position, dist = "Below low", (last - orl) / orl * 100
        else:
            position, dist = "Inside", None
        orb_row = {"position": position, "high": round(orh, 2), "low": round(orl, 2),
                   "distance_pct": round(dist, 2) if dist is not None else None, "source": source}

    return vwap_row, orb_row, last, session_date.isoformat()


def _sector_row(ticker: str) -> Optional[dict]:
    sector = _sector_of(ticker)
    etf = SECTOR_ETFS.get(sector or "")
    if not etf:
        return {"sector": sector, "etf": None, "label": "n/a",
                "sector_change_pct": None, "spy_change_pct": None, "relative_pct": None}
    with ThreadPoolExecutor(max_workers=2) as pool:
        f_etf, f_spy = pool.submit(_day_change_pct, etf), pool.submit(_day_change_pct, "SPY")
        etf_chg, spy_chg = f_etf.result(), f_spy.result()
    if etf_chg is None or spy_chg is None:
        return None
    rel = etf_chg - spy_chg
    label = "Leading" if rel >= SECTOR_LEAD_PCT else "Lagging" if rel <= -SECTOR_LEAD_PCT else "Inline"
    return {
        "sector": sector, "etf": etf, "label": label,
        "sector_change_pct": round(etf_chg, 2),
        "spy_change_pct": round(spy_chg, 2),
        "relative_pct": round(rel, 2),
    }


def _zone_snapshot(ticker: str) -> dict:
    """Thin wrapper so a ThreadPoolExecutor can fetch ZoneEngine's snapshot
    in parallel with the daily/intraday/sector fetches — it needs no price,
    only the ticker, so it doesn't have to wait on `_session_rows()`."""
    from services.strategy.zone_engine import zones as _zones
    return _zones(ticker)


def _zone_row(ticker: str, price: float, snap: Optional[dict] = None) -> Optional[dict]:
    """
    Nearest ZoneEngine zone to `price` — purely geometric (which side of
    price the zone sits on, not which trade direction it favors), same
    convention as `orb_row`/`vwap_row`: compute_verdict's own `is_call`
    branch decides what "at_resistance" means for a CALL vs a PUT, this
    function just reports geometry.

    `type` reflects StructureTracker's live flip state for this session
    when the ticker is being tracked (a support zone broken this morning
    reports as resistance here too) — "closed through the zone" should
    change what the zone gate says, not just what the chart draws.

    Returns `{"position": "clear", ...}` (not None) when nothing is close
    enough to matter — a real "no zone nearby" data point, not a fetch
    failure, so compute_verdict can choose to skip it without treating it
    as missing data the way a failed sector/daily-bars fetch would be.
    """
    if snap is None:
        from services.strategy.zone_engine import zones as _zones
        snap = _zones(ticker)
    if snap.get("error"):
        return None

    flip_by_bounds: dict = {}
    try:
        from services.strategy.structure_tracker import get_structure_tracker
        for f in get_structure_tracker().get_flipped_zones(ticker):
            flip_by_bounds[(f["low"], f["high"])] = f["current_type"]
    except Exception:
        pass

    candidates = [
        {**z, "type": flip_by_bounds.get((z["low"], z["high"]), z["type"])}
        for z in (snap.get("support", []) + snap.get("resistance", []))
    ]
    if not candidates:
        return {"position": "clear", "high": None, "low": None, "score": None,
                "distance_pct": None, "sources": []}

    def _dist(z):
        if z["low"] <= price <= z["high"]:
            return 0.0
        return min(abs(price - z["low"]), abs(price - z["high"]))

    nearest = min(candidates, key=_dist)
    d = _dist(nearest)
    inside = nearest["low"] <= price <= nearest["high"]
    if not (inside or (price and d / price <= ZONE_NEAR_PCT)):
        return {"position": "clear", "high": None, "low": None, "score": None,
                "distance_pct": None, "sources": []}

    return {
        "position": "at_resistance" if nearest["type"] == "resistance" else "at_support",
        "high": nearest["high"], "low": nearest["low"], "score": nearest["score"],
        "distance_pct": round(d / price * 100, 3) if price else None,
        "sources": nearest["sources"],
    }


# ── Verdict ─────────────────────────────────────────────────────────────────────

def compute_verdict(direction: str, rows: dict) -> dict:
    """
    Rules (from the entry-sheet redesign spec):
      Hard block → DON'T ENTER: RSI > 70 on a call / < 30 on a put (chasing),
        or the sector strongly moving against the trade (≥1pt vs SPY).
      Score: trend aligned +2, RSI 50–70 (calls) / 30–50 (puts) +1, VWAP on
        the trade's side +1, ORB broken in the trade's direction +1, sector
        leading (calls) / lagging (puts) +1.
      ≥3 ENTER · 1–2 WAIT · ≤0 or any hard block DON'T ENTER.
    A row with no data (e.g. ORB before 9:30, sector for an ETF) is left out
    of factors_total rather than counted against the trade.
    """
    is_call = direction.upper() == "CALL"
    side = "call" if is_call else "put"
    trend, rsi, vwap, orb, sector, zone = (
        rows.get(k) for k in ("trend", "rsi", "vwap", "orb", "sector", "zone")
    )

    factors: list[dict] = []
    blockers: list[str] = []
    missing: list[str] = []
    agree_notes: list[str] = []

    def add(key: str, ok: bool, points: int, agree_note: str, miss_note: Optional[str],
            fail_note: Optional[str] = None):
        # `note` is the per-factor explanation evaluate_gate() surfaces when a
        # strategy requires this factor — the agree note when it passes, the
        # blocker/"waiting for…" text when it doesn't.
        factors.append({"key": key, "ok": ok, "points": points if ok else 0,
                        "note": agree_note if ok else (fail_note or miss_note)})
        if ok:
            agree_notes.append(agree_note)
        elif miss_note:
            missing.append(miss_note)

    if trend:
        want = "Bullish" if is_call else "Bearish"
        add("trend", trend["label"] == want, 2, f"trend {want.lower()}",
            f"waiting for the trend to turn {want.lower()} "
            f"(EMA-20 {'above' if is_call else 'below'} EMA-50, price {'above' if is_call else 'below'} EMA-20)")

    if rsi:
        v = rsi["value"]
        if is_call and v > RSI_OVERBOUGHT:
            blockers.append(f"RSI {v:.0f} (overbought). Buying this call is chasing; wait for a pullback toward VWAP.")
            add("rsi", False, 1, "", None, fail_note=f"RSI {v:.0f} overbought (>70)")
        elif not is_call and v < RSI_OVERSOLD:
            blockers.append(f"RSI {v:.0f} (oversold). Buying this put is chasing the drop; wait for a bounce toward VWAP.")
            add("rsi", False, 1, "", None, fail_note=f"RSI {v:.0f} oversold (<30)")
        elif is_call:
            add("rsi", 50 <= v <= RSI_OVERBOUGHT, 1, f"RSI {v:.0f}",
                f"waiting for RSI to push above 50 (now {v:.0f})")
        else:
            add("rsi", RSI_OVERSOLD <= v <= 50, 1, f"RSI {v:.0f}",
                f"waiting for RSI to drop below 50 (now {v:.0f})")

    if vwap:
        want = "Above" if is_call else "Below"
        add("vwap", vwap["position"] == want, 1, f"{want.lower()} VWAP",
            f"waiting for price to {'reclaim' if is_call else 'lose'} VWAP (${vwap['value']:.2f})")

    if orb and orb["position"] != "Forming":
        want = "Above high" if is_call else "Below low"
        level = orb["high"] if is_call else orb["low"]
        add("orb", orb["position"] == want, 1,
            "above the opening high" if is_call else "below the opening low",
            f"waiting for a break {'above the opening high' if is_call else 'below the opening low'} (${level:.2f})")
    elif orb and orb["position"] == "Forming":
        missing.append("opening range still forming (locks at 9:45 ET)")

    if sector and sector.get("relative_pct") is not None:
        rel = sector["relative_pct"]
        etf = sector["etf"]
        against = -rel if is_call else rel
        if against >= SECTOR_STRONG_PCT:
            verb = "lagging" if is_call else "leading"
            blockers.append(f"{etf} {verb} SPY by {abs(rel):.1f}% today — the sector is moving against this {side}.")
            add("sector", False, 1, "", None, fail_note=f"{etf} {verb} SPY by {abs(rel):.1f}%")
        else:
            want = "Leading" if is_call else "Lagging"
            add("sector", sector["label"] == want, 1, f"sector ({etf}) {want.lower()}",
                f"waiting for {etf} to {'lead' if is_call else 'lag'} SPY (now {rel:+.1f}%)")

    if zone and zone.get("position") != "clear":
        at_res = zone["position"] == "at_resistance"
        kind = "resistance" if at_res else "support"
        level = zone["high"] if at_res else zone["low"]
        score_val = zone["score"] or 0
        # at_resistance is against a CALL (overhead supply in the way) and
        # for a PUT (price capped below it); at_support is the mirror.
        against = (at_res and is_call) or (not at_res and not is_call)
        if against and score_val >= ZONE_BLOCK_SCORE:
            # A real, confluence-scored wall — the TODO's own framing
            # ("at scored resistance + rejection strengthens DON'T ENTER")
            # treated as a hard block once the zone itself is strong enough
            # to matter, same tier SECTOR_STRONG_PCT gives sector. This is a
            # geometric read (price vs. the zone), not a live rejection
            # signal — StructureTracker's zone_approach event is the sharper
            # version of "actually rejecting right now," not yet wired in here.
            blockers.append(
                f"${level:.2f} scored {kind} zone ({score_val:.0f}/100, {_join(zone['sources'])}) "
                f"is directly in the way of this {side}."
            )
            add("zone", False, 1, "", None, fail_note=f"at a {score_val:.0f}-scored {kind} zone (${level:.2f})")
        elif against:
            add("zone", False, 1, "",
                f"waiting for a volume-confirmed close through the ${level:.2f} {kind} zone ({score_val:.0f}/100)")
        else:
            verb = "capped below" if at_res else "holding above"
            add("zone", True, 1, f"{verb} the ${level:.2f} {kind} zone ({score_val:.0f}/100)", None)

    score = sum(f["points"] for f in factors)
    agree = sum(1 for f in factors if f["ok"])
    total = len(factors)

    if blockers or score <= 0:
        decision = "DONT_ENTER"
        if blockers:
            reason = f"DON'T ENTER — {blockers[0]}"
        else:
            reason = f"DON'T ENTER — none of the {total} factors support this {side}."
    elif score >= ENTER_MIN_SCORE:
        decision = "ENTER"
        reason = f"ENTER — {_join(agree_notes)}. {agree} of {total} factors agree."
    else:
        decision = "WAIT"
        first = missing[0] if missing else "more confirmation"
        reason = f"WAIT — {first}. {agree} of {total} factors agree."

    return {
        "decision": decision,
        "score": score,
        "factors_agree": agree,
        "factors_total": total,
        "reason": reason,
        "blockers": blockers,
        "missing": missing,
        "factors": factors,
    }


def chart_signal(verdicts: dict) -> str:
    """
    One signal for a chart that has no trade direction yet:
    CALL / PUT when that side's verdict is ENTER (higher score wins if both),
    WAIT when either side is one or two factors away, NA when both sides
    are DON'T ENTER.
    """
    call, put = verdicts["CALL"], verdicts["PUT"]
    if call["decision"] == "ENTER" and (put["decision"] != "ENTER" or call["score"] >= put["score"]):
        return "CALL"
    if put["decision"] == "ENTER":
        return "PUT"
    if "WAIT" in (call["decision"], put["decision"]):
        return "WAIT"
    return "NA"


def _join(parts: list[str]) -> str:
    if not parts:
        return ""
    if len(parts) == 1:
        return parts[0]
    return ", ".join(parts[:-1]) + " and " + parts[-1]


# ── Entry point ─────────────────────────────────────────────────────────────────

def get_entry_check(ticker: str, direction: str) -> dict:
    ticker = ticker.upper().strip()
    direction = direction.upper()

    with ThreadPoolExecutor(max_workers=4) as pool:
        f_daily = pool.submit(_daily_closes, ticker)
        f_bars = pool.submit(_intraday_bars, ticker)
        f_sector = pool.submit(_sector_row, ticker)
        f_zone = pool.submit(_zone_snapshot, ticker)

        errors: dict[str, str] = {}
        try:
            bars = f_bars.result()
        except Exception as e:
            logger.warning("[entry_check] intraday bars failed for %s: %s", ticker, e)
            bars, errors["session"] = None, str(e)
        try:
            closes = f_daily.result()
        except Exception as e:
            logger.warning("[entry_check] daily bars failed for %s: %s", ticker, e)
            closes, errors["daily"] = None, str(e)
        try:
            sector = f_sector.result()
        except Exception as e:
            logger.warning("[entry_check] sector failed for %s: %s", ticker, e)
            sector, errors["sector"] = None, str(e)
        try:
            zone_snap = f_zone.result()
        except Exception as e:
            logger.warning("[entry_check] zone snapshot failed for %s: %s", ticker, e)
            zone_snap, errors["zone"] = None, str(e)

    vwap_row, orb_row, last, session_date = _session_rows(ticker, bars)
    if last is None and closes is not None and len(closes):
        last = float(closes.iloc[-1])
    if last is None:
        raise ValueError(f"No price data for {ticker}")

    trend = rsi = None
    if closes is not None and len(closes) >= 22:
        trend, rsi = _trend_and_rsi(closes, last)

    zone_row = _zone_row(ticker, last, snap=zone_snap) if zone_snap is not None else None

    rows = {"trend": trend, "rsi": rsi, "vwap": vwap_row, "orb": orb_row, "sector": sector, "zone": zone_row}
    verdicts = {d: compute_verdict(d, rows) for d in ("CALL", "PUT")}
    from services.utils.market_hours import is_market_hours
    return {
        "ticker": ticker,
        "direction": direction,
        "price": round(last, 2),
        "as_of": datetime.now(ET).isoformat(timespec="seconds"),
        "market_open": is_market_hours(),
        "session_date": session_date,
        "rows": rows,
        "verdict": verdicts[direction],
        # Both directions + a single chart signal, so the Charts tab can show
        # "BUY CALL / BUY PUT / WAIT / N/A" from one request.
        "verdicts": verdicts,
        "signal": chart_signal(verdicts),
        "errors": errors or None,
    }


# ── Strategy technicals gate (automated ORB engines) ───────────────────────────

GATE_FACTORS = ("trend", "trend_intraday", "rsi", "vwap", "orb", "sector", "zone")

INTRADAY_FAST, INTRADAY_SLOW, INTRADAY_BAR_MIN = 9, 21, 5


def intraday_trend(closes_1m: list[tuple], price: float) -> Optional[dict]:
    """
    5-minute EMA-9 vs EMA-21 from today's regular-session 1-minute closes
    [(ts_et, close), ...]. Bullish = EMA-9 above EMA-21 and price above
    EMA-9; Bearish mirrors it; anything else is Chop. None until there are
    INTRADAY_SLOW 5-min bars (≈10:15 ET) — too early to call a trend.
    """
    import pandas as pd

    today = datetime.now(ET).date()
    buckets: dict = {}
    for ts, close in closes_1m:
        if close is None:
            continue
        t = ts.astimezone(ET) if ts.tzinfo else ET.localize(ts)
        if t.date() != today or t.time() < ORB_START:
            continue
        key = t.replace(minute=t.minute - t.minute % INTRADAY_BAR_MIN, second=0, microsecond=0)
        buckets[key] = float(close)          # last 1-min close in the bucket
    if len(buckets) < INTRADAY_SLOW:
        return {"label": None, "bars": len(buckets), "needed": INTRADAY_SLOW}

    series = pd.Series([buckets[k] for k in sorted(buckets)])
    series.iloc[-1] = price
    fast = float(series.ewm(span=INTRADAY_FAST, adjust=False).mean().iloc[-1])
    slow = float(series.ewm(span=INTRADAY_SLOW, adjust=False).mean().iloc[-1])
    if fast > slow and price > fast:
        label = "Bullish"
    elif fast < slow and price < fast:
        label = "Bearish"
    else:
        label = "Chop"
    return {"label": label, "ema9": round(fast, 2), "ema21": round(slow, 2), "bars": len(buckets)}


def prewarm(ticker: str, required: Optional[list[str]] = None) -> None:
    """
    Load the slow, session-stable inputs ahead of the first entry signal
    (called off-thread at ORB calc): daily bars (per-date cache) and the
    one-time sector lookup. VWAP/ORB/intraday trend come from the engine's
    live bars at signal time, so there's nothing useful to warm for them.
    """
    ticker = ticker.upper().strip()
    required = required or list(GATE_FACTORS)
    try:
        if "trend" in required or "rsi" in required:
            _daily_closes(ticker)
        if "sector" in required:
            _sector_of(ticker)
        if "zone" in required:
            _zone_snapshot(ticker)  # populates zone_engine's own 90s cache
    except Exception as e:
        logger.warning("[entry_check] prewarm failed for %s: %s", ticker, e)


def evaluate_gate(ticker: str, direction: str, required: list[str], price: float,
                  vwap: Optional[float] = None, orh: Optional[float] = None,
                  orl: Optional[float] = None,
                  intraday_closes: Optional[list[tuple]] = None) -> dict:
    """
    Per-strategy entry gate: EVERY factor in `required` must pass (same
    per-factor rules as compute_verdict — e.g. RSI passes at 50–70 for a
    call, trend passes when aligned with the trade). Unlike the entry
    sheet's scored verdict, factors not in `required` are ignored entirely,
    hard blocks included — a REVERSAL strategy that only requires
    trend+VWAP is not stopped by an overbought RSI.

    The engine passes its own live inputs (trigger price, the hub's running
    VWAP, its ORB high/low) so the gate judges the exact signal being
    traded (intraday_closes = the hub's 1-min bars for trend_intraday); only
    missing inputs fall back to fetched bars. A required factor
    with no data FAILS the gate (fail closed — this gates real orders), except
    sector on an ETF, which has no sector and is skipped.
    """
    ticker = ticker.upper().strip()
    required = [k for k in GATE_FACTORS if k in (required or [])]
    rows: dict = {}
    errors: list[str] = []

    if "trend" in required or "rsi" in required:
        try:
            closes = _daily_closes(ticker)
            if closes is not None and len(closes) >= 22:
                trend, rsi = _trend_and_rsi(closes, price)
                if "trend" in required:
                    rows["trend"] = trend
                if "rsi" in required:
                    rows["rsi"] = rsi
        except Exception as e:
            errors.append(f"daily bars: {e}")

    need_session = ("vwap" in required and vwap is None) or ("orb" in required and (orh is None or orl is None))
    session_vwap_row = session_orb_row = None
    if need_session:
        try:
            session_vwap_row, session_orb_row, _, _ = _session_rows(ticker, _intraday_bars(ticker))
        except Exception as e:
            errors.append(f"intraday bars: {e}")

    if "vwap" in required:
        if vwap:
            rows["vwap"] = {"value": round(vwap, 2), "position": "Above" if price >= vwap else "Below",
                            "distance_pct": round((price - vwap) / vwap * 100, 2)}
        else:
            rows["vwap"] = session_vwap_row

    if "orb" in required:
        if orh is not None and orl is not None:
            if price > orh:
                pos = "Above high"
            elif price < orl:
                pos = "Below low"
            else:
                pos = "Inside"
            rows["orb"] = {"position": pos, "high": round(orh, 2), "low": round(orl, 2),
                           "distance_pct": None, "source": "engine"}
        else:
            rows["orb"] = session_orb_row

    if "sector" in required:
        try:
            rows["sector"] = _sector_row(ticker)
        except Exception as e:
            errors.append(f"sector: {e}")

    if "zone" in required:
        try:
            rows["zone"] = _zone_row(ticker, price)
        except Exception as e:
            errors.append(f"zone: {e}")

    intraday_row = None
    if "trend_intraday" in required:
        try:
            closes_1m = intraday_closes
            if not closes_1m:
                bars = _intraday_bars(ticker)
                closes_1m = [(ts.to_pydatetime(), c) for ts, c in bars["Close"].items()] if bars is not None else []
            intraday_row = intraday_trend(closes_1m, price)
            rows["trend_intraday"] = intraday_row
        except Exception as e:
            errors.append(f"intraday trend: {e}")

    verdict = compute_verdict(direction, {k: rows.get(k) for k in ("trend", "rsi", "vwap", "orb", "sector", "zone")})
    by_key = {f["key"]: f for f in verdict["factors"]}

    results = []
    for key in required:
        f = by_key.get(key)
        if key == "trend_intraday":
            want = "Bullish" if direction.upper() == "CALL" else "Bearish"
            if intraday_row is None:
                results.append({"key": key, "ok": False, "skipped": False, "note": "no data"})
            elif intraday_row["label"] is None:
                results.append({"key": key, "ok": False, "skipped": False,
                                "note": f"not enough 5-min bars yet ({intraday_row['bars']}/{intraday_row['needed']})"})
            elif intraday_row["label"] == want:
                results.append({"key": key, "ok": True, "skipped": False, "note": f"5-min trend {want.lower()}"})
            else:
                results.append({"key": key, "ok": False, "skipped": False,
                                "note": f"5-min trend {intraday_row['label'].lower()} "
                                        f"(EMA-9 ${intraday_row['ema9']:.2f} vs EMA-21 ${intraday_row['ema21']:.2f})"})
            continue
        if key == "sector" and rows.get("sector") and rows["sector"].get("label") == "n/a":
            results.append({"key": key, "ok": True, "skipped": True, "note": "no sector (ETF) — skipped"})
        elif key == "zone" and rows.get("zone") and rows["zone"].get("position") == "clear":
            # No zone near enough to matter — same "nothing to check" skip
            # semantics as sector on an ETF, not a fail: a strategy
            # requiring the zone factor shouldn't be permanently blocked
            # just because price happens to sit in open space right now.
            results.append({"key": key, "ok": True, "skipped": True, "note": "no nearby zone — skipped"})
        elif key == "orb" and rows.get("orb") and rows["orb"]["position"] == "Forming":
            results.append({"key": key, "ok": False, "skipped": False, "note": "opening range still forming"})
        elif f is None:
            results.append({"key": key, "ok": False, "skipped": False, "note": "no data"})
        else:
            results.append({"key": key, "ok": f["ok"], "skipped": False, "note": f.get("note")})

    passed = all(r["ok"] for r in results)
    failing = [f"{r['key'].upper()}: {r['note']}" for r in results if not r["ok"]]
    matched = sum(1 for r in results if r["ok"] and not r["skipped"])
    counted = sum(1 for r in results if not r["skipped"])
    return {
        "passed": passed,
        "required": required,
        "matched": matched,
        "total": counted,
        "results": results,
        "summary": (f"{matched}/{counted} technicals matched"
                    + ("" if passed else " — " + "; ".join(failing))),
        "rows": rows,
        "errors": errors or None,
    }

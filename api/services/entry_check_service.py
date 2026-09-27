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
  - Daily bars (2y) for EMA-20/50/200 + RSI-14 — same formulas as
    technical_service.get_technicals(), but the latest close is REPLACED with
    the live price so RSI moves intraday. technical_service caches for 8h,
    which is fine for its chart-overlay callers but would leave a 15s-refresh
    gate showing a morning RSI all afternoon.
  - Today's 1-minute bars for session VWAP and the 09:30–09:45 opening range
    (same fixed window as OrbService.orb_end). OrbDataHub's live ORB is
    preferred when the ticker is ORB-followed; bars are the fallback so the
    gate works for any ticker.
  - Daily change of the ticker's sector SPDR ETF vs SPY.

Market data is cached per ticker (daily: 1h, intraday: 15s, sector lookup:
process lifetime) — the verdict itself is recomputed per request since it
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

_DAILY_TTL_S = 3600
_INTRADAY_TTL_S = 15

# Sector-vs-SPY thresholds, in percentage points of relative daily change.
SECTOR_LEAD_PCT = 0.3        # |relative| below this = "Inline"
SECTOR_STRONG_PCT = 1.0      # against the trade by this much = hard block

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
    return _cached(_daily_cache, ticker, _DAILY_TTL_S,
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

    closes = closes.copy()
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

    # Same RSI formula as technical_service.get_technicals (simple rolling mean).
    delta = closes.diff()
    gain = delta.clip(lower=0).rolling(14).mean()
    loss = (-delta.clip(upper=0)).rolling(14).mean()
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
    trend, rsi, vwap, orb, sector = (rows.get(k) for k in ("trend", "rsi", "vwap", "orb", "sector"))

    factors: list[dict] = []
    blockers: list[str] = []
    missing: list[str] = []
    agree_notes: list[str] = []

    def add(key: str, ok: bool, points: int, agree_note: str, miss_note: Optional[str]):
        factors.append({"key": key, "ok": ok, "points": points if ok else 0})
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
            add("rsi", False, 1, "", None)
        elif not is_call and v < RSI_OVERSOLD:
            blockers.append(f"RSI {v:.0f} (oversold). Buying this put is chasing the drop; wait for a bounce toward VWAP.")
            add("rsi", False, 1, "", None)
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
            add("sector", False, 1, "", None)
        else:
            want = "Leading" if is_call else "Lagging"
            add("sector", sector["label"] == want, 1, f"sector ({etf}) {want.lower()}",
                f"waiting for {etf} to {'lead' if is_call else 'lag'} SPY (now {rel:+.1f}%)")

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

    with ThreadPoolExecutor(max_workers=3) as pool:
        f_daily = pool.submit(_daily_closes, ticker)
        f_bars = pool.submit(_intraday_bars, ticker)
        f_sector = pool.submit(_sector_row, ticker)

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

    vwap_row, orb_row, last, session_date = _session_rows(ticker, bars)
    if last is None and closes is not None and len(closes):
        last = float(closes.iloc[-1])
    if last is None:
        raise ValueError(f"No price data for {ticker}")

    trend = rsi = None
    if closes is not None and len(closes) >= 22:
        trend, rsi = _trend_and_rsi(closes, last)

    rows = {"trend": trend, "rsi": rsi, "vwap": vwap_row, "orb": orb_row, "sector": sector}
    from services.utils.market_hours import is_market_hours
    return {
        "ticker": ticker,
        "direction": direction,
        "price": round(last, 2),
        "as_of": datetime.now(ET).isoformat(timespec="seconds"),
        "market_open": is_market_hours(),
        "session_date": session_date,
        "rows": rows,
        "verdict": compute_verdict(direction, rows),
        "errors": errors or None,
    }

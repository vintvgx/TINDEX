"""
paper_signals I/O (TODO 8 part 3): record path-A (brief) and path-B (ORB
breakout) signals, and resolve their outcomes after the close.

  upsert_signal       insert/update one row (path A rows are upserted by
                      BriefService as the play moves through its states)
  record_orb_signal   path B — called (in a background thread) right after an
                      ORB strategy entry is logged in ORBEngine._execute_entry
  resolve_day         16:15 ET job: setup outcome from IEX 1m bars after the
                      signal + the trade's P&L joined from orb_trades
The pure pieces (outcome rules, ORB levels, aggregation) are in review.py.
"""

import logging
import os
from datetime import date, datetime, timedelta, timezone

import pytz

from services.brief.review import orb_levels, resolve_outcome

logger = logging.getLogger(__name__)
ET = pytz.timezone("America/New_York")


def _sb():
    from services.supabase.supabase_service import get_supabase_service
    return get_supabase_service().client


def upsert_signal(sb, row: dict) -> None:
    """Full row (all NOT NULL columns present). None values are dropped so a
    later state update never blanks a field an earlier one set."""
    clean = {k: v for k, v in row.items() if v is not None}
    clean["updated_at"] = datetime.now(timezone.utc).isoformat()
    sb.table("paper_signals").upsert(clean, on_conflict="id").execute()


def _update_signal(sb, signal_id: str, fields: dict) -> None:
    """Partial update of an existing row (an upsert would fail on the NOT
    NULL columns it doesn't carry)."""
    sb.table("paper_signals").update({**fields, "updated_at": datetime.now(timezone.utc).isoformat()}) \
        .eq("id", signal_id).execute()


def record_orb_signal(ticker: str, direction: str, trade_id: "str | None", orh: "float | None",
                      orl: "float | None", entry_premium: float, qty: int, contract_symbol: str,
                      profile: str, paper_mode: bool, underlying_price: "float | None") -> None:
    """Path B row for an ORB breakout entry. Zone score / target come from a
    zone-engine snapshot taken now; gate factors from the Technicals Gate now
    (the ORB engine's own gate is opt-in per strategy, so this is the
    uniform read every signal gets)."""
    if not trade_id or orh is None or orl is None:
        return
    try:
        zones = []
        try:
            from services.strategy.zone_engine import zones as _zones
            snap = _zones(ticker)
            if not snap.get("error"):
                zones = snap.get("support", []) + snap.get("resistance", [])
        except Exception as e:
            logger.info("[signals] zones unavailable for %s: %s", ticker, e)
        lv = orb_levels(direction, orh, orl, zones)

        verdict = {}
        try:
            from services.entry_check_service import get_entry_check
            chk = get_entry_check(ticker, direction) or {}
            verdict = (chk.get("verdicts") or {}).get(direction) or chk.get("verdict") or {}
        except Exception as e:
            logger.info("[signals] gate unavailable for %s: %s", ticker, e)

        now = datetime.now(ET)
        upsert_signal(_sb(), {
            "id": f"B-{trade_id}",
            "signal_path": "B",
            "signal_date": now.date().isoformat(),
            "ticker": ticker,
            "direction": direction,
            "signal_at": now.isoformat(timespec="seconds"),
            "signal_price": underlying_price,
            "setup_score": None,
            "zone_score": lv["zone_score"],
            "gate_decision": verdict.get("decision"),
            "gate_agree": verdict.get("factors_agree"),
            "gate_total": verdict.get("factors_total"),
            "trigger": lv["trigger"],
            "target": lv["target"],
            "invalidation": lv["invalidation"],
            "fill_status": "filled",
            "trade_id": trade_id,
            "contract_symbol": contract_symbol,
            "qty": qty,
            "profile": profile,
            "entry_premium": entry_premium,
            "paper_mode": paper_mode,
        })
        logger.info("[signals] path B logged for %s %s (zone %s)", ticker, direction, lv["zone_score"])
    except Exception as e:
        logger.warning("[signals] path B log failed for %s: %s", ticker, e)


def _bars_after(ticker: str, start: datetime, end: datetime) -> list:
    from alpaca.data.historical import StockHistoricalDataClient
    from alpaca.data.requests import StockBarsRequest
    from alpaca.data.timeframe import TimeFrame
    client = StockHistoricalDataClient(os.getenv("ALPACA_LIVE_API_KEY"), os.getenv("ALPACA_LIVE_SECRET_KEY"))
    resp = client.get_stock_bars(StockBarsRequest(symbol_or_symbols=ticker, timeframe=TimeFrame.Minute,
                                                  start=start, end=end, feed="iex"))
    return [(b.timestamp.astimezone(ET), float(b.high), float(b.low), float(b.close))
            for b in resp.data.get(ticker, [])]


def resolve_day(day: date, sb=None, bars_fn=_bars_after) -> dict:
    """Resolve every unresolved signal on `day`, and refresh trade P&L for
    any of the last 7 days' rows whose trade was still open."""
    sb = sb or _sb()
    close = ET.localize(datetime.combine(day, datetime.min.time()).replace(hour=16))
    rows = sb.table("paper_signals").select("*").eq("signal_date", day.isoformat()).execute().data or []
    since = (day - timedelta(days=7)).isoformat()
    pending_pnl = (sb.table("paper_signals").select("*").gte("signal_date", since)
                   .eq("fill_status", "filled").is_("pnl", "null").execute().data or [])
    by_id = {r["id"]: r for r in rows + pending_pnl}

    resolved = traded = 0
    for r in by_id.values():
        update = {}
        if not r.get("outcome") and r.get("signal_at") and r["signal_date"] == day.isoformat():
            try:
                start = datetime.fromisoformat(r["signal_at"]) + timedelta(minutes=1)
                bars = bars_fn(r["ticker"], start, close)
                res = resolve_outcome(bars, r["direction"], r["target"], r["invalidation"])
                if res["outcome"]:
                    update.update({"outcome": res["outcome"], "mfe_pct": res["mfe_pct"], "mae_pct": res["mae_pct"],
                                   "resolved_at": res["resolved_at"].isoformat() if res["resolved_at"] else None})
                    resolved += 1
            except Exception as e:
                logger.warning("[signals] outcome failed for %s: %s", r["id"], e)
        if r.get("trade_id") and r.get("pnl") is None:
            t = (sb.table("orb_trades").select("pnl, pnl_pct, exit_time").eq("id", r["trade_id"])
                 .limit(1).execute().data or [])
            if t and t[0].get("exit_time"):
                update.update({"pnl": t[0].get("pnl"), "pnl_pct": t[0].get("pnl_pct"), "exit_time": t[0]["exit_time"]})
                traded += 1
        if update:
            _update_signal(sb, r["id"], update)
    return {"date": day.isoformat(), "signals": len(rows), "outcomes_resolved": resolved, "trades_joined": traded}

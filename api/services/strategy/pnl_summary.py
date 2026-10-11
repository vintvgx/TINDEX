"""
Unified P&L — the one place account P&L by period is computed (handoff
spec 5, 2026-10-11). Home's account card and the Trade Log both read
GET /strategy/accounts/pnl-summary, so they can't disagree by construction.

Source of truth is orb_trades (pnl is gross of fees):

  realized_gross  SUM(pnl) of trades whose exit_time (ET close date) falls in
                  the window, plus partial exits (TP1/TP2 stages) of trades
                  that are still open, bucketed by the stage's own time —
                  otherwise a TP1 taken today would be invisible until the
                  runner closes.
  fees            phase 1 estimate: (qty_entered + qty_exited) × $0.70 per
                  closed trade ($0.65/contract/side + ~$0.05 regulatory);
                  expired-worthless trades pay the entry side only, open
                  trades' partials pay the exit side. Prefers the row's
                  actual `fees` column once the logger writes it (phase 2).
  realized_net    realized_gross − fees
  unrealized      live Σ(open trades' unrealized) for the mode — never cached
  total           realized_net + unrealized (the headline number)

Periods (America/New_York): today = since midnight; week / month = since
midnight 7 / 30 days ago (the Trade Log's 1W / 1M cutoffs); ytd = Jan 1;
all_time = everything.

The realized half is cached in account_pnl_summary, one row per
(mode, period). TradeLogger clears a mode's rows on every exit; the read
path also recomputes when a newer close exists, the ET day rolled over, or
the rows are older than CACHE_TTL_S.
"""

from __future__ import annotations

import logging
import threading
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

logger = logging.getLogger(__name__)

ET = ZoneInfo("America/New_York")
PERIODS = ("today", "week", "month", "ytd", "all_time")
FEE_PER_CONTRACT_SIDE = 0.70
CACHE_TTL_S = 300
CACHE_TABLE = "account_pnl_summary"
# A no-fill expiry has no closing commission.
_NO_EXIT_FEE_REASONS = {"EXPIRED_WORTHLESS"}
_PAGE = 1000


def _parse_ts(v) -> datetime | None:
    """orb_trades timestamps are written as naive UTC isoformat strings and
    read back from timestamptz columns with an offset — accept both."""
    if not v:
        return None
    try:
        dt = datetime.fromisoformat(str(v).replace("Z", "+00:00"))
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def period_starts(now: datetime | None = None) -> dict[str, datetime | None]:
    now_et = (now or datetime.now(timezone.utc)).astimezone(ET)
    midnight = now_et.replace(hour=0, minute=0, second=0, microsecond=0)
    return {
        "today":    midnight,
        "week":     midnight - timedelta(days=7),
        "month":    midnight - timedelta(days=30),
        "ytd":      midnight.replace(month=1, day=1),
        "all_time": None,
    }


def _empty() -> dict:
    return {"realized_gross": 0.0, "fees": 0.0, "realized_net": 0.0, "trades_closed": 0}


def compute_realized(rows: list[dict], now: datetime | None = None) -> tuple[dict, datetime | None]:
    """Pure: rows from orb_trades (one mode) → ({period: realized}, max_exit_time)."""
    starts = period_starts(now)
    out = {p: _empty() for p in PERIODS}
    max_exit: datetime | None = None

    def add(when: datetime, pnl: float, fees: float, closed: int):
        for p, start in starts.items():
            if start is None or when >= start:
                b = out[p]
                b["realized_gross"] += pnl
                b["fees"] += fees
                b["trades_closed"] += closed

    for r in rows:
        qty_in = int(r.get("qty_entered") or 0)
        qty_out = int(r.get("qty_exited") or 0)
        exit_time = _parse_ts(r.get("exit_time"))
        if exit_time is not None:
            if max_exit is None or exit_time > max_exit:
                max_exit = exit_time
            if r.get("fees") is not None:
                fees = float(r["fees"])
            elif r.get("exit_reason") in _NO_EXIT_FEE_REASONS:
                fees = qty_in * FEE_PER_CONTRACT_SIDE
            else:
                fees = (qty_in + qty_out) * FEE_PER_CONTRACT_SIDE
            add(exit_time, float(r.get("pnl") or 0), fees, 1)
            continue
        # Still open: count partial exits already taken, at their own time.
        for st in r.get("exit_stages") or []:
            when = _parse_ts(st.get("time"))
            if when is None:
                continue
            add(when, float(st.get("pnl") or 0), int(st.get("qty") or 0) * FEE_PER_CONTRACT_SIDE, 0)

    for b in out.values():
        b["realized_gross"] = round(b["realized_gross"], 2)
        b["fees"] = round(b["fees"], 2)
        b["realized_net"] = round(b["realized_gross"] - b["fees"], 2)
    return out, max_exit


# ── Supabase I/O ──────────────────────────────────────────────────────────────

_BASE_COLS = "id, pnl, qty_entered, qty_exited, exit_time, exit_reason, exit_stages, contract_symbol, entry_premium"
_has_fees_col: bool | None = None


def _fetch_rows(client, paper: bool) -> list[dict]:
    """Every orb_trades row for the mode (paginated past PostgREST's 1000-row cap)."""
    global _has_fees_col
    cols = _BASE_COLS + (", fees" if _has_fees_col is not False else "")
    rows: list[dict] = []
    start = 0
    while True:
        try:
            res = (
                client.table("orb_trades").select(cols)
                .eq("paper_mode", paper)
                .order("entry_time")
                .range(start, start + _PAGE - 1)
                .execute()
            )
        except Exception as e:
            if _has_fees_col is not False and "fees" in str(e):
                # Pre-migration: no actual-fees column yet, estimate only.
                _has_fees_col = False
                return _fetch_rows(client, paper)
            raise
        if _has_fees_col is None:
            _has_fees_col = True
        page = res.data or []
        rows.extend(page)
        if len(page) < _PAGE:
            return rows
        start += _PAGE


def _latest_exit(client, paper: bool) -> datetime | None:
    res = (
        client.table("orb_trades").select("exit_time")
        .eq("paper_mode", paper)
        .not_.is_("exit_time", "null")
        .order("exit_time", desc=True)
        .limit(1)
        .execute()
    )
    return _parse_ts(res.data[0]["exit_time"]) if res.data else None


def _read_cache(client, mode: str) -> dict | None:
    try:
        res = client.table(CACHE_TABLE).select("*").eq("mode", mode).execute()
    except Exception as e:
        logger.warning("[pnl-summary] cache read failed (%s): %s", mode, e)
        return None
    rows = {r["period"]: r for r in (res.data or [])}
    return rows if all(p in rows for p in PERIODS) else None


def _cache_valid(cached: dict, latest_exit: datetime | None, now: datetime) -> bool:
    computed = [_parse_ts(r.get("computed_at")) for r in cached.values()]
    if any(c is None for c in computed):
        return False
    oldest = min(computed)
    if (now - oldest).total_seconds() > CACHE_TTL_S:
        return False
    # "today" / "week" move at ET midnight.
    if oldest.astimezone(ET).date() != now.astimezone(ET).date():
        return False
    cached_max = _parse_ts(cached["all_time"].get("max_exit_time"))
    return cached_max == latest_exit


def _write_cache(client, mode: str, realized: dict, max_exit: datetime | None, now: datetime):
    rows = [
        {
            "mode": mode,
            "period": p,
            **realized[p],
            "max_exit_time": max_exit.isoformat() if max_exit else None,
            "computed_at": now.isoformat(),
        }
        for p in PERIODS
    ]
    try:
        client.table(CACHE_TABLE).upsert(rows, on_conflict="mode,period").execute()
    except Exception as e:
        logger.warning("[pnl-summary] cache write failed (%s): %s", mode, e)


def invalidate(client, mode: str | None = None) -> None:
    """Drop cached rows (one mode, or both) — called by TradeLogger on every
    exit. Off-thread: the exit path never waits on this."""
    def _run():
        try:
            q = client.table(CACHE_TABLE).delete()
            q = q.eq("mode", mode) if mode else q.in_("mode", ["live", "paper"])
            q.execute()
        except Exception as e:
            logger.warning("[pnl-summary] invalidate failed (%s): %s", mode or "both", e)
    threading.Thread(target=_run, daemon=True, name="pnl-summary-invalidate").start()


def _unrealized(open_rows: list[dict]) -> float:
    from services.strategy.trade_logger import enrich_open_trades_with_live_pnl
    if not open_rows:
        return 0.0
    enriched = enrich_open_trades_with_live_pnl([dict(r) for r in open_rows])
    return round(sum(float(r.get("live_pnl") or 0) for r in enriched), 2)


def get_summary(client, paper: bool, now: datetime | None = None) -> dict:
    """{period: {realized_gross, fees, realized_net, unrealized, total,
    trades_closed}} for one mode, plus `as_of` and `cached`."""
    now = now or datetime.now(timezone.utc)
    mode = "paper" if paper else "live"

    realized: dict | None = None
    rows: list[dict] | None = None
    cached = _read_cache(client, mode)
    if cached is not None:
        try:
            if _cache_valid(cached, _latest_exit(client, paper), now):
                realized = {
                    p: {
                        "realized_gross": float(cached[p]["realized_gross"]),
                        "fees":           float(cached[p]["fees"]),
                        "realized_net":   float(cached[p]["realized_net"]),
                        "trades_closed":  int(cached[p]["trades_closed"]),
                    }
                    for p in PERIODS
                }
        except Exception as e:
            logger.warning("[pnl-summary] cache check failed (%s): %s", mode, e)

    from_cache = realized is not None
    if realized is None:
        rows = _fetch_rows(client, paper)
        realized, max_exit = compute_realized(rows, now)
        _write_cache(client, mode, realized, max_exit, now)
        open_rows = [r for r in rows if r.get("exit_time") is None]
    else:
        res = (
            client.table("orb_trades").select(_BASE_COLS)
            .eq("paper_mode", paper)
            .is_("exit_time", "null")
            .execute()
        )
        open_rows = res.data or []

    # Unrealized is the same live figure for every window: an open position's
    # mark-to-market is "now", whichever period you're looking at.
    unrealized = _unrealized(open_rows)
    out = {}
    for p in PERIODS:
        b = realized[p]
        out[p] = {**b, "unrealized": unrealized, "total": round(b["realized_net"] + unrealized, 2)}
    out["as_of"] = now.isoformat()
    out["cached"] = from_cache
    out["open_positions"] = len(open_rows)
    return out


def reconcile_with_alpaca_series(mode: str, summary: dict, series_pnl: dict) -> None:
    """Demoted Alpaca portfolio-history P&L: log-only cross-check. Warns when
    the broker series and the DB-derived total drift by more than $25 (fees
    are estimated, so small drift is expected)."""
    for period, alpaca_val in series_pnl.items():
        ours = (summary.get(period) or {}).get("total")
        if alpaca_val is None or ours is None:
            continue
        if abs(alpaca_val - ours) > 25:
            logger.warning(
                "[pnl-summary] %s %s diverges from Alpaca series: db=%.2f alpaca=%.2f (Δ%.2f)",
                mode, period, ours, alpaca_val, ours - alpaca_val,
            )

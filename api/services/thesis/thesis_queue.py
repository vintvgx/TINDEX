"""
Generate Thesis — queue + storage + push ONLY (handoff spec 6, 2026-10-11).

Bandit writes the theses; this backend never generates one. The value is
Bandit's personal context (positions, the $100K goal, conviction
scorecards, churn patterns, trading-vs-investing lanes), which lives with
Bandit, not here.

  app    POST /api/agent/thesis {ticker, user_id}  → queue_request → 202 queued
  Bandit GET  /muse/thesis/requests                → list_pending
  Bandit POST /muse/thesis/publish {request_id|ticker, thesis}
                                                   → publish: store + push
  app    GET  /api/agent/thesis/<ticker>?user_id=  → latest (polled)

Thesis JSON (what the app's sheet renders; extra keys are kept):
  verdict        "HOLD / ADD ON DIPS"                       required
  summary        paragraph                                  required
  conviction     1–10
  horizon        "12–24 mo"
  for_you        [str]   "For you, specifically"
  bull, bear     [str]
  what_changes   str
"""

from __future__ import annotations

import logging
import re
import threading
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

_TICKER_RE = re.compile(r"^[A-Z0-9.\-]{1,10}$")
REQUIRED_KEYS = ("verdict", "summary")


def clean_ticker(raw: str | None) -> str | None:
    t = (raw or "").strip().upper().lstrip("$")
    return t if _TICKER_RE.match(t) else None


def validate_thesis(thesis) -> str | None:
    """Error message, or None when the payload is renderable."""
    if not isinstance(thesis, dict):
        return "thesis must be a JSON object"
    for k in REQUIRED_KEYS:
        if not isinstance(thesis.get(k), str) or not thesis[k].strip():
            return f"thesis.{k} is required"
    for k in ("for_you", "bull", "bear"):
        v = thesis.get(k)
        if v is not None and not (isinstance(v, list) and all(isinstance(x, str) for x in v)):
            return f"thesis.{k} must be a list of strings"
    c = thesis.get("conviction")
    if c is not None and not (isinstance(c, (int, float)) and 1 <= c <= 10):
        return "thesis.conviction must be 1–10"
    return None


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _snapshot(ticker: str) -> tuple[float | None, str | None]:
    """Price + next earnings at request time, from the fundamentals cache —
    the baseline for the app's "your thesis may be stale" nudge. Best effort."""
    try:
        from services.ticker_brief.fundamentals import build_fundamentals
        data, _, _ = build_fundamentals(ticker)
        return data.get("price"), data.get("earnings_date")
    except Exception as e:
        logger.info("[thesis] snapshot for %s failed: %s", ticker, e)
        return None, None


def queue_request(sb, ticker: str, user_id: str) -> dict:
    """Insert a pending request, or return the one already pending for this
    user + ticker (a double-tap shouldn't queue two)."""
    existing = (
        sb.table("thesis_requests").select("*")
        .eq("user_id", user_id).eq("ticker", ticker).eq("status", "pending")
        .order("created_at", desc=True).limit(1).execute()
    ).data
    if existing:
        return existing[0]
    price, earnings = _snapshot(ticker)
    row = {
        "ticker": ticker,
        "user_id": user_id,
        "status": "pending",
        "price_at_request": price,
        "next_earnings_at_request": earnings,
    }
    return sb.table("thesis_requests").insert(row).execute().data[0]


def latest(sb, ticker: str, user_id: str) -> dict:
    """{status: none|pending|complete, thesis?, generated_at?, request?,
    price_at_generation?, next_earnings_at_generation?}. `pending` means a
    request newer than the stored thesis is still waiting on Bandit."""
    thesis_rows = (
        sb.table("ticker_theses").select("*")
        .eq("user_id", user_id).eq("ticker", ticker).limit(1).execute()
    ).data
    req_rows = (
        sb.table("thesis_requests").select("id, status, created_at, completed_at, error")
        .eq("user_id", user_id).eq("ticker", ticker)
        .order("created_at", desc=True).limit(1).execute()
    ).data
    req = req_rows[0] if req_rows else None
    out: dict = {"ticker": ticker, "status": "none", "request": req}
    if thesis_rows:
        t = thesis_rows[0]
        out.update(
            status="complete",
            thesis=t["thesis"],
            generated_at=t["generated_at"],
            price_at_generation=t.get("price_at_generation"),
            next_earnings_at_generation=t.get("next_earnings_at_generation"),
        )
    if req and req["status"] == "pending":
        out["status"] = "pending"   # a (re)write is queued; any old thesis stays readable
    elif req and req["status"] == "failed" and not thesis_rows:
        out["status"] = "failed"
    return out


def list_pending(sb, limit: int = 20) -> list[dict]:
    return (
        sb.table("thesis_requests").select("*")
        .eq("status", "pending").order("created_at").limit(limit).execute()
    ).data or []


def publish(sb, thesis: dict, request_id: str | None = None,
            ticker: str | None = None, user_id: str | None = None) -> dict:
    """Store Bandit's thesis, close the request, push the owner."""
    req = None
    if request_id:
        rows = sb.table("thesis_requests").select("*").eq("id", request_id).limit(1).execute().data
        if not rows:
            raise LookupError(f"thesis request {request_id} not found")
        req = rows[0]
        ticker, user_id = req["ticker"], req["user_id"]
    if not ticker or not user_id:
        raise ValueError("request_id, or ticker + user_id, is required")

    now = _now()
    price, earnings = (req.get("price_at_request"), req.get("next_earnings_at_request")) if req else (None, None)
    if price is None:
        price, earnings = _snapshot(ticker)
    sb.table("ticker_theses").upsert({
        "ticker": ticker,
        "user_id": user_id,
        "thesis": thesis,
        "status": "complete",
        "generated_at": now,
        "request_id": req["id"] if req else None,
        "price_at_generation": price,
        "next_earnings_at_generation": earnings,
    }, on_conflict="user_id,ticker").execute()
    # Close every request this answers (the explicit one and any duplicates).
    sb.table("thesis_requests").update({"status": "complete", "completed_at": now}) \
        .eq("user_id", user_id).eq("ticker", ticker).eq("status", "pending").execute()

    _notify_ready(sb, ticker, user_id)
    return {"ticker": ticker, "user_id": user_id, "generated_at": now}


def mark_failed(sb, request_id: str, error: str) -> None:
    sb.table("thesis_requests").update({
        "status": "failed", "completed_at": _now(), "error": (error or "")[:500],
    }).eq("id", request_id).execute()


_notifier = None
_notifier_lock = threading.Lock()


def _notify_ready(sb, ticker: str, user_id: str) -> None:
    """Never fails the publish — the thesis is stored; the app's poll still
    picks it up if the push doesn't land."""
    global _notifier
    try:
        with _notifier_lock:
            if _notifier is None:
                # One shared instance: each StrategyNotifier starts a drain thread.
                from services.strategy.notifier import StrategyNotifier
                _notifier = StrategyNotifier(sb)
        _notifier.notify_thesis_ready(ticker, user_id)
    except Exception as e:
        logger.warning("[thesis] ready push failed for %s: %s", ticker, e)

"""
Ticker Brief — one endpoint per section of the app's ticker sheet, so the
app renders each section as soon as its own data lands.

Every response is HTTP 200 with the same envelope:
  ok:      {"data": {...}, "asOf": "<iso>", "ttlSeconds": N, "stale": false}
  failure: {"data": null | <last good value>, "error": "<reason>", "stale": true, ...}
A section never 500s — the app shows "unavailable" inline for that section
only. On failure the last good value (if any) comes back marked stale.

Routes:
  GET  /ticker/<sym>/snapshot        price, name, summary, sector, market cap
  GET  /ticker/<sym>/levels          zone engine top-3 S/R + nearest above/below
  GET  /ticker/<sym>/flow            OI-based options positioning estimate
  GET  /ticker/<sym>/positioning     positioning confluence modifier for a trade (display only)
  GET  /ticker/<sym>/analysts        rating, target, last 3 rating changes
  GET  /ticker/<sym>/institutional   top holders + top-holder ownership trend
  GET  /ticker/<sym>/linked          LLM + web search, 30-day cache
  GET  /ticker/<sym>/catalysts       next earnings + momentum + ≤2 news events
  POST /ticker/<sym>/explain         ≤35-word explanation of a gate verdict
"""

import re
import time
from datetime import datetime, timezone

from flask import Blueprint, jsonify, request

from log.logging_config import get_logger
from services.ticker_brief import llm, sections
from services.ticker_brief.fetch import peek

logger = get_logger(__name__)

bp = Blueprint("ticker_brief", __name__)

_SYM_RE = re.compile(r"^[A-Z0-9.\-]{1,10}$")


def _iso(ts: float) -> str:
    return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()


def _symbol(raw: str):
    sym = (raw or "").strip().upper().lstrip("$")
    return sym if _SYM_RE.match(sym) else None


def _section(name: str, raw_sym: str, builder, stale_key: str = None):
    sym = _symbol(raw_sym)
    if not sym:
        return jsonify({"data": None, "error": "invalid ticker", "stale": True})
    try:
        data, ttl, fetched_at = builder(sym)
        return jsonify({"data": data, "asOf": _iso(fetched_at), "ttlSeconds": ttl, "stale": False})
    except Exception as e:
        logger.warning("[ticker_brief] %s %s failed: %s", name, sym, e)
        last = peek(stale_key.format(sym=sym)) if stale_key else None
        body = {"data": last[1] if last else None, "error": str(e) or type(e).__name__, "stale": True}
        if last:
            body["asOf"] = _iso(last[0])
        return jsonify(body)


@bp.route("/ticker/<sym>/snapshot", methods=["GET"])
def snapshot(sym):
    return _section("snapshot", sym, sections.build_snapshot)


@bp.route("/ticker/<sym>/levels", methods=["GET"])
def levels(sym):
    return _section("levels", sym, sections.build_levels)


@bp.route("/ticker/<sym>/flow", methods=["GET"])
def flow(sym):
    return _section("flow", sym, sections.build_flow)


@bp.route("/ticker/<sym>/positioning", methods=["GET"])
def positioning(sym):
    """Positioning confluence for a trade: ?direction=CALL|PUT&expiry=YYYY-MM-DD
    (expiry picks 0DTE vs swing weights), optional &target=<underlying price>.
    Display-only modifier — never changes the gate verdict."""
    from services.ticker_brief.positioning import build_positioning
    direction = (request.args.get("direction") or "CALL").upper()
    if direction not in ("CALL", "PUT"):
        return jsonify({"data": None, "error": "direction must be CALL or PUT", "stale": True})
    expiry = request.args.get("expiry")
    target = request.args.get("target", type=float)
    return _section("positioning", sym, lambda s: build_positioning(s, direction, expiry, target))


@bp.route("/ticker/<sym>/analysts", methods=["GET"])
def analysts(sym):
    return _section("analysts", sym, sections.build_analysts)


@bp.route("/ticker/<sym>/institutional", methods=["GET"])
def institutional(sym):
    return _section("institutional", sym, sections.build_institutional, stale_key="inst:{sym}")


@bp.route("/ticker/<sym>/linked", methods=["GET"])
def linked(sym):
    return _section("linked", sym, llm.build_linked, stale_key="linked:{sym}")


def _build_catalysts(symbol: str):
    """Earnings date and momentum are deterministic (yfinance); news events
    are LLM-derived and flagged as such. Each part degrades to None on its
    own — the section only fails if all three do."""
    errors = {}
    try:
        earnings = sections.next_earnings(symbol)
    except Exception as e:
        earnings, errors["earnings"] = None, str(e)
    try:
        momentum, _, _ = sections.build_momentum(symbol)
    except Exception as e:
        momentum, errors["momentum"] = None, str(e)
    news, news_at = None, None
    try:
        news, news_at = llm.catalyst_news(symbol)
    except Exception as e:
        errors["news"] = str(e)
    if len(errors) == 3:
        raise RuntimeError("; ".join(f"{k}: {v}" for k, v in errors.items()))
    return {
        "next_earnings": earnings,
        "momentum": momentum,
        "news": news,
        "news_as_of": _iso(news_at) if news_at else None,
        "errors": errors or None,
    }, llm.TTL_CATALYST_NEWS, time.time()


@bp.route("/ticker/<sym>/catalysts", methods=["GET"])
def catalysts(sym):
    return _section("catalysts", sym, _build_catalysts)


@bp.route("/ticker/<sym>/explain", methods=["POST"])
def explain(sym):
    """Body: the entry-check payload the app is showing (GET
    /strategy/entry-check/<sym>). Returns only an explanation of it — never
    a verdict of its own; `data.text` is null when the model's text failed a
    guardrail."""
    gate = request.get_json(silent=True) or {}
    if not isinstance(gate, dict) or not gate.get("verdicts") and not gate.get("verdict"):
        return jsonify({"data": None, "error": "gate verdict JSON required", "stale": True})

    def _builder(symbol):
        text, fetched_at = llm.explain_gate(symbol, gate)
        return {"text": text}, llm.TTL_EXPLAIN, fetched_at
    return _section("explain", sym, _builder)
